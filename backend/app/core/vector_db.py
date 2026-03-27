"""
Semantic search utilities for querying pgvector document chunks.
"""

import logging
from typing import List, Tuple
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.engine import get_db_session
from app.db.models import DocumentChunk, Document
from app.core.embeddings import get_embedding_pipeline

logger = logging.getLogger(__name__)

async def semantic_search_documents(
    query_text: str,
    document_ids: List[str],
    top_k: int = 3,
) -> List[dict]:
    """
    Search pgvector for the top_k chunks across the specified document_ids
    that best match the given query_text using L2 distance.
    """
    if not document_ids:
        return []

    embedder = get_embedding_pipeline()
    try:
        embeddings = await embedder.embed_texts([query_text])
        if not embeddings:
            return []
        query_embedding = embeddings[0]
    except Exception as e:
        logger.error(f"Failed to generate query embedding: {e}")
        return []

    # Requires an active db session
    try:
        # FastAPI Depends is usually for routes. Here we create our own session scope
        from app.db.engine import async_session_maker
        async with async_session_maker() as session:
            # Query top_k most similar chunks from the specified documents
            stmt = (
                select(DocumentChunk, Document.filename)
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(DocumentChunk.document_id.in_(document_ids))
                .order_by(DocumentChunk.embedding.l2_distance(query_embedding))
                .limit(top_k)
            )
            result = await session.execute(stmt)
            rows = result.all()
            
            # Format results
            evidence_results = []
            for chunk, filename in rows:
                evidence_results.append({
                    "document_id": chunk.document_id,
                    "document_name": filename,
                    "chunk_index": chunk.chunk_index,
                    "text_content": chunk.text_content,
                })
            
            return evidence_results
    except Exception as e:
        logger.error(f"Failed to search pgvector: {e}")
        return []
