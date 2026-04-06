"""
LLM-powered claim extraction from AI responses.
"""

import json
import logging
from typing import Optional

from openai import AsyncOpenAI

from app.config import get_settings
from app.models.detect import (
    ExtractedClaim,
    ClaimDomain,
    SourceType,
    ConversationMessage,
)

logger = logging.getLogger(__name__)

# ── Claim Extraction Prompt ───────────────────────────────────────────────

CLAIM_EXTRACTION_PROMPT = """You are a precise claim extraction system. Your job is to analyze an AI-generated response and extract every individual factual claim that can be independently verified.

## Instructions

1. Extract each factual claim as a **standalone assertion** that can be verified independently (stored in "text"). 
2. **CRITICAL**: For every claim, you MUST extract the exact, strictly matching verbal substring from the AI's response that corresponds to this claim (stored in "exact_quote"). This will be used for exact text highlighting in the UI.
3. Classify each claim by **domain** (see domain list below).
4. For opinion claims: extract them if they are stated as objective fact (e.g., "X is the best") — classify as "opinion_subjective". Skip clearly hedged opinions ("I think", "it's possible").
5. DO extract: facts, statistics, dates, names, definitions, causal claims, comparisons, scientific assertions, financial data.
6. Rate the importance of each claim (0-1): how critical is this claim to the overall response?
7. Rate the confidence that this claim needs checking (0-1): ALL verifiable factual claims should score >= 0.6, even well-known facts. Only trivially obvious claims like greetings ("Hello", "How are you?") should score below 0.3. The purpose is hallucination detection — every factual statement must be verified regardless of how "common knowledge" it seems.
8. Suggest which verification sources to check: web_search, conversation_history, vector_db, direct_api.
9. Suggest specific search queries for web verification.
10. Extract any numerical citation indices (e.g., [1], [2]) that the AI embedded in the text related to this claim into `citation_indices` (as a list of integers).
11. List key entities (names, places, organizations, numbers) in each claim.
12. Set `requires_multi_hop` to true if the claim requires combining information from multiple sources to verify.

## Domain Classification

Classify each claim into ONE of these domains:
- **general_factual**: Common knowledge, geography, culture (e.g., "The Eiffel Tower is 330m tall")
- **scientific_technical**: Physics, CS, engineering, biology, chemistry (e.g., "Transformers use self-attention")
- **medical_health**: Diseases, treatments, drugs, anatomy, nutrition (e.g., "Aspirin reduces heart attack risk by 25%")
- **numerical_statistical**: Statistics, percentages, measurements, rankings (e.g., "GDP grew 3.2% in Q3 2025")
- **finance_business**: Companies, stocks, revenue, regulations, crypto (e.g., "Apple's revenue was $394B in FY2023")
- **legal_regulatory**: Laws, court rulings, regulations, compliance (e.g., "GDPR requires consent for data processing")
- **news_current_events**: Recent happenings, politics, world events (e.g., "The EU passed the AI Act in March 2024")
- **historical**: Past events, dates, historical figures (e.g., "The Berlin Wall fell on Nov 9, 1989")
- **causal_relational**: Cause-effect, correlations, comparisons (e.g., "Smoking causes lung cancer")
- **opinion_subjective**: Personal views stated as fact (e.g., "Python is the best language for ML")

## Output Format

Return ONLY valid JSON with this exact structure:
{
  "claims": [
    {
      "id": "c1",
      "text": "The exact factual claim as a standalone assertion",
      "exact_quote": "The exact verbatim phrase from the original response",
      "citation_indices": [1, 2],
      "domain": "medical_health",
      "importance": 0.8,
      "suggested_sources": ["web_search", "direct_api"],
      "search_queries": ["search query for this claim"],
      "confidence_needs_checking": 0.7,
      "key_entities": ["Entity1", "Entity2"],
      "requires_multi_hop": false
    }
  ]
}

If the response contains no verifiable factual claims, return: {"claims": []}
"""


# ── Provider configurations for claim extraction ─────────────────────────

EXTRACTION_PROVIDERS = [
    {
        "name": "groq",
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_field": "groq_api_key",
        "default_model": "llama-3.3-70b-versatile",
        "description": "Groq Llama 3.3 70B — fastest free option (~500 tok/s)",
    },
    {
        "name": "nvidia",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "api_key_field": "nvidia_api_key",
        "model": "meta/llama-3.1-70b-instruct",
        "description": "NVIDIA NIM Llama 3.1 70B ",
    },
    {
        "name": "openrouter",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_field": "openrouter_api_key",
        "default_model": "meta-llama/llama-3.3-70b-instruct:free",
        "description": "OpenRouter Llama 3.3 70B — free tier",
    },
]


