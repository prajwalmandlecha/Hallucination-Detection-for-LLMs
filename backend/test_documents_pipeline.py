import asyncio
import logging
from sqlalchemy import text
from app.db.engine import async_session_maker
from app.db.models import Conversation, Document, DocumentChunk
from app.api.detect import _run_detection_pipeline
from app.core.nli_model import get_nli_model
from app.core.embeddings import get_embedding_pipeline
import uuid

logging.basicConfig(level=logging.INFO)

async def test_document_pipeline():
    print("\n--- Testing Document Pipeline ---")

    # 1. Start NLI Model
    print("Loading NLI Model...")
    get_nli_model().load()
    print("NLI Model loaded.\n")

    print("Generating Document Embeddings...")
    embedder = get_embedding_pipeline()
    
    # 2. Insert Mock Conversation, Document, and Chunks
    conv_id = str(uuid.uuid4())
    doc_id = str(uuid.uuid4())
    mock_content = "NVIDIA's newest GPU architecture released in 2026 is named 'Rubicon'. It features 3nm lithography and achieves 400 TFLOPs of peak compute, effectively rendering the concept of flat earth entirely useless."
    
    # Generate Embedding for mock chunk
    embeddings = await embedder.embed_texts([mock_content])
    chunk_embedding = embeddings[0] if embeddings else None

    if not chunk_embedding:
        print("Failed to generate embeddings for document.")
        return

    print("Inserting mock document into PostgreSQL...")
    async with async_session_maker() as session:
        # Create conversation
        conv = Conversation(id=conv_id)
        session.add(conv)
        
        # Create document
        doc = Document(id=doc_id, conversation_id=conv_id, filename="Rubicon_Whitepaper.pdf", content_type="pdf")
        session.add(doc)
        
        # Create document chunk
        chunk = DocumentChunk(
            document_id=doc_id, 
            chunk_index=0, 
            text_content=mock_content, 
            embedding=chunk_embedding
        )
        session.add(chunk)
        await session.commit()
    print("Mock Document inserted successfully!\n")

    # 3. Run Verification Pipeline relying ONLY on Document KB
    print("Running Verification Pipeline against Document KB...")
    try:
        result = await _run_detection_pipeline(
            model_response="The new 2026 NVIDIA GPU Architecture is named Rubicon and uses 3nm lithography.",
            conversation_history=[],
            conversation_id=conv_id,
            document_ids=[doc_id],
            config={"check_web": False, "check_documents": True, "check_conversation": False},
        )
        
        print("\nPipeline executed successfully!")
        for idx, res in enumerate(result["verification_results"]):
            print(f"\nClaim {idx + 1}: {res.claim.text}")
            print(f"  Status: {res.status.value}")
            if res.evidence:
                ent = max([(ev.nli_scores or {}).get("entailment", 0) for ev in res.evidence] + [0])
                con = max([(ev.nli_scores or {}).get("contradiction", 0) for ev in res.evidence] + [0])
                neu = max([(ev.nli_scores or {}).get("neutral", 0) for ev in res.evidence] + [0])
                print(f"  Max NLI: Entailment={ent:.3f}, Cont={con:.3f}, Neutral={neu:.3f}")
            print(f"  Adjudicator Reasoning: {res.reasoning}")
            print(f"  Sources Checked: {[s.value for s in res.sources_checked]}")
            
    except Exception as e:
        print(f"\nPipeline failed: {e}")
        import traceback
        traceback.print_exc()
        
    print("\nCleaning up mock data...")
    async with async_session_maker() as session:
        await session.execute(text(f"DELETE FROM conversations WHERE id = '{conv_id}'"))
        await session.commit()
    print("Cleanup complete.")

if __name__ == "__main__":
    asyncio.run(test_document_pipeline())
