"""
Hallucination risk score calculator.

Computes per-claim and overall response risk scores using a weighted
multi-signal aggregation formula.
"""

import logging
from typing import Optional

from app.config import get_settings
from app.models.detect import (
    ClaimVerificationResult,
    ClaimStatus,
    RiskLevel,
    Warning,
)

logger = logging.getLogger(__name__)


class RiskScorer:
    """
    Calculates hallucination risk scores.
    
    Per-claim score formula (0-100):
        w1 * (1 - max_entailment)        # Source support
        w2 * max_contradiction            # Direct contradictions
        w3 * (1 - source_coverage)        # Source coverage
        w4 * claim_importance             # Claim criticality
        w5 * source_agreement_variance    # Source disagreement
        w6 * (1 - evidence_count_norm)    # Evidence quantity
    
    Overall score: weighted average by claim importance,
    with hard floors for critical contradictions and high
    unverifiable ratios.
    """

    def __init__(self):
        settings = get_settings()
        self.w1 = settings.weight_source_support      # 0.30
        self.w2 = settings.weight_contradiction        # 0.30
        self.w3 = settings.weight_source_coverage      # 0.15
        self.w4 = settings.weight_claim_importance     # 0.10
        self.w5 = settings.weight_source_agreement     # 0.10
        self.w6 = settings.weight_evidence_count       # 0.05

    def score_claims(
        self, results: list[ClaimVerificationResult]
    ) -> list[ClaimVerificationResult]:
        """
        Compute risk scores for all verified claims.
        
        Modifies results in-place and returns them.
        """
        for result in results:
            if result.status == ClaimStatus.SKIPPED:
                result.risk_score = 0
                continue
            result.risk_score = self._compute_claim_risk(result)

        return results

    def compute_overall_risk(
        self, results: list[ClaimVerificationResult]
    ) -> float:
        """
        Compute the overall response risk score (0-100).
        
        Weighted average by claim importance, with hard floors for
        critical contradictions and high unverifiable ratios.
        """
        # Filter to only scored claims (not skipped)
        scored = [r for r in results if r.status != ClaimStatus.SKIPPED]

        if not scored:
            return 0.0

        # Weighted average by importance
        total_weight = sum(r.claim.importance for r in scored)
        if total_weight == 0:
            total_weight = len(scored)
            weighted_sum = sum(r.risk_score for r in scored)
        else:
            weighted_sum = sum(
                r.risk_score * r.claim.importance for r in scored
            )

        overall = weighted_sum / total_weight

        # Hard floor: any strong contradiction → minimum 70
        has_critical_contradiction = any(
            r.max_contradiction_score > 0.9 for r in scored
        )
        if has_critical_contradiction:
            overall = max(overall, 70.0)

        # Boost: many unverifiable claims → minimum 60
        unverifiable = [r for r in scored if r.status == ClaimStatus.UNVERIFIED]
        unverifiable_ratio = len(unverifiable) / len(scored)
        if unverifiable_ratio > 0.5:
            overall = max(overall, 60.0)

        return round(min(overall, 100.0), 1)

    def get_risk_level(self, score: float) -> RiskLevel:
        """Map a risk score to a risk level."""
        if score <= 25:
            return RiskLevel.LOW
        elif score <= 50:
            return RiskLevel.MODERATE
        elif score <= 75:
            return RiskLevel.HIGH
        else:
            return RiskLevel.CRITICAL

    def get_risk_color(self, level: RiskLevel) -> str:
        """Get hex color for a risk level."""
        colors = {
            RiskLevel.LOW: "#22C55E",       # Green
            RiskLevel.MODERATE: "#EAB308",   # Amber
            RiskLevel.HIGH: "#F97316",       # Orange
            RiskLevel.CRITICAL: "#EF4444",   # Red
        }
        return colors.get(level, "#6B7280")

    def get_warning_message(self, level: RiskLevel) -> str:
        """Get the default warning message for a risk level."""
        messages = {
            RiskLevel.LOW: "Response appears well-grounded",
            RiskLevel.MODERATE: "Some claims could not be fully verified",
            RiskLevel.HIGH: "Multiple unverified or questionable claims detected",
            RiskLevel.CRITICAL: "Response contains likely hallucinated content",
        }
        return messages.get(level, "Unknown risk level")

    def generate_warnings(
        self, results: list[ClaimVerificationResult]
    ) -> list[Warning]:
        """Generate contextual warnings for flagged claims."""
        warnings = []

        for result in results:
            if result.status == ClaimStatus.SKIPPED:
                continue

            # No evidence found
            if not result.evidence and result.status == ClaimStatus.UNVERIFIED:
                warnings.append(Warning(
                    type="no_source",
                    message=f'No verifiable source found for: "{result.claim.text[:100]}"',
                    claim_id=result.claim.id,
                ))

            # Contradiction detected
            elif result.status == ClaimStatus.CONTRADICTED:
                # Find the source that contradicted
                for ev in result.evidence:
                    if ev.nli_scores and ev.nli_scores.get("contradiction", 0) > 0.7:
                        source_ref = ev.source_url or ev.source_title or "unknown source"
                        warnings.append(Warning(
                            type="contradiction",
                            message=f'Contradicts information from: {source_ref}',
                            claim_id=result.claim.id,
                            source_url=ev.source_url,
                        ))
                        break  # One warning per contradicted claim

            # Statistical claim with low support
            elif (
                result.claim.type.value == "statistical"
                and result.max_entailment_score < 0.5
            ):
                warnings.append(Warning(
                    type="unverified_statistic",
                    message=f'Statistical claim could not be verified: "{result.claim.text[:100]}"',
                    claim_id=result.claim.id,
                ))

            # Sources disagree
            elif result.source_agreement_variance > 0.3:
                warnings.append(Warning(
                    type="source_disagreement",
                    message=f'Sources disagree on: "{result.claim.text[:80]}" — check linked sources',
                    claim_id=result.claim.id,
                ))

        return warnings

    def _compute_claim_risk(self, result: ClaimVerificationResult) -> float:
        """Compute the risk score for a single claim (0-100)."""
        # Normalize evidence count (0 = bad, 5+ = good)
        evidence_count_norm = min(len(result.evidence) / 5.0, 1.0)

        raw_score = (
            self.w1 * (1.0 - result.max_entailment_score)
            + self.w2 * result.max_contradiction_score
            + self.w3 * (1.0 - result.source_coverage)
            + self.w4 * result.claim.importance
            + self.w5 * result.source_agreement_variance
            + self.w6 * (1.0 - evidence_count_norm)
        ) * 100.0

        return round(min(max(raw_score, 0.0), 100.0), 1)


# ── Module-level singleton ────────────────────────────────────────────────

_scorer: Optional[RiskScorer] = None


def get_risk_scorer() -> RiskScorer:
    """Get or create the risk scorer singleton."""
    global _scorer
    if _scorer is None:
        _scorer = RiskScorer()
    return _scorer
