"""
Pydantic schemas for the /documents endpoint.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class DocumentUploadResponse(BaseModel):
    """Response after uploading a document."""
    id: str
    filename: str
    file_type: str
    file_size_bytes: int
    chunk_count: int
    created_at: datetime


class DocumentResponse(BaseModel):
    """Response for GET /documents/{id}."""
    id: str
    conversation_id: Optional[str]
    filename: str
    file_type: str
    file_size_bytes: int
    chunk_count: int
    created_at: datetime


class DocumentListResponse(BaseModel):
    """Response listing multiple documents."""
    documents: list[DocumentResponse]
    total: int
