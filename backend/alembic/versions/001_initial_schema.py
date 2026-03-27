"""Initial schema — full database setup

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-03-28

Complete schema including:
- Conversations (with external platform linking for extensions)
- Messages (with external tracking for ChatGPT/Claude/Gemini/DeepSeek/Copilot)
- Documents & Chunks (with pgvector embeddings)
- NER Entities (flat, per-conversation)
- Analysis Results, Claims, Evidence Items
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import pgvector.sqlalchemy

# revision identifiers, used by Alembic.
revision: str = '001_initial_schema'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all tables."""
    # Enable pgvector extension
    op.execute('CREATE EXTENSION IF NOT EXISTS vector;')

    # ── analysis_results ─────────────────────────────────────────────
    op.create_table('analysis_results',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('ai_response_text', sa.Text(), nullable=False),
        sa.Column('overall_risk_score', sa.Float(), nullable=False),
        sa.Column('risk_level', sa.String(length=50), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('warnings', postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    # ── conversations ────────────────────────────────────────────────
    op.create_table('conversations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('external_id', sa.String(length=255), nullable=True),
        sa.Column('platform', sa.String(length=50), nullable=True),
        sa.Column('title', sa.String(length=500), nullable=True),
        sa.Column('external_url', sa.String(length=2048), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('metadata_json', postgresql.JSONB(), nullable=True),
        sa.Column('last_synced_message_index', sa.Integer(), nullable=True, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('external_id', 'platform', name='uq_conversation_external_platform'),
    )
    op.create_index('ix_conversations_external_id', 'conversations', ['external_id'])
    op.create_index('ix_conversations_platform', 'conversations', ['platform'])

    # ── messages ─────────────────────────────────────────────────────
    op.create_table('messages',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('conversation_id', sa.String(length=36), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('external_id', sa.String(length=255), nullable=True),
        sa.Column('message_index', sa.Integer(), nullable=True),
        sa.Column('role_index', sa.Integer(), nullable=True),
        sa.Column('model_id', sa.String(length=100), nullable=True),
        sa.Column('platform_sources', postgresql.JSONB(), nullable=True, server_default='[]'),
        sa.Column('analysis_result_id', sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['analysis_result_id'], ['analysis_results.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('conversation_id', 'external_id', name='uq_message_conversation_external'),
    )
    op.create_index('ix_messages_conversation_id', 'messages', ['conversation_id'])

    # ── documents ────────────────────────────────────────────────────
    op.create_table('documents',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('conversation_id', sa.String(length=36), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=100), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_documents_conversation_id', 'documents', ['conversation_id'])

    # ── document_chunks ──────────────────────────────────────────────
    op.create_table('document_chunks',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('text_content', sa.Text(), nullable=False),
        sa.Column('embedding', pgvector.sqlalchemy.Vector(dim=768), nullable=True),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_document_chunks_document_id', 'document_chunks', ['document_id'])

    # ── extracted_entities ────────────────────────────────────────────
    op.create_table('extracted_entities',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('conversation_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('source_message_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_message_id'], ['messages.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_extracted_entities_conversation_id', 'extracted_entities', ['conversation_id'])

    # ── claim_analyses ───────────────────────────────────────────────
    op.create_table('claim_analyses',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('analysis_id', sa.String(length=36), nullable=False),
        sa.Column('claim_text', sa.Text(), nullable=False),
        sa.Column('claim_type', sa.String(length=50), nullable=False),
        sa.Column('importance_score', sa.Float(), nullable=False),
        sa.Column('risk_score', sa.Float(), nullable=False),
        sa.Column('verdict', sa.String(length=50), nullable=False),
        sa.ForeignKeyConstraint(['analysis_id'], ['analysis_results.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_claim_analyses_analysis_id', 'claim_analyses', ['analysis_id'])

    # ── evidence_items ───────────────────────────────────────────────
    op.create_table('evidence_items',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('claim_analysis_id', sa.String(length=36), nullable=False),
        sa.Column('source_type', sa.String(length=50), nullable=False),
        sa.Column('source_title', sa.String(length=500), nullable=True),
        sa.Column('source_url', sa.String(length=2048), nullable=True),
        sa.Column('snippet', sa.Text(), nullable=False),
        sa.Column('nli_entailment_prob', sa.Float(), nullable=False),
        sa.Column('nli_contradiction_prob', sa.Float(), nullable=False),
        sa.Column('nli_neutral_prob', sa.Float(), nullable=False),
        sa.Column('nli_verdict', sa.String(length=50), nullable=False),
        sa.ForeignKeyConstraint(['claim_analysis_id'], ['claim_analyses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_evidence_items_claim_analysis_id', 'evidence_items', ['claim_analysis_id'])


def downgrade() -> None:
    """Drop all tables."""
    op.drop_index('ix_evidence_items_claim_analysis_id', table_name='evidence_items')
    op.drop_table('evidence_items')
    op.drop_index('ix_claim_analyses_analysis_id', table_name='claim_analyses')
    op.drop_table('claim_analyses')
    op.drop_index('ix_extracted_entities_conversation_id', table_name='extracted_entities')
    op.drop_table('extracted_entities')
    op.drop_index('ix_document_chunks_document_id', table_name='document_chunks')
    op.drop_table('document_chunks')
    op.drop_index('ix_documents_conversation_id', table_name='documents')
    op.drop_table('documents')
    op.drop_index('ix_messages_conversation_id', table_name='messages')
    op.drop_table('messages')
    op.drop_index('ix_conversations_platform', table_name='conversations')
    op.drop_index('ix_conversations_external_id', table_name='conversations')
    op.drop_table('conversations')
    op.drop_table('analysis_results')
    op.execute('DROP EXTENSION IF EXISTS vector;')
