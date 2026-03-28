"""
SQLAlchemy models for the Database Layer.

Handles:
- Conversations & Messages (with external platform linking)
- Documents & Chunks (with pgvector embeddings)
- NER Entities (flat, per-conversation)
- Verification Results / History
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Text,
    DateTime,
    ForeignKey,
    Float,
    JSON,
    Boolean,
    Enum,
    Integer,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from app.models.detect import ClaimType, SourceType

Base = declarative_base()

def generate_uuid():
    return str(uuid.uuid4())

# ── Conversations ────────────────────────────────────────────────────────
class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # External platform linking — supports ChatGPT, Claude, Gemini, DeepSeek, Copilot
    external_id = Column(String(255), nullable=True, index=True)     # Platform's conversation ID
    platform = Column(String(50), nullable=True, index=True)          # "chatgpt", "claude", "gemini", "deepseek", "copilot", "frontend"
    title = Column(String(500), nullable=True)                        # Conversation title
    external_url = Column(String(2048), nullable=True)                # Original URL (e.g., https://chatgpt.com/c/...)
    
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Metadata (models used, tokens, etc.)
    metadata_json = Column(JSONB, default=dict)
    
    # Track last processed message index for incremental NER
    last_synced_message_index = Column(Integer, default=-1)

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at")
    documents = relationship("Document", back_populates="conversation")
    entities = relationship("ExtractedEntity", back_populates="conversation", cascade="all, delete-orphan")

    # Unique constraint: one conversation per (external_id, platform) pair
    __table_args__ = (
        UniqueConstraint("external_id", "platform", name="uq_conversation_external_platform"),
    )


class Message(Base):
    __tablename__ = "messages"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(50), nullable=False)  # 'user', 'assistant', 'system'
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # External platform tracking
    external_id = Column(String(255), nullable=True)       # "user-8", "assistant-8" (from extension)
    message_index = Column(Integer, nullable=True)          # Position in full conversation
    role_index = Column(Integer, nullable=True)             # Nth message of this role
    model_id = Column(String(100), nullable=True)           # Model that generated this (e.g., "chatgpt_extension")
    
    # Platform-provided source citations (web links in ChatGPT/Gemini responses)
    platform_sources = Column(JSONB, default=list)          # [{type, url, title, host}]
    
    # If the message has an AI hallucination analysis result attached
    analysis_result_id = Column(String(36), ForeignKey("analysis_results.id", ondelete="SET NULL"), nullable=True)

    conversation = relationship("Conversation", back_populates="messages")
    analysis_result = relationship("AnalysisResult", back_populates="message", uselist=False, foreign_keys=[analysis_result_id])

    # Unique constraint: one message per (conversation_id, external_id) pair
    __table_args__ = (
        UniqueConstraint("conversation_id", "external_id", name="uq_message_conversation_external"),
    )


# ── Documents & Embeddings ───────────────────────────────────────────────
class Document(Base):
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(100), nullable=False)
    uploaded_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    conversation = relationship("Conversation", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")

class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    document_id = Column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    text_content = Column(Text, nullable=False)
    
    # Using 768 dimensions for nomic-embed-text (Ollama default)
    # NOTE: Do NOT use index=True here — btree can't handle vectors.
    # Use HNSW or IVFFlat index separately for similarity search.
    embedding = Column(Vector(768))

    document = relationship("Document", back_populates="chunks")


# ── NER Entities (flat, per-conversation) ────────────────────────────────
class ExtractedEntity(Base):
    __tablename__ = "extracted_entities"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    label = Column(String(100), nullable=False)  # ORG, PERSON, GPE, DATE, etc.
    
    # What message it was extracted from
    source_message_id = Column(String(36), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="entities")


# ── Hallucination Detection Analysis ─────────────────────────────────────
class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    ai_response_text = Column(Text, nullable=False)
    overall_risk_score = Column(Float, nullable=False)
    risk_level = Column(String(50), nullable=False)  # LOW, MODERATE, HIGH, CRITICAL
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Store warnings as a JSON array of strings
    warnings = Column(JSONB, default=list)

    # Note: message relation defined in Message class using foreign key to here.
    message = relationship("Message", back_populates="analysis_result", primaryjoin="AnalysisResult.id == Message.analysis_result_id")
    claims = relationship("ClaimAnalysis", back_populates="analysis", cascade="all, delete-orphan")

class ClaimAnalysis(Base):
    __tablename__ = "claim_analyses"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    analysis_id = Column(String(36), ForeignKey("analysis_results.id", ondelete="CASCADE"), nullable=False, index=True)
    claim_text = Column(Text, nullable=False)
    claim_type = Column(String(50), nullable=False) # mapped from ClaimType enum
    importance_score = Column(Float, nullable=False)
    risk_score = Column(Float, nullable=False)
    verdict = Column(String(50), nullable=False) # SUPPORTED, CONTRADICTED, UNVERIFIED

    analysis = relationship("AnalysisResult", back_populates="claims")
    evidence = relationship("EvidenceItem", back_populates="claim_analysis", cascade="all, delete-orphan")

class EvidenceItem(Base):
    __tablename__ = "evidence_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    claim_analysis_id = Column(String(36), ForeignKey("claim_analyses.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(50), nullable=False) # web_search, vector_db, conversation_history
    source_title = Column(String(500), nullable=True)
    source_url = Column(String(2048), nullable=True)
    snippet = Column(Text, nullable=False)
    
    nli_entailment_prob = Column(Float, nullable=False)
    nli_contradiction_prob = Column(Float, nullable=False)
    nli_neutral_prob = Column(Float, nullable=False)
    nli_verdict = Column(String(50), nullable=False)

    claim_analysis = relationship("ClaimAnalysis", back_populates="evidence")
