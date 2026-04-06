"""
Document management API endpoints.

POST   /api/v1/documents/upload  — Upload & process a document
GET    /api/v1/documents/{id}    — Get document metadata
DELETE /api/v1/documents/{id}    — Delete document

Backed by PostgreSQL and pgvector for semantic search.
"""

import logging
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from app.models.documents import DocumentUploadResponse
from app.core.document_processor import get_document_processor
from app.core.embeddings import get_embedding_pipeline
from app.db.engine import get_db_session
from app.db.models import Document, DocumentChunk

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/documents/upload", response_model=DocumentUploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    conversation_id: str = Form(None),
    external_conversation_id: str = Form(None),
    platform: str = Form(None),
    conversation_url: str = Form(None),
    conversation_title: str = Form(None),
    capture_source: str = Form(None),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Upload a document for use as a verification source.
    
    Supports two identification methods:
    - `conversation_id`: Direct internal ID (frontend)
    - `external_conversation_id` + `platform`: External platform ID (extension)
    
    The document is processed: text extracted → chunked → embedded via SentenceTransformers natively → stored in pgvector.
    Returns a document_id to include in /detect requests.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Resolve conversation_id from either direct ID or external ID
    if not conversation_id and external_conversation_id and platform:
        from app.api.conversations import find_or_create_conversation
        conv, _ = await find_or_create_conversation(
            db=db,
            external_id=external_conversation_id,
            platform=platform,
            title=conversation_title,
            external_url=conversation_url,
        )
        conversation_id = conv.id
        logger.info(f"Resolved {platform}/{external_conversation_id} → {conversation_id}")

    if not conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id or (external_conversation_id + platform) is required")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    # 1. Process Document (Extract Text & Chunk)
    processor = get_document_processor()
    processed = await processor.process(
        content=content,
        filename=file.filename,
        file_type=file.content_type or file.filename.split(".")[-1],
    )

    now = datetime.now(timezone.utc)
    
    # 2. Create Document DB entry
    db_doc = Document(
        conversation_id=conversation_id,
        filename=processed.filename,
        content_type=processed.file_type,
        uploaded_at=now,
    )
    db.add(db_doc)
    await db.flush() # flush to get db_doc.id

    # 3. Generate Embeddings for Chunks
    if processed.chunks:
        embedder = get_embedding_pipeline()
        chunk_texts = [chunk.content for chunk in processed.chunks]
        try:
            embeddings = await embedder.embed_texts(chunk_texts)
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to generate embeddings: {e}")

        # 4. Store Chunks in DB (pgvector)
        db_chunks = []
        for i, (chunk, embedding) in enumerate(zip(processed.chunks, embeddings)):
            db_chunk = DocumentChunk(
                document_id=db_doc.id,
                chunk_index=i,
                text_content=chunk.content,
                embedding=embedding,
            )
            db_chunks.append(db_chunk)
        
        db.add_all(db_chunks)

    await db.commit()
    logger.info(f"Document uploaded & embedded: {file.filename} → {db_doc.id} ({len(processed.chunks)} chunks)")

    return DocumentUploadResponse(
        id=db_doc.id,
        filename=processed.filename,
        file_type=processed.file_type,
        file_size_bytes=processed.file_size_bytes,
        chunk_count=len(processed.chunks),
        created_at=now,
    )


@router.get("/documents/{doc_id}")
async def get_document(doc_id: str, db: AsyncSession = Depends(get_db_session)):
    """Get document metadata by ID."""
    query = select(Document).where(Document.id == doc_id)
    result = await db.execute(query)
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Count chunks
    from sqlalchemy import func
    count_query = select(func.count(DocumentChunk.id)).where(DocumentChunk.document_id == doc_id)
    count_result = await db.execute(count_query)
    chunk_count = count_result.scalar() or 0

    return {
        "id": doc.id,
        "conversation_id": doc.conversation_id,
        "filename": doc.filename,
        "file_type": doc.content_type,
        "file_size_bytes": 0,  # File size isn't stored in DB schema currently
        "chunk_count": chunk_count,
        "created_at": doc.uploaded_at.isoformat(),
    }


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, db: AsyncSession = Depends(get_db_session)):
    """Delete a document and its chunks."""
    query = select(Document).where(Document.id == doc_id)
    result = await db.execute(query)
    doc = result.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    await db.delete(doc)
    await db.commit()
    logger.info(f"Document deleted: {doc_id}")
    return {"status": "deleted", "id": doc_id}
