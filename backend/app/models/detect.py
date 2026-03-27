"""
Pydantic schemas for the /detect endpoint.
"""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# ── Enums ─────────────────────────────────────────────────────────────────


class ClaimType(str, Enum):
    FACTUAL = "factual"
    STATISTICAL = "statistical"
    TEMPORAL = "temporal"
    CAUSAL = "causal"
    DEFINITION = "definition"


class ClaimStatus(str, Enum):
    VERIFIED = "VERIFIED"
    UNVERIFIED = "UNVERIFIED"
    CONTRADICTED = "CONTRADICTED"
    SKIPPED = "SKIPPED"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class SourceType(str, Enum):
    WEB_SEARCH = "web_search"
    VECTOR_DB = "vector_db"
    CONVERSATION_HISTORY = "conversation_history"


class NLILabel(str, Enum):
    ENTAILMENT = "ENTAILMENT"
    CONTRADICTION = "CONTRADICTION"
    NEUTRAL = "NEUTRAL"


# ── Request Models ────────────────────────────────────────────────────────


class ConversationMessage(BaseModel):
    """A single message in the conversation history."""
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Message content")
    model_id: Optional[str] = Field(None, description="Model that generated this (null for user)")


class DetectionConfig(BaseModel):
    """Optional config overrides for detection."""
    check_web: bool = Field(True, description="Enable web search verification")
    check_documents: bool = Field(True, description="Enable document verification")
    check_conversation: bool = Field(True, description="Enable conversation history verification")
    claim_threshold: float = Field(0.3, description="Min confidence for claim verification")


class DetectionRequest(BaseModel):
    """Request body for POST /api/v1/detect."""
    conversation_id: Optional[str] = Field(None, description="Conversation UUID")
    model_id: str = Field(..., description="Model that generated the response")
    model_response: str = Field(..., description="The AI response to analyze")
    conversation_history: list[ConversationMessage] = Field(
        default_factory=list,
        description="Previous conversation messages for context",
    )
    document_ids: list[str] = Field(
        default_factory=list,
        description="IDs of user-uploaded documents to check against",
    )
    config: DetectionConfig = Field(
        default_factory=DetectionConfig,
        description="Detection pipeline configuration",
    )


# ── Internal Pipeline Models ─────────────────────────────────────────────


class ExtractedClaim(BaseModel):
    """A single claim extracted from the AI response by the LLM."""
    id: str = Field(..., description="Unique claim identifier (e.g., c1, c2)")
    text: str = Field(..., description="The claim as a standalone assertion")
    type: ClaimType = Field(ClaimType.FACTUAL, description="Claim type classification")
    importance: float = Field(0.5, ge=0, le=1, description="How critical this claim is (0-1)")
    suggested_sources: list[SourceType] = Field(
        default_factory=list,
        description="Which sources the LLM suggests checking",
    )
    search_queries: list[str] = Field(
        default_factory=list,
        description="Suggested search queries for web verification",
    )
    confidence_needs_checking: float = Field(
        0.5, ge=0, le=1,
        description="Probability this claim needs verification (0-1)",
    )
    key_entities: list[str] = Field(
        default_factory=list,
        description="Key entities mentioned in this claim",
    )


class EvidencePiece(BaseModel):
    """A single piece of evidence retrieved from a verification source."""
    source_type: SourceType
    source_url: Optional[str] = Field(None, description="URL for web sources")
    source_title: Optional[str] = Field(None, description="Title/name of the source")
    document_name: Optional[str] = Field(None, description="Name of user-uploaded document")
    chunk_index: Optional[int] = Field(None, description="Chunk position in document")
    message_index: Optional[int] = Field(None, description="Message index in conversation")
    snippet: str = Field(..., description="The relevant text snippet from this source")
    nli_label: Optional[NLILabel] = None
    nli_scores: Optional[dict[str, float]] = Field(
        None,
        description="NLI scores: {entailment, contradiction, neutral}",
    )


class ClaimVerificationResult(BaseModel):
    """Full verification result for a single claim."""
    claim: ExtractedClaim
    risk_score: float = Field(0, ge=0, le=100, description="Claim-level risk score (0-100)")
    status: ClaimStatus = ClaimStatus.UNVERIFIED
    max_entailment_score: float = 0.0
    max_contradiction_score: float = 0.0
    source_coverage: float = Field(0, description="Fraction of sources that returned evidence")
    source_agreement_variance: float = 0.0
    evidence: list[EvidencePiece] = Field(default_factory=list)
    sources_checked: list[SourceType] = Field(default_factory=list)


# ── Response Models ───────────────────────────────────────────────────────


class Warning(BaseModel):
    """A contextual warning about a specific claim."""
    type: str = Field(..., description="Warning type: no_source, contradiction, outdated, etc.")
    message: str = Field(..., description="Human-readable warning message")
    claim_id: str = Field(..., description="ID of the related claim")
    source_url: Optional[str] = Field(None, description="Source URL if applicable")


class ClaimResultResponse(BaseModel):
    """Claim-level result in the API response."""
    id: str
    text: str
    type: ClaimType
    risk_score: float = Field(ge=0, le=100)
    status: ClaimStatus
    verification_details: dict = Field(
        default_factory=dict,
        description="Detailed verification info including NLI scores and evidence",
    )


class DetectionMetadata(BaseModel):
    """Metadata about the detection process."""
    processing_time_ms: int = 0
    claims_extracted: int = 0
    claims_verified: int = 0
    claims_skipped: int = 0
    sources_queried: list[str] = Field(default_factory=list)


class DetectionResponse(BaseModel):
    """Full response from POST /api/v1/detect."""
    response_id: str
    overall_risk_score: float = Field(ge=0, le=100)
    risk_level: RiskLevel
    risk_color: str = Field(description="Hex color for the risk level")
    warning_message: str = Field(description="Summary warning message")
    warnings: list[Warning] = Field(default_factory=list)
    claims: list[ClaimResultResponse] = Field(default_factory=list)
    metadata: DetectionMetadata = Field(default_factory=DetectionMetadata)
