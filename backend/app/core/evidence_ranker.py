"""
Evidence Ranker — V2 Pipeline Stage 4.

After NLI scoring, ranks evidence pieces per claim by informativeness
and source trust tier, then selects the top-K for LLM adjudication.
"""

import logging
from app.models.detect import EvidencePiece, SourceTier

logger = logging.getLogger(__name__)


# Source tier trust bonuses — higher = more trusted
SOURCE_TIER_BONUS = {
    SourceTier.DIRECT_API: 0.10,
    SourceTier.TAVILY: 0.05,
    SourceTier.SERPER: 0.03,
    SourceTier.CONVERSATION: 0.02,
    SourceTier.VECTOR_DB: 0.01,
}


def rank_evidence(
    evidence_list: list[EvidencePiece],
    max_count: int = 10,
    min_informativeness: float = 0.3,
) -> list[EvidencePiece]:
    """
    Rank evidence by informativeness for the LLM adjudicator.

    Priority:
    1. Strong contradictions (contradiction > 0.7) — most critical to surface
    2. Strong entailments (entailment > 0.7) — confirms claim
    3. Mixed signals (high disagreement) — needs multi-hop reasoning
    4. Neutral — least informative

    Secondary sort: by source trust tier (direct_api > tavily > serper > conversation > vector_db)

    Args:
        evidence_list: All evidence pieces for a single claim (post-NLI).
        max_count: Maximum number of evidence pieces to return.
        min_informativeness: Minimum max(entailment, contradiction) to include.

    Returns:
        Ranked and filtered list of top evidence pieces.
    """
    if not evidence_list:
        return []

    # Filter out evidence below informativeness threshold
    filtered = []
    for ev in evidence_list:
        scores = ev.nli_scores or {}
        ent = scores.get("entailment", 0)
        con = scores.get("contradiction", 0)
        informativeness = max(ent, con)

        if informativeness >= min_informativeness:
            filtered.append(ev)

    # If filtering removed everything, keep the best ones anyway
    if not filtered and evidence_list:
        filtered = evidence_list

    def sort_key(ev: EvidencePiece) -> float:
        scores = ev.nli_scores or {}
        ent = scores.get("entailment", 0)
        con = scores.get("contradiction", 0)

        # Informativeness = how decisive the evidence is
        informativeness = max(ent, con)

        # Bias toward contradiction (more critical to surface for hallucination detection)
        contradiction_bonus = con * 0.2

        # Source tier bonus
        tier_bonus = SOURCE_TIER_BONUS.get(ev.source_tier, 0)

        # Higher score = better rank (we negate for ascending sort)
        return -(informativeness + contradiction_bonus + tier_bonus)

    ranked = sorted(filtered, key=sort_key)

    selected = ranked[:max_count]
    logger.info(
        f"Evidence ranking: {len(evidence_list)} total → "
        f"{len(filtered)} above threshold → {len(selected)} selected"
    )
    return selected
