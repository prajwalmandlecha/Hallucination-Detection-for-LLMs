"""
Multi-source verification orchestrator.

Coordinates parallel claim verification across multiple sources:
- Conversation history (NER entity graph)
- Vector DB (user-uploaded documents)  
- Web search (Tavily API)

Then runs NLI verification on all (claim, evidence) pairs.
"""

import asyncio
import logging
from typing import Optional

from app.config import get_settings
from app.models.detect import (
    ExtractedClaim,
    EvidencePiece,
    ClaimVerificationResult,
    ClaimStatus,
    NLILabel,
    SourceType,
    ConversationMessage,
)
from app.core.nli_model import get_nli_model
from app.core.web_search import get_web_searcher
from app.core.ner_extractor import NERResult
from app.core.vector_db import semantic_search_documents

logger = logging.getLogger(__name__)


class ClaimVerifier:
    """
    Orchestrates multi-source verification for extracted claims.
    
    For each claim:
    1. Gather evidence from applicable sources in parallel
    2. Run NLI on all (claim, evidence) pairs in a batch
    3. Compute per-claim verification results
    """

    def __init__(self):
        self.settings = get_settings()
        self.web_searcher = get_web_searcher()
        self.nli_model = get_nli_model()

    async def verify_claims(
        self,
        claims: list[ExtractedClaim],
        conversation_history: Optional[list[ConversationMessage]] = None,
        ner_result: Optional[NERResult] = None,
        document_ids: Optional[list[str]] = None,
        config: Optional[dict] = None,
    ) -> list[ClaimVerificationResult]:
        """
        Verify a list of claims against multiple sources.
        
        Args:
            claims: Extracted claims to verify.
            conversation_history: Conversation messages for context checks.
            ner_result: NER extraction result for entity graph queries.
            document_ids: IDs of user-uploaded documents.
            config: Detection config overrides.
            
        Returns:
            List of ClaimVerificationResult for each claim.
        """
        if not claims:
            return []

        threshold = self.settings.claim_confidence_threshold
        check_web = config.get("check_web", True) if config else True
        check_conv = config.get("check_conversation", True) if config else True
        check_docs = config.get("check_documents", True) if config else True

        # ── Step 1: Gather evidence for all claims in parallel ────────
        evidence_tasks = []
        claim_indices = []  # Track which claims are being verified vs skipped

        for i, claim in enumerate(claims):
            if claim.confidence_needs_checking < threshold:
                logger.debug(f"Skipping claim {claim.id}: confidence {claim.confidence_needs_checking} < {threshold}")
                continue

            claim_indices.append(i)
            evidence_tasks.append(
                self._gather_evidence_for_claim(
                    claim=claim,
                    conversation_history=conversation_history,
                    ner_result=ner_result,
                    document_ids=document_ids,
                    check_web=check_web,
                    check_conv=check_conv,
                    check_docs=check_docs,
                )
            )

        # Run all evidence gathering in parallel
        evidence_results = await asyncio.gather(*evidence_tasks, return_exceptions=True)

        # ── Step 2: Run NLI on all (claim, evidence) pairs ────────────
        # Collect all pairs for batch inference
        all_nli_pairs = []
        pair_mapping = []  # (claim_idx_in_results, evidence_idx)

        for result_idx, (claim_idx, evidence_result) in enumerate(zip(claim_indices, evidence_results)):
            if isinstance(evidence_result, Exception):
                logger.error(f"Evidence gathering failed for claim {claims[claim_idx].id}: {evidence_result}")
                continue

            evidence_list, sources_checked = evidence_result
            for ev_idx, evidence in enumerate(evidence_list):
                all_nli_pairs.append((evidence.snippet, claims[claim_idx].text))
                pair_mapping.append((result_idx, claim_idx, ev_idx))

        # Batch NLI inference
        nli_results = []
        if all_nli_pairs and self.nli_model.is_loaded:
            try:
                nli_results = await self.nli_model.predict(all_nli_pairs)
            except Exception as e:
                logger.error(f"NLI batch inference failed: {e}")
                nli_results = [{"entailment": 0.0, "contradiction": 0.0, "neutral": 1.0}] * len(all_nli_pairs)

        # ── Step 3: Assemble results ──────────────────────────────────
        # Map NLI results back to evidence pieces
        nli_idx = 0
        evidence_by_claim: dict[int, tuple[list[EvidencePiece], list[SourceType]]] = {}

        for result_idx, (claim_idx, evidence_result) in enumerate(zip(claim_indices, evidence_results)):
            if isinstance(evidence_result, Exception):
                evidence_by_claim[claim_idx] = ([], [])
                continue

            evidence_list, sources_checked = evidence_result
            for ev_idx, evidence in enumerate(evidence_list):
                if nli_idx < len(nli_results):
                    scores = nli_results[nli_idx]
                    evidence.nli_scores = scores
                    evidence.nli_label = NLILabel(self.nli_model.get_label(scores))
                    nli_idx += 1

            evidence_by_claim[claim_idx] = (evidence_list, sources_checked)

        # Build final results
        results = []
        for i, claim in enumerate(claims):
            if claim.confidence_needs_checking < threshold:
                # Skipped claim
                results.append(ClaimVerificationResult(
                    claim=claim,
                    risk_score=0,
                    status=ClaimStatus.SKIPPED,
                ))
                continue

            evidence_list, sources_checked = evidence_by_claim.get(i, ([], []))
            result = self._build_verification_result(claim, evidence_list, sources_checked)
            results.append(result)

        return results

    async def _gather_evidence_for_claim(
        self,
        claim: ExtractedClaim,
        conversation_history: Optional[list[ConversationMessage]],
        ner_result: Optional[NERResult],
        document_ids: Optional[list[str]],
        check_web: bool,
        check_conv: bool,
        check_docs: bool,
    ) -> tuple[list[EvidencePiece], list[SourceType]]:
        """Gather evidence from all applicable sources for a single claim."""
        tasks = []
        source_keys = []
        sources_checked = []

        # Conversation history check
        if check_conv and conversation_history and ner_result:
            tasks.append(self._check_conversation(claim, conversation_history, ner_result))
            source_keys.append(SourceType.CONVERSATION_HISTORY)
            sources_checked.append(SourceType.CONVERSATION_HISTORY)

        # Web search check
        should_check_web = (
            check_web
            and self.web_searcher.client
            and SourceType.WEB_SEARCH in claim.suggested_sources
        )
        if should_check_web:
            tasks.append(self.web_searcher.search_for_claim(
                claim_text=claim.text,
                search_queries=claim.search_queries,
                max_results=3,
            ))
            source_keys.append(SourceType.WEB_SEARCH)
            sources_checked.append(SourceType.WEB_SEARCH)

        # Vector DB check
        if check_docs and document_ids and SourceType.VECTOR_DB in claim.suggested_sources:
            tasks.append(self._check_vector_db(claim, document_ids))
            source_keys.append(SourceType.VECTOR_DB)
            sources_checked.append(SourceType.VECTOR_DB)

        if not tasks:
            return [], sources_checked

        # Run all source checks in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_evidence = []
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Source check failed: {result}")
                continue
            if isinstance(result, list):
                all_evidence.extend(result)

        return all_evidence, sources_checked

    async def _check_conversation(
        self,
        claim: ExtractedClaim,
        conversation_history: list[ConversationMessage],
        ner_result: NERResult,
    ) -> list[EvidencePiece]:
        """Check claim against conversation history using NER entities."""
        evidence = []

        # Find relevant context in conversation using claim's key entities
        context_items = ner_result.get_context_around_entities(
            claim.key_entities, conversation_history
        )

        for msg_idx, msg_content in context_items[:3]:  # Limit to 3 context items
            evidence.append(EvidencePiece(
                source_type=SourceType.CONVERSATION_HISTORY,
                message_index=msg_idx,
                snippet=msg_content[:500],  # Cap snippet length
                source_title=f"Conversation message #{msg_idx + 1}",
            ))

        return evidence

    async def _check_vector_db(
        self,
        claim: ExtractedClaim,
        document_ids: list[str],
    ) -> list[EvidencePiece]:
        """Check claim against pre-embedded documents using pgvector semantic search."""
        evidence = []
        
        results = await semantic_search_documents(
            query_text=claim.text,
            document_ids=document_ids,
            top_k=3
        )
        
        for res in results:
            evidence.append(EvidencePiece(
                source_type=SourceType.VECTOR_DB,
                document_name=res["document_name"],
                chunk_index=res["chunk_index"],
                snippet=res["text_content"],
                source_title=f"Doc chunk from {res['document_name']} (Chunk {res['chunk_index']})",
            ))

        return evidence

    def _build_verification_result(
        self,
        claim: ExtractedClaim,
        evidence: list[EvidencePiece],
        sources_checked: list[SourceType],
    ) -> ClaimVerificationResult:
        """Build a ClaimVerificationResult from evidence and NLI scores."""
        if not evidence:
            return ClaimVerificationResult(
                claim=claim,
                risk_score=65.0,  # High risk if no evidence found
                status=ClaimStatus.UNVERIFIED,
                sources_checked=sources_checked,
                source_coverage=0.0,
            )

        # Aggregate NLI scores across evidence
        entailment_scores = []
        contradiction_scores = []
        for ev in evidence:
            if ev.nli_scores:
                entailment_scores.append(ev.nli_scores.get("entailment", 0))
                contradiction_scores.append(ev.nli_scores.get("contradiction", 0))

        max_entailment = max(entailment_scores) if entailment_scores else 0.0
        max_contradiction = max(contradiction_scores) if contradiction_scores else 0.0

        # Source coverage: fraction of checked sources that returned evidence
        sources_with_evidence = set()
        for ev in evidence:
            sources_with_evidence.add(ev.source_type)
        source_coverage = (
            len(sources_with_evidence) / len(sources_checked)
            if sources_checked
            else 0.0
        )

        # Source agreement variance
        if len(entailment_scores) > 1:
            import numpy as np
            agreement_variance = float(np.var(entailment_scores))
        else:
            agreement_variance = 0.0

        # Determine status
        if max_contradiction > 0.7:
            status = ClaimStatus.CONTRADICTED
        elif max_entailment > 0.6:
            status = ClaimStatus.VERIFIED
        else:
            status = ClaimStatus.UNVERIFIED

        return ClaimVerificationResult(
            claim=claim,
            status=status,
            max_entailment_score=max_entailment,
            max_contradiction_score=max_contradiction,
            source_coverage=source_coverage,
            source_agreement_variance=agreement_variance,
            evidence=evidence,
            sources_checked=sources_checked,
            # risk_score computed later by RiskScorer
        )


# ── Module-level singleton ────────────────────────────────────────────────

_verifier: Optional[ClaimVerifier] = None


def get_claim_verifier() -> ClaimVerifier:
    """Get or create the claim verifier singleton."""
    global _verifier
    if _verifier is None:
        _verifier = ClaimVerifier()
    return _verifier
