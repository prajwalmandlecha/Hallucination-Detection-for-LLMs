"""
Claim Adjudicator — Pipeline Stage 5.

Uses Gemini 3 Flash via the google-genai SDK to perform LLM-based
adjudication of each claim against its ranked evidence.

Replaces the old hardcoded risk scoring formula with intelligent
multi-hop reasoning over evidence pieces.
"""

import json
import asyncio
import logging
from typing import Optional
from dataclasses import dataclass

from app.config import get_settings
from app.models.detect import (
    ExtractedClaim, EvidencePiece, ClaimStatus, ClaimDomain,
)

logger = logging.getLogger(__name__)


@dataclass
class AdjudicationResult:
    """Result from LLM adjudication of a single claim."""
    claim: ExtractedClaim
    status: ClaimStatus
    risk_score: float
    confidence: float
    reasoning: str
    key_evidence_indices: list[int]
    contradiction_details: Optional[str]
    suggestion: Optional[str]


# ── Singleton ─────────────────────────────────────────────────────────────

_adjudicator: Optional["ClaimAdjudicator"] = None


def get_claim_adjudicator() -> "ClaimAdjudicator":
    """Get or create the claim adjudicator singleton."""
    global _adjudicator
    if _adjudicator is None:
        _adjudicator = ClaimAdjudicator()
    return _adjudicator


