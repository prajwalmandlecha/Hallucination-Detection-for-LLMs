"""
Conversation management API endpoints.

POST /api/v1/conversations           — Create a new conversation
GET  /api/v1/conversations/{id}      — Get conversation with messages
POST /api/v1/conversations/{id}/messages — Add a message
POST /api/v1/conversations/sync      — Sync from external platform (extension/API)

Backed by PostgreSQL.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload

from app.models.conversations import (
    ConversationCreate,
    MessageAdd,
    MessageResponse,
    ConversationResponse,
    ConversationSyncRequest,
    ConversationSyncResponse,
)
from app.db.engine import get_db_session
from app.db.models import Conversation, Message, Document

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Helper: find or create conversation by external ID ────────────────────

async def find_or_create_conversation(
    db: AsyncSession,
    external_id: str,
    platform: str,
    title: str | None = None,
    external_url: str | None = None,
) -> tuple[Conversation, bool]:
    """
    Find a conversation by (external_id, platform) or create a new one.
    Returns (conversation, was_created).
    """
    query = select(Conversation).where(
        and_(
            Conversation.external_id == external_id,
            Conversation.platform == platform,
        )
    )
    result = await db.execute(query)
    conv = result.scalar_one_or_none()

    if conv:
        # Update metadata if provided
        if title and title != conv.title:
            conv.title = title
        if external_url and external_url != conv.external_url:
            conv.external_url = external_url
        conv.updated_at = datetime.now(timezone.utc)
        return conv, False

    # Create new
    now = datetime.now(timezone.utc)
    conv = Conversation(
        external_id=external_id,
        platform=platform,
        title=title,
        external_url=external_url,
        metadata_json={},
        created_at=now,
        updated_at=now,
    )
    db.add(conv)
    await db.flush()  # Get the generated ID
    return conv, True


# ── Helper: sync messages into a conversation ─────────────────────────────

async def sync_messages_to_conversation(
    db: AsyncSession,
    conversation: Conversation,
    messages: list,
    platform: str,
) -> int:
    """
    Upsert messages into a conversation. Deduplicates by external_id.
    Returns count of newly inserted messages.
    """
    if not messages:
        return 0

    # Get existing external_ids for this conversation
    existing_query = select(Message.external_id).where(
        and_(
            Message.conversation_id == conversation.id,
            Message.external_id.isnot(None),
        )
    )
    result = await db.execute(existing_query)
    existing_ext_ids = {row[0] for row in result.fetchall()}

    now = datetime.now(timezone.utc)
    new_count = 0

    for msg in messages:
        # Get the text content — support both 'text' (extension) and 'content' (frontend)
        content = getattr(msg, 'text', None) or getattr(msg, 'content', '')
        external_id = getattr(msg, 'external_id', None) or getattr(msg, 'id', None)
        
        if not content:
            continue

        # Skip if already synced (dedup by external_id)
        if external_id and external_id in existing_ext_ids:
            continue

        # Derive model_id for assistant messages from extension
        model_id = getattr(msg, 'model_id', None)
        if not model_id and msg.role == "assistant" and platform != "frontend":
            model_id = f"{platform}_extension"

        # Get platform sources
        sources = getattr(msg, 'sources', [])
        if isinstance(sources, list) and sources:
            # Convert Pydantic models to dicts if needed
            platform_sources = [
                s.model_dump() if hasattr(s, 'model_dump') else (s if isinstance(s, dict) else {})
                for s in sources
            ]
        else:
            platform_sources = []

        db_msg = Message(
            conversation_id=conversation.id,
            role=msg.role,
            content=content,
            external_id=external_id,
            message_index=getattr(msg, 'message_index', None) or getattr(msg, 'index', None),
            role_index=getattr(msg, 'role_index', None) or getattr(msg, 'roleIndex', None),
            model_id=model_id,
            platform_sources=platform_sources,
            created_at=now,
        )
        db.add(db_msg)
        new_count += 1

        if external_id:
            existing_ext_ids.add(external_id)

    if new_count > 0:
        conversation.updated_at = now

    return new_count


# ── Endpoints ─────────────────────────────────────────────────────────────


@router.post("/conversations", response_model=ConversationResponse)
async def create_conversation(
    request: ConversationCreate = None,
    db: AsyncSession = Depends(get_db_session)
):
    """Create a new conversation."""
    now = datetime.now(timezone.utc)

    db_conv = Conversation(
        metadata_json=request.metadata if request and request.metadata else {},
        platform=request.platform if request else "frontend",
        title=request.title if request else None,
        created_at=now,
        updated_at=now,
    )
    
    db.add(db_conv)
    await db.commit()
    await db.refresh(db_conv)

    logger.info(f"Conversation created: {db_conv.id}")

    return ConversationResponse(
        id=db_conv.id,
        external_id=db_conv.external_id,
        platform=db_conv.platform,
        title=db_conv.title,
        external_url=db_conv.external_url,
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
            model_id=msg.model_id,
            external_id=msg.external_id,
            message_index=msg.message_index,
            role_index=msg.role_index,
            created_at=msg.created_at,
        )
        for msg in conv.messages
    ]

    return ConversationResponse(
        id=conv.id,
        external_id=conv.external_id,
        platform=conv.platform,
        title=conv.title,
        external_url=conv.external_url,
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
        model_id=request.model_id,
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
        model_id=db_msg.model_id,
        created_at=db_msg.created_at,
    )


@router.post("/conversations/sync", response_model=ConversationSyncResponse)
async def sync_conversation(
    request: ConversationSyncRequest,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Sync a conversation from any external platform.
    
    This is the primary ingestion endpoint for browser extensions and external API consumers.
    - Finds existing conversation by (external_id, platform) or creates a new one
    - Only inserts NEW messages (deduplicates by external_id within conversation)
    - Returns the internal conversation_id for use in subsequent /detect calls
    
    Supported platforms: chatgpt, claude, gemini, deepseek, copilot
    """
    conv, was_created = await find_or_create_conversation(
        db=db,
        external_id=request.external_id,
        platform=request.platform,
        title=request.title,
        external_url=request.external_url,
    )

    new_count = await sync_messages_to_conversation(
        db=db,
        conversation=conv,
        messages=request.messages,
        platform=request.platform,
    )

    # Get total message count
    from sqlalchemy import func
    count_query = select(func.count(Message.id)).where(Message.conversation_id == conv.id)
    count_result = await db.execute(count_query)
    total_messages = count_result.scalar() or 0

    # Get document IDs
    doc_query = select(Document.id).where(Document.conversation_id == conv.id)
    doc_result = await db.execute(doc_query)
    doc_ids = [row[0] for row in doc_result.fetchall()]

    await db.commit()

    action = "Created" if was_created else "Updated"
    logger.info(f"{action} conversation {conv.id} ({request.platform}/{request.external_id}): "
                f"{new_count} new messages, {total_messages} total")

    return ConversationSyncResponse(
        conversation_id=conv.id,
        platform=request.platform,
        external_id=request.external_id,
        messages_synced=new_count,
        total_messages=total_messages,
        document_ids=doc_ids,
    )
