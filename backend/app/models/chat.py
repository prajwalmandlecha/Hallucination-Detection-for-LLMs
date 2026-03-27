"""
Pydantic schemas for the /chat endpoint.
"""

from pydantic import BaseModel, Field
from typing import Optional


class ChatMessage(BaseModel):
    """A single message in the chat history."""
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Message content")


class ChatRequest(BaseModel):
    """Request body for POST /api/v1/chat."""
    conversation_id: Optional[str] = Field(None, description="Conversation UUID")
    model_id: str = Field(..., description="LLM model to chat with")
    message: str = Field(..., description="User's message")
    conversation_history: list[ChatMessage] = Field(
        default_factory=list,
        description="Previous conversation messages",
    )
    stream: bool = Field(True, description="Whether to stream the response")


class ChatResponse(BaseModel):
    """Response from POST /api/v1/chat (non-streaming)."""
    conversation_id: str
    model_id: str
    response: str = Field(..., description="Model's response text")
    usage: Optional[dict] = Field(None, description="Token usage stats if available")