class ClaimExtractor:
    """
    Extracts verifiable claims from AI responses using the best available
    free LLM provider.
    """

    def __init__(self):
        settings = get_settings()
        self.max_claims = settings.max_claims_per_response
        requested_model = (settings.claim_extraction_model or "").strip()
        requested_model_lower = requested_model.lower()
        prefers_glm = requested_model_lower.startswith("glm") or "glm" in requested_model_lower
        prefers_groq_openai = requested_model_lower.startswith("openai/gpt-oss") or "gpt-oss-120b" in requested_model_lower
        
        # Find the best available provider (all OpenAI-compatible)
        self.client = None
        self.model_name = None
        self.provider_name = None

        provider_candidates = EXTRACTION_PROVIDERS
        if prefers_glm:
            # GLM models are typically available through OpenRouter's OpenAI-compatible endpoint.
            provider_candidates = sorted(
                EXTRACTION_PROVIDERS,
                key=lambda provider: 0 if provider["name"] == "openrouter" else 1,
            )
        elif prefers_groq_openai:
            provider_candidates = sorted(
                EXTRACTION_PROVIDERS,
                key=lambda provider: 0 if provider["name"] == "groq" else 1,
            )

        for provider in provider_candidates:
            api_key = getattr(settings, provider["api_key_field"], None)
            if api_key:
                self.client = AsyncOpenAI(
                    base_url=provider["base_url"],
                    api_key=api_key,
                )
                selected_model = requested_model or provider["default_model"]

                # Step 3.5 Flash is configured for NVIDIA NIM in this project.
                # If NVIDIA is unavailable, fall back to the selected provider default.
                if requested_model.startswith("stepfun-ai/") and provider["name"] != "nvidia":
                    logger.warning(
                        "Requested model '%s' requires NVIDIA NIM; falling back to %s default '%s'.",
                        requested_model,
                        provider["name"],
                        provider["default_model"],
                    )
                    selected_model = provider["default_model"]

                self.model_name = selected_model
                self.provider_name = provider["name"]
                logger.info(
                    f"Claim extraction: using {provider['description']} ({self.model_name})"
                )
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
        request_kwargs = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": CLAIM_EXTRACTION_PROMPT},
                {"role": "user", "content": user_message},
            ],
        }
        
        # OpenRouter needs extra headers
        if self.provider_name == "openrouter":
            extra_kwargs["extra_headers"] = {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "AI Hallucination Detector",
            }

        # NVIDIA Qwen settings from NIM chat-completions guidance.
        if self.provider_name == "nvidia":
            request_kwargs["temperature"] = 0.60
            request_kwargs["top_p"] = 0.95
            request_kwargs["max_tokens"] = 16384
            extra_kwargs["extra_body"] = {
                "chat_template_kwargs": {"enable_thinking": True}
            }
        else:
            request_kwargs["temperature"] = 0.1
            request_kwargs["max_tokens"] = 4096
            request_kwargs["response_format"] = {"type": "json_object"}

        response = await self.client.chat.completions.create(
            **request_kwargs,
            **extra_kwargs,
        )
        return response.choices[0].message.content or ""


    def _parse_response(self, response_text: str) -> list[ExtractedClaim]:
        """Parse the JSON response into ExtractedClaim objects."""
        import re
        try:
            text = response_text.strip()

            # If model returned markdown fenced JSON, extract the fenced payload first.
            fenced_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
            if fenced_match:
                text = fenced_match.group(1).strip()

            # Isolate the first JSON object from conversational prefixes/suffixes.
            if not text.startswith("{"):
                start = text.find("{")
                end = text.rfind("}")
                if start != -1 and end != -1 and end > start:
                    text = text[start:end + 1]
                
            # Automatically strip trailing commas (common LLM hallucination) before closing brackets
            text = re.sub(r',\s*([}\]])', r'\1', text)
            
            data = json.loads(text)
            claims_data = data.get("claims", [])

            claims = []
            for i, item in enumerate(claims_data):
                try:
                    claim = ExtractedClaim(
                        id=item.get("id", f"c{i + 1}"),
                        text=item.get("text", ""),
                        exact_quote=item.get("exact_quote"),
                        citation_indices=item.get("citation_indices", []),
                        domain=self._parse_claim_domain(item.get("domain", "general_factual")),
                        importance=float(item.get("importance", 0.5)),
                        suggested_sources=self._parse_sources(item.get("suggested_sources", [])),
                        search_queries=item.get("search_queries", []),
                        confidence_needs_checking=max(
                            float(item.get("confidence_needs_checking", 0.7)),
                            0.5,  # Floor: never skip a factual claim
                        ),
                        key_entities=item.get("key_entities", []),
                        requires_multi_hop=bool(item.get("requires_multi_hop", False)),
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
    def _parse_claim_domain(domain_str: str) -> ClaimDomain:
        """Parse domain string to ClaimDomain enum, with fallback mapping from old types."""
        # Direct match
        try:
            return ClaimDomain(domain_str.lower())
        except ValueError:
            pass
        # Map old ClaimType values to new ClaimDomain
        old_type_map = {
            "factual": ClaimDomain.GENERAL_FACTUAL,
            "statistical": ClaimDomain.NUMERICAL_STATISTICAL,
            "temporal": ClaimDomain.HISTORICAL,
            "causal": ClaimDomain.CAUSAL_RELATIONAL,
            "definition": ClaimDomain.GENERAL_FACTUAL,
        }
        return old_type_map.get(domain_str.lower(), ClaimDomain.GENERAL_FACTUAL)

    @staticmethod
    def _parse_sources(sources: list) -> list[SourceType]:
        if isinstance(sources, str):
            sources = [sources]
        if not isinstance(sources, list):
            return []

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
