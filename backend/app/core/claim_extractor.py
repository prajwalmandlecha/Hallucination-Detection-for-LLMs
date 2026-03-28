"""
LLM-powered claim extraction from AI responses.

Uses Groq (Llama 3.3 70B) for claim extraction — the fastest free option:
- ~500 tokens/sec on Groq's LPU hardware
- 30 RPM, 14,400 RPD on free tier
- OpenAI-compatible API with JSON mode
- 70B parameters = smart enough for precise claim decomposition

Falls back to Google Gemini or NVIDIA NIM if Groq is unavailable.
"""

import json
import logging
from typing import Optional

from openai import AsyncOpenAI

from app.config import get_settings
from app.models.detect import (
    ExtractedClaim,
    ClaimType,
    SourceType,
    ConversationMessage,
)

logger = logging.getLogger(__name__)

# ── Claim Extraction Prompt ───────────────────────────────────────────────

CLAIM_EXTRACTION_PROMPT = """You are a precise claim extraction system. Your job is to analyze an AI-generated response and extract every individual factual claim that can be independently verified.

## Instructions

1. Extract each factual claim as a **standalone assertion** that can be verified independently. 
2. Do NOT extract opinions, subjective statements, or hedged language ("might", "could", "it's possible").
3. DO extract: facts, statistics, dates, names, definitions, causal claims, comparisons.
4. Classify each claim by type: factual, statistical, temporal, causal, or definition.
5. Rate the importance of each claim (0-1): how critical is this claim to the overall response?
6. Rate the confidence that this claim needs checking (0-1): how likely is it to be hallucinated?
7. Suggest which verification sources to check: web_search, conversation_history, vector_db.
8. Suggest specific search queries for web verification.
9. List key entities (names, places, organizations, numbers) in each claim.

## Important Source Suggestion Rules
- Suggest "web_search" for any factual/statistical/temporal claim about the real world
- Suggest "conversation_history" if the claim references something discussed earlier
- Suggest "vector_db" if the claim could be verified against user-uploaded documents
- A claim can have multiple suggested sources

## Output Format

Return ONLY valid JSON with this exact structure:
{
  "claims": [
    {
      "id": "c1",
      "text": "The exact factual claim as a standalone assertion",
      "quote_from_response": "A strictly continuous 5-10 word exact substring from the AI Response that anchors this claim. MUST NOT contain markdown formatting like **.",
      "type": "factual",
      "importance": 0.8,
      "suggested_sources": ["web_search"],
      "search_queries": ["search query for this claim"],
      "confidence_needs_checking": 0.7,
      "key_entities": ["Entity1", "Entity2"]
    }
  ]
}

If the response contains no verifiable factual claims, return: {"claims": []}
"""


# ── Provider configurations for claim extraction ─────────────────────────

EXTRACTION_PROVIDERS = [
    {
        "name": "groq_disabled",
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_field": "bad_groq_key",
        "model": "llama-3.3-70b-versatile",
        "description": "Groq Llama 3.3 70B — fastest free option (~500 tok/s)",
    },
    {
        "name": "nvidia",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "api_key_field": "nvidia_api_key",
        "model": "meta/llama-3.1-70b-instruct",
        "description": "NVIDIA NIM Llama 3.1 70B — 1000 free credits",
    },
    {
        "name": "openrouter",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_field": "openrouter_api_key",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
        "description": "OpenRouter Llama 3.3 70B — free tier",
    },
]


