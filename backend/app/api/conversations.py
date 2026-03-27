"""
Conversation management API endpoints.

POST /api/v1/conversations           — Create a new conversation
GET  /api/v1/conversations/{id}      — Get conversation with messages
POST /api/v1/conversations/{id}/messages — Add a message

Backed by PostgreSQL.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.conversations import (
    ConversationCreate,
    MessageAdd,
    MessageResponse,
    ConversationResponse,
)
from app.db.engine import get_db_session
from app.db.models import Conversation, Message

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/conversations", response_model=ConversationResponse)
async def create_conversation(
    request: ConversationCreate = None,
    db: AsyncSession = Depends(get_db_session)
):
    """Create a new conversation."""
    now = datetime.now(timezone.utc)

    db_conv = Conversation(
        metadata_json=request.metadata if request and request.metadata else {},
        created_at=now,
        updated_at=now,
    )
    
    db.add(db_conv)
    await db.commit()
    await db.refresh(db_conv)

    logger.info(f"Conversation created: {db_conv.id}")

    return ConversationResponse(
        id=db_conv.id,
        messages=[],
        metadata=db_conv.metadata_json,
        created_at=db_conv.created_at,
        updated_at=db_conv.updated_at,
    )


@router.get("/conversations/{conv_id}", response_model=ConversationResponse)
async def get_conversation(conv_id: str, db: AsyncSession = Depends(get_db_session)):
    """Get a conversation with all its messages."""
    query = (
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conv_id)
    )
    result = await db.execute(query)
    conv = result.scalar_one_or_none()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = [
        MessageResponse(
            id=msg.id,
            role=msg.role,
            content=msg.content,
            model_id=None, # model_id wasn't stored in base Message model schema
            created_at=msg.created_at,
        )
        for msg in conv.messages
    ]

    return ConversationResponse(
        id=conv.id,
        messages=messages,
        metadata=conv.metadata_json,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
    )


@router.post("/conversations/{conv_id}/messages", response_model=MessageResponse)
async def add_message(
    conv_id: str, 
    request: MessageAdd,
    db: AsyncSession = Depends(get_db_session)
):
    """Add a message to an existing conversation."""
    # Verify conversation exists
    query = select(Conversation).where(Conversation.id == conv_id)
    result = await db.execute(query)
    conv = result.scalar_one_or_none()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    now = datetime.now(timezone.utc)

    db_msg = Message(
        conversation_id=conv_id,
        role=request.role,
        content=request.content,
        created_at=now,
    )
    
    # Update conversation updated_at
    conv.updated_at = now
    
    db.add(db_msg)
    await db.commit()
    await db.refresh(db_msg)

    return MessageResponse(
        id=db_msg.id,
        role=db_msg.role,
        content=db_msg.content,
        model_id=request.model_id,
        created_at=db_msg.created_at,
    )
