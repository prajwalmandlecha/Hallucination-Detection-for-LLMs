"""
Named Entity Recognition (NER) extractor.

Extracts entities and relationships from conversation messages
for use as a verification source against hallucinated claims.

Uses spaCy for NER and stores results in PostgreSQL relational tables
linked to the conversation.
"""

import logging
from typing import Optional
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.detect import ConversationMessage
from app.db.engine import async_session_maker
from app.db.models import ExtractedEntity, Message

logger = logging.getLogger(__name__)


@dataclass
class Entity:
    """A named entity extracted from conversation text."""
    text: str
    label: str  # PERSON, ORG, GPE, DATE, CARDINAL, etc.
    message_index: int
    role: str  # 'user' or 'assistant'
    db_id: Optional[str] = None


@dataclass
class Relationship:
    """A relationship between two entities."""
    subject: str
    predicate: str
    object: str
    message_index: int


@dataclass
class NERResult:
    """Complete NER extraction result for a conversation."""
    entities: list[Entity] = field(default_factory=list)
    relationships: list[Relationship] = field(default_factory=list)
    last_processed_index: int = -1

    def get_entities_for_query(self, query_entities: list[str]) -> list[Entity]:
        """Find conversation entities that match the given query entities."""
        query_lower = {e.lower() for e in query_entities}
        return [
            e for e in self.entities
            if e.text.lower() in query_lower
            or any(q in e.text.lower() for q in query_lower)
        ]

    def get_context_around_entities(
        self,
        entity_names: list[str],
        messages: list[ConversationMessage],
    ) -> list[tuple[int, str]]:
        """
        Get the original message text around matching entities.
        Returns list of (message_index, message_content) tuples.
        """
        matching = self.get_entities_for_query(entity_names)
        indices = set(e.message_index for e in matching)
        return [
            (idx, messages[idx].content)
            for idx in sorted(indices)
            if idx < len(messages)
        ]


class NERExtractor:
    """
    Extracts named entities from conversation messages using spaCy.
    Integrates with PostgreSQL to store entities and relationships per conversation.
    """

    def __init__(self):
        self.nlp = None
        self._loaded = False

    def load(self):
        """Load the spaCy model. Call during app startup."""
        if self._loaded:
            return

        try:
            import spacy
            # Try transformer model first; fall back to smaller
            try:
                self.nlp = spacy.load("en_core_web_trf")
                logger.info("Loaded spaCy transformer model (en_core_web_trf)")
            except OSError:
                try:
                    self.nlp = spacy.load("en_core_web_sm")
                    logger.info("Loaded spaCy small model (en_core_web_sm)")
                except OSError:
                    logger.warning(
                        "No spaCy model found. Run: python -m spacy download en_core_web_sm"
                    )
                    return
            self._loaded = True
        except ImportError:
            logger.warning("spaCy not installed — NER extraction disabled")

    async def _load_existing_from_db(self, conversation_id: str) -> NERResult:
        """Load already extracted entities for this conversation from DB."""
        result = NERResult()
        
        async with async_session_maker() as session:
            # Query existing entities
            stmt = select(ExtractedEntity).where(ExtractedEntity.conversation_id == conversation_id)
            db_entities = (await session.execute(stmt)).scalars().all()
            
            # Since we don't strictly have message_index in DB, we'll map them as best effort or rely on incremental
            # For exact incremental, we'd need to link to Message. Here, if we fetch them, we just load them into result.
            for ent in db_entities:
                result.entities.append(Entity(
                    text=ent.name,
                    label=ent.label,
                    message_index=0, # Simplifying since DB doesn't store index, only message_id
                    role="unknown",
                    db_id=ent.id
                ))
                
        return result

    async def extract(
        self,
        messages: list[ConversationMessage],
        conversation_id: Optional[str] = None,
        existing_result: Optional[NERResult] = None,
    ) -> NERResult:
        """
        Extract entities from conversation messages (incremental).
        
        Args:
            messages: Full list of conversation messages.
            conversation_id: If provided, syncs with DB.
            existing_result: Previous NER result to build upon.
            
        Returns:
            Updated NERResult
        """
        if not self._loaded or not self.nlp:
            return NERResult()

        # If we have a conversation ID but no existing_result passed in, try to load it
        result = existing_result
        if result is None and conversation_id:
            result = await self._load_existing_from_db(conversation_id)
        elif result is None:
            result = NERResult()

        start_index = result.last_processed_index + 1
        new_db_entities = []

        now = datetime.now(timezone.utc)

        for idx in range(start_index, len(messages)):
            msg = messages[idx]
            doc = self.nlp(msg.content)

            for ent in doc.ents:
                entity = Entity(
                    text=ent.text,
                    label=ent.label_,
                    message_index=idx,
                    role=msg.role,
                )
                result.entities.append(entity)
                
                if conversation_id:
                    new_db_entities.append(ExtractedEntity(
                        conversation_id=conversation_id,
                        name=ent.text,
                        label=ent.label_,
                        created_at=now
                    ))

            result.last_processed_index = idx

        # Persist new entities to DB if conversation_id provided
        if conversation_id and new_db_entities:
            try:
                async with async_session_maker() as session:
                    session.add_all(new_db_entities)
                    await session.commit()
            except Exception as e:
                logger.error(f"Failed to save NER entities to DB: {e}")

        logger.info(
            f"NER: extracted {len(result.entities)} entities "
            f"from messages {start_index}-{len(messages) - 1}"
        )
        return result

    @property
    def is_loaded(self) -> bool:
        return self._loaded


# ── Module-level singleton ────────────────────────────────────────────────

_extractor: Optional[NERExtractor] = None


def get_ner_extractor() -> NERExtractor:
    """Get or create the NER extractor singleton."""
    global _extractor
    if _extractor is None:
        _extractor = NERExtractor()
    return _extractor
