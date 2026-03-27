"""
Detection API endpoint.

POST /api/v1/detect — Main hallucination detection pipeline.
"""

import asyncio
import time
import uuid
import logging

from fastapi import APIRouter, HTTPException

from app.models.detect import (
    DetectionRequest,
    DetectionResponse,
    DetectionMetadata,
    ClaimResultResponse,
    ClaimStatus,
)
from app.core.claim_extractor import get_claim_extractor
from app.core.ner_extractor import get_ner_extractor
from app.core.verifier import get_claim_verifier
from app.core.risk_scorer import get_risk_scorer

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/detect", response_model=DetectionResponse)
async def detect_hallucinations(request: DetectionRequest):
    """
    Detect hallucinations in an AI-generated response.
    
    Pipeline:
    1. Parallel: NER extraction + Claim extraction (LLM)
    2. Multi-source verification (conversation, docs, web) per claim
    3. NLI classification for all (claim, evidence) pairs
    4. Risk score aggregation
    5. Warning generation
    """
    start_time = time.time()
    response_id = str(uuid.uuid4())

    logger.info(f"Detection request {response_id}: model={request.model_id}, "
                f"response_length={len(request.model_response)}")

    try:
        # ── Step 1: Parallel extraction ───────────────────────────────
        claim_extractor = get_claim_extractor()
        ner_extractor = get_ner_extractor()

        has_documents = len(request.document_ids) > 0

        # Run NER and claim extraction in parallel
        ner_task = ner_extractor.extract(
            messages=request.conversation_history,
            conversation_id=request.conversation_id
        )
        claims_task = claim_extractor.extract_claims(
            ai_response=request.model_response,
            conversation_history=request.conversation_history,
            has_documents=has_documents,
        )

        ner_result, extracted_claims = await asyncio.gather(
            ner_task, claims_task
        )

        logger.info(f"Extracted {len(extracted_claims)} claims, "
                     f"{len(ner_result.entities)} NER entities")

        # ── Step 2 & 3: Multi-source verification + NLI ───────────────
        verifier = get_claim_verifier()
        verification_results = await verifier.verify_claims(
            claims=extracted_claims,
            conversation_history=request.conversation_history or None,
            ner_result=ner_result,
            document_ids=request.document_ids or None,
            config={
                "check_web": request.config.check_web,
                "check_documents": request.config.check_documents,
                "check_conversation": request.config.check_conversation,
            },
        )

        # ── Step 4: Risk score aggregation ────────────────────────────
        scorer = get_risk_scorer()
        verification_results = scorer.score_claims(verification_results)
        overall_risk = scorer.compute_overall_risk(verification_results)
        risk_level = scorer.get_risk_level(overall_risk)
        risk_color = scorer.get_risk_color(risk_level)
        warning_message = scorer.get_warning_message(risk_level)

        # ── Step 5: Generate warnings ─────────────────────────────────
        warnings = scorer.generate_warnings(verification_results)

        # ── Build response ────────────────────────────────────────────
        claims_response = []
        for result in verification_results:
            verification_details = {
                "entailment_score": result.max_entailment_score,
                "contradiction_score": result.max_contradiction_score,
                "sources_checked": [s.value for s in result.sources_checked],
                "evidence": [
                    {
                        "source_type": ev.source_type.value,
                        "source_url": ev.source_url,
                        "source_title": ev.source_title,
                        "document_name": ev.document_name,
                        "chunk_index": ev.chunk_index,
                        "message_index": ev.message_index,
                        "snippet": ev.snippet[:300],
                        "nli_label": ev.nli_label.value if ev.nli_label else None,
                        "nli_scores": ev.nli_scores,
                    }
                    for ev in result.evidence
                ],
            }

            claims_response.append(ClaimResultResponse(
                id=result.claim.id,
                text=result.claim.text,
                type=result.claim.type,
                risk_score=result.risk_score,
                status=result.status,
                suggested_sources=result.claim.suggested_sources,
                verification_details=verification_details,
            ))

        processing_time = int((time.time() - start_time) * 1000)
        claims_verified = len([r for r in verification_results if r.status != ClaimStatus.SKIPPED])
        claims_skipped = len([r for r in verification_results if r.status == ClaimStatus.SKIPPED])

        # Collect all unique source types queried
        all_sources = set()
        for r in verification_results:
            for s in r.sources_checked:
                all_sources.add(s.value)

        response = DetectionResponse(
            response_id=response_id,
            overall_risk_score=overall_risk,
            risk_level=risk_level,
            risk_color=risk_color,
            warning_message=warning_message,
            warnings=warnings,
            claims=claims_response,
            metadata=DetectionMetadata(
                processing_time_ms=processing_time,
                claims_extracted=len(extracted_claims),
                claims_verified=claims_verified,
                claims_skipped=claims_skipped,
                sources_queried=list(all_sources),
            ),
        )

        logger.info(
            f"Detection {response_id} complete: "
            f"risk={overall_risk} ({risk_level.value}), "
            f"claims={len(extracted_claims)}, "
            f"time={processing_time}ms"
        )

        return response

    except Exception as e:
        logger.error(f"Detection pipeline failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Hallucination detection failed: {str(e)}"
        )
