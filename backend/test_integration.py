import asyncio
import logging
from sqlalchemy import text
from app.db.engine import async_session_maker
from app.models.detect import DetectionRequest, ConversationMessage, DetectionConfig
from app.api.detect import _run_detection_pipeline
from app.core.nli_model import get_nli_model

logging.basicConfig(level=logging.INFO)

async def test_backend():
    print("Testing DB Connection...")
    async with async_session_maker() as session:
        # Just test DB connects
        await session.execute(text("SELECT 1"))
    print("DB connection successful.\n")

    print("Loading NLI Model...")
    get_nli_model().load()
    print("NLI Model loaded.\n")

    print("Running V2 Detection Pipeline Test (Single Mode)...")
    
    # Mock a single request
    model_response = "The capital of France is Paris. Also, the Earth is flat and the sun revolves around it."
    history = [
        ConversationMessage(role="user", content="Tell me some facts about the world.")
    ]
    
    try:
        pipeline_result = await _run_detection_pipeline(
            model_response=model_response,
            conversation_history=history,
            conversation_id="test-conv-uuid",
            document_ids=[],
            config={"check_web": True, "check_documents": False, "check_conversation": False},
        )
        
        print("\nPipeline executed successfully!")
        print(f"Overall Risk Score: {pipeline_result['overall_risk']}")
        print(f"Risk Level: {pipeline_result['risk_level']}")
        print(f"Extracted Claims: {len(pipeline_result['extracted_claims'])}")
        
        for idx, res in enumerate(pipeline_result["verification_results"]):
            print(f"\nClaim {idx + 1}: {res.claim.text}")
            print(f"  Domain: {res.claim.domain.value}")
            print(f"  Status: {res.status.value}")
            if res.evidence:
                ent = max([(ev.nli_scores or {}).get("entailment", 0) for ev in res.evidence] + [0])
                con = max([(ev.nli_scores or {}).get("contradiction", 0) for ev in res.evidence] + [0])
                neu = max([(ev.nli_scores or {}).get("neutral", 0) for ev in res.evidence] + [0])
                print(f"  Max NLI Scores: Entailment={ent:.3f}, Contradiction={con:.3f}, Neutral={neu:.3f}")
            print(f"  Adjudicator Reasoning: {res.reasoning}")
            print(f"  Sources Checked: {[s.value for s in res.sources_checked]}")
            
    except Exception as e:
        print(f"\nPipeline failed with error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_backend())