class ClaimAdjudicator:
    """
    LLM-based claim adjudicator using Gemini 3 Flash.

    For each claim + its ranked evidence (with NLI scores),
    produces a verdict with risk_score, reasoning, and confidence.
    """

    def __init__(self):
        settings = get_settings()
        if not settings.gemini_api_key:
            logger.warning("GEMINI_API_KEY not set — adjudicator will use fallback scoring")
            self.client = None
            return

        try:
            from google import genai
            self.client = genai.Client(api_key=settings.gemini_api_key)
            self.model = "gemini-3-flash-preview"
            logger.info("ClaimAdjudicator initialized with Gemini 3 Flash")
        except Exception as e:
            logger.error(f"Failed to initialize Gemini client: {e}")
            self.client = None

    def _build_prompt(self, claim: ExtractedClaim, evidence: list[EvidencePiece]) -> str:
        """Build the adjudication prompt for a single claim."""
        evidence_text = ""
        for i, ev in enumerate(evidence):
            scores = ev.nli_scores or {}
            ent = scores.get("entailment", 0)
            con = scores.get("contradiction", 0)
            neu = scores.get("neutral", 0)
            evidence_text += (
                f"[{i}] Source: {ev.source_title or 'Unknown'} "
                f"({ev.source_type.value}, tier: {ev.source_tier.value})\n"
                f"     URL: {ev.source_url or 'N/A'}\n"
                f"     Snippet: \"{ev.snippet[:500]}\"\n"
                f"     NLI: entailment={ent:.3f}, contradiction={con:.3f}, neutral={neu:.3f}\n\n"
            )

        if not evidence_text:
            evidence_text = "No evidence was found for this claim.\n"

        prompt = f"""You are a hallucination detection adjudicator. Given a claim extracted from an AI assistant's response and evidence pieces (each with NLI scores from a DeBERTa cross-encoder), determine whether the claim is hallucinated or factually grounded.

## Claim
"{claim.text}"
Domain: {claim.domain.value}
Importance: {claim.importance}/1.0

## Evidence (ranked by relevance, with NLI scores)
{evidence_text}

## Instructions
1. Analyze each evidence piece in context of the claim
2. Perform multi-hop reasoning if needed (combining information from multiple evidence pieces)
3. Consider the domain-specific reliability of each source (direct_api sources like Wikipedia/PubMed are more trustworthy than web search)
4. For contradictions: assess whether they are genuine or due to different contexts/time periods/scope
5. For opinions: check if the opinion is presented as objective fact — if so, it should be flagged
6. If no evidence was found, mark as UNVERIFIED with appropriate risk score based on the claim's nature

## Risk Score Guidelines
- VERIFIED claims: 0-20 (lower = more strongly verified)
- PARTIALLY_VERIFIED claims: 20-45 (some evidence supports, some gaps)
- UNVERIFIED claims: 45-70 (no evidence found, risk depends on claim importance)
- CONTRADICTED claims: 65-100 (higher = stronger/more critical contradiction)
- OPINION claims: 5-15 (low risk unless presented as fact, then 30-50)

## Output (strict JSON only, no markdown)
{{
  "status": "VERIFIED | CONTRADICTED | UNVERIFIED | PARTIALLY_VERIFIED | OPINION",
  "risk_score": <0-100 integer>,
  "confidence": <0.0-1.0 float>,
  "reasoning": "<2-3 sentence explanation of your verdict>",
  "key_evidence_indices": [<indices of most relevant evidence pieces>],
  "contradiction_details": "<if contradicted, explain what contradicts and why — else null>",
  "suggestion": "<if uncertain, what the user should verify manually — else null>"
}}"""
        return prompt

    async def adjudicate_claim(
        self,
        claim: ExtractedClaim,
        ranked_evidence: list[EvidencePiece],
    ) -> AdjudicationResult:
        """
        Adjudicate a single claim against its ranked evidence.

        Falls back to heuristic scoring if Gemini is unavailable.
        """
        if self.client is None:
            return self._fallback_adjudicate(claim, ranked_evidence)

        try:
            prompt = self._build_prompt(claim, ranked_evidence)

            response = await self.client.aio.models.generate_content(
                model=self.model,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "temperature": 0.1,
                },
            )

            return self._parse_response(response.text, claim)

        except Exception as e:
            logger.error(f"Gemini adjudication failed for claim '{claim.id}': {e}")
            return self._fallback_adjudicate(claim, ranked_evidence)

    async def adjudicate_batch(
        self,
        claims_with_evidence: list[tuple[ExtractedClaim, list[EvidencePiece]]],
    ) -> list[AdjudicationResult]:
        """
        Adjudicate multiple claims concurrently with rate limiting.

        Args:
            claims_with_evidence: List of (claim, ranked_evidence) tuples.

        Returns:
            List of AdjudicationResults in the same order.
        """
        if not claims_with_evidence:
            return []

        semaphore = asyncio.Semaphore(5)  # Max 5 concurrent Gemini calls

        async def _throttled(claim: ExtractedClaim, evidence: list[EvidencePiece]):
            async with semaphore:
                return await self.adjudicate_claim(claim, evidence)

        tasks = [_throttled(c, e) for c, e in claims_with_evidence]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert exceptions to fallback results
        final = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Adjudication failed: {result}")
                claim, evidence = claims_with_evidence[i]
                final.append(self._fallback_adjudicate(claim, evidence))
            else:
                final.append(result)

        return final

    def _parse_response(self, response_text: str, claim: ExtractedClaim) -> AdjudicationResult:
        """Parse Gemini's JSON response into an AdjudicationResult."""
        try:
            # Clean potential markdown wrapping
            text = response_text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                if text.endswith("```"):
                    text = text[:-3]
                text = text.strip()

            data = json.loads(text)

            status_map = {
                "VERIFIED": ClaimStatus.VERIFIED,
                "PARTIALLY_VERIFIED": ClaimStatus.PARTIALLY_VERIFIED,
                "UNVERIFIED": ClaimStatus.UNVERIFIED,
                "CONTRADICTED": ClaimStatus.CONTRADICTED,
                "OPINION": ClaimStatus.OPINION,
            }
            status = status_map.get(data.get("status", "UNVERIFIED"), ClaimStatus.UNVERIFIED)

            return AdjudicationResult(
                claim=claim,
                status=status,
                risk_score=float(data.get("risk_score", 50)),
                confidence=float(data.get("confidence", 0.5)),
                reasoning=data.get("reasoning", "No reasoning provided"),
                key_evidence_indices=data.get("key_evidence_indices", []),
                contradiction_details=data.get("contradiction_details"),
                suggestion=data.get("suggestion"),
            )
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            logger.error(f"Failed to parse Gemini response: {e}\nRaw: {response_text[:500]}")
            return self._fallback_adjudicate(claim, [])

    def _fallback_adjudicate(
        self,
        claim: ExtractedClaim,
        evidence: list[EvidencePiece],
    ) -> AdjudicationResult:
        """
        Heuristic fallback when Gemini is unavailable.

        Uses NLI scores directly (similar to V1 logic but simplified).
        """
        if not evidence:
            # No evidence = unverified
            risk = 55.0 if claim.importance > 0.5 else 45.0
            return AdjudicationResult(
                claim=claim,
                status=ClaimStatus.UNVERIFIED,
                risk_score=risk,
                confidence=0.3,
                reasoning="No evidence found. Unable to verify this claim.",
                key_evidence_indices=[],
                contradiction_details=None,
                suggestion="Try searching for this claim manually.",
            )

        max_ent = max((ev.nli_scores or {}).get("entailment", 0) for ev in evidence)
        max_con = max((ev.nli_scores or {}).get("contradiction", 0) for ev in evidence)

        if claim.domain == ClaimDomain.OPINION_SUBJECTIVE:
            return AdjudicationResult(
                claim=claim,
                status=ClaimStatus.OPINION,
                risk_score=10.0,
                confidence=0.7,
                reasoning="This is an opinion/subjective claim.",
                key_evidence_indices=[],
                contradiction_details=None,
                suggestion=None,
            )
        
        # If we have a very strong entailment score from any chunk, it's VERIFIED
        if max_ent >= 0.80:
            status = ClaimStatus.VERIFIED
            risk = max(5.0, 30.0 * (1.0 - max_ent))
        # Otherwise, if we have a strong contradiction, it's CONTRADICTED
        elif max_con > 0.7:
            status = ClaimStatus.CONTRADICTED
            risk = 70.0 + (max_con - 0.7) * 100
            risk = min(risk, 95.0)
        # Moderate entailment -> Partially Verified
        elif max_ent > 0.5:
            status = ClaimStatus.PARTIALLY_VERIFIED
            risk = 30.0 + (1.0 - max_ent) * 30
        else:
            status = ClaimStatus.UNVERIFIED
            risk = 50.0 + claim.importance * 15

        return AdjudicationResult(
            claim=claim,
            status=status,
            risk_score=round(risk, 1),
            confidence=max(max_ent, max_con, 0.3),
            reasoning=f"Fallback heuristic: max_entailment={max_ent:.3f}, max_contradiction={max_con:.3f}",
            key_evidence_indices=list(range(min(3, len(evidence)))),
            contradiction_details=f"Max contradiction score: {max_con:.3f}" if max_con > 0.5 else None,
            suggestion="Gemini adjudicator unavailable, verify manually." if max_ent < 0.5 else None,
        )
