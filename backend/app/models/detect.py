"""
Pydantic schemas for the /detect endpoint.

Supports two modes:
1. SINGLE MODE (frontend): model_response + conversation_history
2. EXTENSION MODE (browser extensions): platform + conversation + messages[]
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
    UNVERIFIABLE_SOURCE = "UNVERIFIABLE_SOURCE"
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
    """A single message in the conversation history (frontend format)."""
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Message content")
    model_id: Optional[str] = Field(None, description="Model that generated this (null for user)")


class DetectionConfig(BaseModel):
    """Optional config overrides for detection."""
    check_web: bool = Field(True, description="Enable web search verification")
    check_documents: bool = Field(True, description="Enable document verification")
    check_conversation: bool = Field(True, description="Enable conversation history verification")
    claim_threshold: float = Field(0.3, description="Min confidence for claim verification")


# ── Extension Payload Models ─────────────────────────────────────────────


class ExtensionSource(BaseModel):
    """A source citation from the LLM platform's response."""
    type: str = Field("web", description="'web' or 'upload'")
    url: Optional[str] = None
    title: Optional[str] = None
    host: Optional[str] = None
    index: Optional[int] = None
    citationLabel: Optional[str] = None
    rawUrl: Optional[str] = None
    fileName: Optional[str] = None
    displayName: Optional[str] = None
    extension: Optional[str] = None


class ExtensionMessage(BaseModel):
    """A message from a browser extension (ChatGPT, Claude, Gemini, DeepSeek, Copilot)."""
    id: Optional[str] = Field(None, description="DOM-derived message ID (e.g., 'user-0', 'assistant-3')")
    index: Optional[int] = Field(None, description="Position in full conversation")
    role: str = Field(..., description="'user' or 'assistant'")
    roleIndex: Optional[int] = Field(None, description="Nth message of this role")
    text: str = Field(..., description="Message text content")
    sources: list[ExtensionSource] = Field(default_factory=list)
    sourceCount: int = Field(0)


class ExtensionConversation(BaseModel):
    """Conversation metadata from a browser extension."""
    id: Optional[str] = Field(None, description="Platform's conversation ID")
    url: Optional[str] = Field(None, description="Original URL")
    title: Optional[str] = None


class ExtensionIncrementalSync(BaseModel):
    """Incremental sync state from the extension."""
    enabled: bool = False
    conversationKey: Optional[str] = None
    lastSyncedMessageId: Optional[str] = None
    fullMessageCount: Optional[int] = None
    newMessageCount: Optional[int] = None
    startIndex: Optional[int] = None


class ExtensionSummary(BaseModel):
    """Summary stats from the extension."""
    messageCount: int = 0
    userMessageCount: int = 0
    assistantMessageCount: int = 0
    fullMessageCount: Optional[int] = None
    pageCanvasDocumentCount: int = 0
    uploadCount: int = 0
    totalSourceCount: int = 0
    totalWebSourceCount: int = 0
    totalUploadReferenceCount: int = 0


# ── Unified Detection Request ────────────────────────────────────────────


class DetectionRequest(BaseModel):
    """
    Unified request body for POST /api/v1/detect.
    
    Supports two modes (auto-detected):
    
    1. SINGLE MODE (frontend): Provide model_response + conversation_history
    2. EXTENSION MODE (browser extension): Provide platform + conversation + messages[]
    """
    # ── Common ──
    conversation_id: Optional[str] = Field(None, description="Internal conversation UUID (frontend)")
    document_ids: list[str] = Field(
        default_factory=list,
        description="IDs of user-uploaded documents to check against",
    )
    config: DetectionConfig = Field(
        default_factory=DetectionConfig,
        description="Detection pipeline configuration",
    )

    # ── Mode 1: Single response (frontend) ──
    model_id: Optional[str] = Field(None, description="Model that generated the response")
    model_response: Optional[str] = Field(None, description="The AI response to analyze")
    conversation_history: list[ConversationMessage] = Field(
        default_factory=list,
        description="Previous conversation messages for context",
    )

    # ── Mode 2: Extension payload ──
    platform: Optional[str] = Field(None, description="'chatgpt', 'claude', 'gemini', 'deepseek', 'copilot'")
    schemaVersion: Optional[str] = None
    extractedAt: Optional[str] = None
    conversation: Optional[ExtensionConversation] = None
    messages: Optional[list[ExtensionMessage]] = None
    summary: Optional[ExtensionSummary] = None
    incrementalSync: Optional[ExtensionIncrementalSync] = None
    uploadedFiles: Optional[list[dict]] = None
    pageCanvasDocuments: Optional[list[dict]] = None
    extractionErrors: Optional[list[dict]] = None

    @property
    def is_extension_mode(self) -> bool:
        """Auto-detect if this is an extension payload."""
        return self.platform is not None and self.messages is not None