class ClaimExtractor:
    """
    Extracts verifiable claims from AI responses using the best available
    free LLM provider.
    
    Priority order: Groq > NVIDIA NIM > OpenRouter > Google Gemini
    
    Why this order?
    - Groq: ~500 tok/s (LPU), 30 RPM free, JSON mode ← fastest
    - NVIDIA: Good speed, 1000 free credits, reliable
    - OpenRouter: Free but lower daily limits (50/day)
    - Google: 15 RPM but uses different SDK (fallback only)
    """

    def __init__(self):
        settings = get_settings()
        self.max_claims = settings.max_claims_per_response
        
        # Find the best available provider (all OpenAI-compatible)
        self.client = None
        self.model_name = None
        self.provider_name = None

        for provider in EXTRACTION_PROVIDERS:
            api_key = getattr(settings, provider["api_key_field"], None)
            if api_key:
                self.client = AsyncOpenAI(
                    base_url=provider["base_url"],
                    api_key=api_key,
                )
                self.model_name = provider["model"]
                self.provider_name = provider["name"]
                logger.info(f"Claim extraction: using {provider['description']}")
                break

        # If no OpenAI-compatible provider available
        if not self.client:
            logger.warning("No API keys configured for claim extraction! Please set GROQ_API_KEY, NVIDIA_API_KEY, or OPENROUTER_API_KEY in .env")

    @property
    def is_available(self) -> bool:
        return self.client is not None

    async def extract_claims(
        self,
        ai_response: str,
        conversation_history: Optional[list[ConversationMessage]] = None,
        has_documents: bool = False,
    ) -> list[ExtractedClaim]:
        """
        Extract verifiable claims from an AI response.

        Args:
            ai_response: The AI-generated response to analyze.
            conversation_history: Previous conversation messages for context.
            has_documents: Whether user-uploaded documents are available.

        Returns:
            List of ExtractedClaim objects.
        """
        if not self.is_available:
            logger.error("Cannot extract claims: no provider configured")
            return []

        # Build the user message with context
        user_message = self._build_extraction_message(
            ai_response, conversation_history, has_documents
        )

        try:
            if self.client:
                response = await self._call_openai_compatible(user_message)
            else:
                raise RuntimeError("No claim extraction provider client available")

            claims = self._parse_response(response)
            claims = claims[: self.max_claims]

            logger.info(f"Extracted {len(claims)} claims via {self.provider_name}")
            return claims

        except Exception as e:
            logger.error(f"Claim extraction failed: {e}", exc_info=True)
            return []

    def _build_extraction_message(
        self,
        ai_response: str,
        conversation_history: Optional[list[ConversationMessage]],
        has_documents: bool,
    ) -> str:
        """Build the message to send for claim extraction."""
        parts = []

        if conversation_history:
            conv_text = "\n".join(
                f"{msg.role.upper()}: {msg.content}"
                for msg in conversation_history[-6:]
            )
            parts.append(f"## Conversation Context\n{conv_text}")

        source_note = "Available verification sources: web_search, conversation_history"
        if has_documents:
            source_note += ", vector_db (user has uploaded documents)"
        parts.append(source_note)

        parts.append(f"## AI Response to Analyze\n{ai_response}")

        return "\n\n".join(parts)

    async def _call_openai_compatible(self, user_message: str) -> str:
        """
        Call claim extraction via OpenAI-compatible API.
        Works with Groq, NVIDIA NIM, and OpenRouter.
        """
        extra_kwargs = {}
        
        # OpenRouter needs extra headers
        if self.provider_name == "openrouter":
            extra_kwargs["extra_headers"] = {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "AI Hallucination Detector",
            }

        response = await self.client.chat.completions.create(
            model=self.model_name,
            messages=[
                {"role": "system", "content": CLAIM_EXTRACTION_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.1,
            max_tokens=4096,
            response_format={"type": "json_object"},
            **extra_kwargs,
        )
        return response.choices[0].message.content


    def _parse_response(self, response_text: str) -> list[ExtractedClaim]:
        """Parse the JSON response into ExtractedClaim objects."""
        try:
            text = response_text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1]
                text = text.rsplit("```", 1)[0]
            
            data = json.loads(text)
            claims_data = data.get("claims", [])

            claims = []
            for i, item in enumerate(claims_data):
                try:
                    claim = ExtractedClaim(
                        id=item.get("id", f"c{i + 1}"),
                        text=item.get("text", ""),
                        quote_from_response=item.get("quote_from_response", None),
                        type=self._parse_claim_type(item.get("type", "factual")),
                        importance=float(item.get("importance", 0.5)),
                        suggested_sources=self._parse_sources(item.get("suggested_sources", [])),
                        search_queries=item.get("search_queries", []),
                        confidence_needs_checking=float(
                            item.get("confidence_needs_checking", 0.5)
                        ),
                        key_entities=item.get("key_entities", []),
                    )
                    if claim.text:
                        claims.append(claim)
                except Exception as e:
                    logger.warning(f"Failed to parse claim {i}: {e}")
                    continue

            return claims

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse response as JSON: {e}")
            logger.debug(f"Raw response: {response_text[:500]}")
            return []

    @staticmethod
    def _parse_claim_type(type_str: str) -> ClaimType:
        try:
            return ClaimType(type_str.lower())
        except ValueError:
            return ClaimType.FACTUAL

    @staticmethod
    def _parse_sources(sources: list) -> list[SourceType]:
        parsed = []
        for s in sources:
            try:
                parsed.append(SourceType(s))
            except ValueError:
                continue
        return parsed


# ── Module-level singleton ────────────────────────────────────────────────

_extractor: Optional[ClaimExtractor] = None


def get_claim_extractor() -> ClaimExtractor:
    """Get or create the claim extractor singleton."""
    global _extractor
    if _extractor is None:
        _extractor = ClaimExtractor()
    return _extractor
