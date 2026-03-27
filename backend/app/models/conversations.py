"""
Pydantic schemas for the /conversations endpoint.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ConversationCreate(BaseModel):
    """Request to create a new conversation."""
    metadata: Optional[dict] = Field(None, description="Optional conversation metadata")


class MessageAdd(BaseModel):
    """Request to add a message to a conversation."""
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Message text")
    model_id: Optional[str] = Field(None, description="Model ID (for assistant messages)")


class MessageResponse(BaseModel):
    """A message in the conversation."""
    id: str
    role: str
    content: str
    model_id: Optional[str]
    created_at: datetime


class ConversationResponse(BaseModel):
    """Full conversation with messages."""
    id: str
    messages: list[MessageResponse] = Field(default_factory=list)
    metadata: Optional[dict] = None
    created_at: datetime
    updated_at: datetime