# ── Internal Pipeline Models ─────────────────────────────────────────────


class ExtractedClaim(BaseModel):
    """A single claim extracted from the AI response by the LLM."""
    id: str = Field(..., description="Unique claim identifier (e.g., c1, c2)")
    text: str = Field(..., description="The claim as a standalone assertion")
    exact_quote: Optional[str] = Field(None, description="Exact substring from the AI response")
    citation_indices: list[int] = Field(default_factory=list, description="Extracted citation indices [1], [2]")
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
    exact_quote: Optional[str] = Field(None, description="Exact phrase from the original text (for DOM highlighting)")
    type: ClaimType
    risk_score: float = Field(ge=0, le=100)
    status: ClaimStatus
    suggested_sources: list[SourceType] = Field(
        default_factory=list,
        description="Sources the LLM suggested checking for this claim",
    )
    note: str = Field("", description="Explanation for tooltip")
    citations: list[str] = Field(default_factory=list, description="Source URLs/names for tooltip")
    verification_details: dict = Field(
        default_factory=dict,
        description="Detailed verification info including NLI scores and evidence",
    )


# ── Highlight Models (consumed by extension's HighlightNormalizer) ───────


class HighlightClaim(BaseModel):
    """A claim formatted for the extension's DOM highlighting system."""
    text: str = Field(..., description="Exact claim text for DOM text matching")
    exact_quote: Optional[str] = Field(None, description="Exact phrase from original AI text")
    score: float = Field(..., description="Risk score 0-100")
    note: str = Field("", description="Explanation for tooltip")
    citations: list[str] = Field(default_factory=list, description="Source URLs/names for tooltip")


class MessageDetectionResult(BaseModel):
    """Detection result for a single assistant message — used by extension's HighlightNormalizer."""
    messageId: Optional[str] = Field(None, description="Extension message ID (e.g., 'assistant-3')")
    messageIndex: Optional[int] = Field(None, description="Position in full conversation")
    assistantRoleIndex: Optional[int] = Field(None, description="Nth assistant message")
    role: str = "assistant"
    risk_score: float = Field(0, ge=0, le=100)
    risk_level: RiskLevel = RiskLevel.LOW
    claims: list[HighlightClaim] = Field(default_factory=list)


class DetectionMetadata(BaseModel):
    """Metadata about the detection process."""
    processing_time_ms: int = 0
    claims_extracted: int = 0
    claims_verified: int = 0
    claims_skipped: int = 0
    sources_queried: list[str] = Field(default_factory=list)
    platform: Optional[str] = Field(None, description="Source platform if from extension")
    conversation_id: Optional[str] = Field(None, description="Internal conversation ID")


class DetectionResponse(BaseModel):
    """
    Full response from POST /api/v1/detect.
    
    Both frontend and extension consume this.
    The extension's HighlightNormalizer reads from `results[]` for per-message highlighting.
    The frontend reads from `claims[]` for the analysis panel.
    """
    response_id: str
    overall_risk_score: float = Field(ge=0, le=100)
    risk_level: RiskLevel
    risk_color: str = Field(description="Hex color for the risk level")
    warning_message: str = Field(description="Summary warning message")
    warnings: list[Warning] = Field(default_factory=list)
    claims: list[ClaimResultResponse] = Field(default_factory=list)
    
    # Per-message results for extension highlighting (only present in extension mode)
    results: Optional[list[MessageDetectionResult]] = Field(
        None,
        description="Per-message detection results with highlighting data (extension mode only)",
    )
    
    metadata: DetectionMetadata = Field(default_factory=DetectionMetadata)
