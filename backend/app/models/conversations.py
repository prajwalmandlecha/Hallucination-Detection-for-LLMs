"""
Pydantic schemas for the /conversations endpoint.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ── Existing Models ───────────────────────────────────────────────────────


class ConversationCreate(BaseModel):
    """Request to create a new conversation."""
    metadata: Optional[dict] = Field(None, description="Optional conversation metadata")
    platform: Optional[str] = Field(None, description="Source platform: 'frontend', 'chatgpt', 'claude', etc.")
    title: Optional[str] = Field(None, description="Conversation title")


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
    model_id: Optional[str] = None
    external_id: Optional[str] = None
    message_index: Optional[int] = None
    role_index: Optional[int] = None
    created_at: datetime


class ConversationResponse(BaseModel):
    """Full conversation with messages."""
    id: str
    external_id: Optional[str] = None
    platform: Optional[str] = None
    title: Optional[str] = None
    external_url: Optional[str] = None
    messages: list[MessageResponse] = Field(default_factory=list)
    metadata: Optional[dict] = None
    created_at: datetime
    updated_at: datetime


# ── Sync Models (for extensions and external API consumers) ──────────────


class SyncMessage(BaseModel):
    """A message from any external platform to sync."""
    role: str = Field(..., description="'user' or 'assistant'")
    text: str = Field(..., description="Message content")
    external_id: Optional[str] = Field(None, description="Platform's message ID (e.g., 'user-8', 'assistant-3')")
    message_index: Optional[int] = Field(None, description="Position in full conversation")
    role_index: Optional[int] = Field(None, description="Nth message of this role")
    model_id: Optional[str] = Field(None, description="Model that generated this")
    sources: list[dict] = Field(default_factory=list, description="Platform's source citations")


class ConversationSyncRequest(BaseModel):
    """
    Sync a conversation from any external platform.
    
    Upserts: finds existing conversation by (external_id, platform) or creates new.
    Only inserts new messages (dedupes by external_id within conversation).
    """
    platform: str = Field(..., description="'chatgpt', 'claude', 'gemini', 'deepseek', 'copilot'")
    external_id: str = Field(..., description="Platform's conversation ID")
    title: Optional[str] = None
    external_url: Optional[str] = None
    messages: list[SyncMessage] = Field(default_factory=list)


class ConversationSyncResponse(BaseModel):
    """Response from POST /conversations/sync."""
    conversation_id: str = Field(..., description="Our internal conversation UUID")
    platform: str
    external_id: str
    messages_synced: int = Field(0, description="How many NEW messages were added")
    total_messages: int = Field(0, description="Total messages in conversation")
    document_ids: list[str] = Field(default_factory=list, description="Attached document IDs")
