"""
Application configuration loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env file."""

    # ── Database ──────────────────────────────────────────────────────────
    database_url: str = Field(
        default="postgresql+asyncpg://detection_admin:detection_pass@localhost:5433/ai_detection",
        description="Async PostgreSQL connection string",
    )
    database_url_sync: str = Field(
        default="postgresql://detection_admin:detection_pass@localhost:5433/ai_detection",
        description="Sync PostgreSQL connection string (for Alembic)",
    )


    # ── Embeddings (NVIDIA NIM) ────────────────────────────────
    embedding_model: str = Field(
        default="NV-Embed-QA",
        description="NVIDIA NIM embedding model name",
    )
    embedding_dimensions: int = Field(
        default=1024,
        description="Embedding vector dimensions for NV-Embed-QA",
    )


    # OpenRouter 
    openrouter_api_key: Optional[str] = Field(
        default=None,
        description="OpenRouter API key",
    )

    # NVIDIA NIM 
    nvidia_api_key: Optional[str] = Field(
        default=None,
        description="NVIDIA NIM API key",
    )

    # Groq 
    groq_api_key: Optional[str] = Field(
        default=None,
        description="Groq API key",
    )

    # ── Web Search ────────────────────────────────────────────────────────
    # Tavily 
    tavily_api_key: Optional[str] = Field(
        default=None,
        description="Tavily API key",
    )
    # Serper (domain-filtered Google search)
    serper_api_key: Optional[str] = Field(
        default=None,
        description="Serper.dev API key for domain-filtered web search",
    )

    # ── Gemini (Claim Adjudication via Google AI Studio) ──────────────────
    gemini_api_key: Optional[str] = Field(
        default=None,
        description="Google Gemini API key from AI Studio (for claim adjudication)",
    )

    # ── Google Fact Check Tools API ───────────────────────────────────────
    google_factcheck_api_key: Optional[str] = Field(
        default=None,
        description="Google Fact Check Tools API key from GCP Console",
    )

    # ── NLI Model ─────────────────────────────────────────────────────────
    nli_model_name: str = Field(
        default="cross-encoder/nli-deberta-v3-base",
        description="HuggingFace NLI cross-encoder model",
    )
    nli_device: str = Field(
        default="cuda",
        description="Device for NLI inference: 'cuda' or 'cpu'",
    )

    # ── Claim Extraction ──────────────────────────────────────────────────
    claim_extraction_model: str = Field(
        default="openai/gpt-oss-120b",
        description="Primary model for claim extraction",
    )

    # ── Pipeline Config ───────────────────────────────────────────────────
    claim_confidence_threshold: float = Field(
        default=0.1,
        description="Minimum confidence for a claim to be verified",
    )
    web_search_enabled: bool = Field(
        default=True,
        description="Enable web search as a verification source",
    )
    max_claims_per_response: int = Field(
        default=20,
        description="Maximum number of claims to extract per response",
    )

    # ── Evidence Pipeline Settings ────────────────────────────────────────
    max_evidence_per_claim: int = Field(
        default=10,
        description="Max evidence pieces to send to the LLM adjudicator per claim",
    )
    min_evidence_informativeness: float = Field(
        default=0.3,
        description="Min max(entailment, contradiction) NLI score to include evidence",
    )

    # ── Server ────────────────────────────────────────────────────────────
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    debug: bool = Field(default=True)

    # ── Supported LLM Models ──────────────────────────────────
    @property
    def supported_models(self) -> dict:
        """
        Registry of all supported LLM models
        Uses 4 providers:
        - Groq
        - NVIDIA NIM  
        - OpenRouter 
        """
        return {

            # ── Groq ───────────────────────
            "llama-3.3-70b-versatile": {
                "name": "Llama 3.3 70B (Groq)",
                "provider": "groq",
                "tier": 1,
                "api_key_field": "groq_api_key",
                "description": "Meta's best open model, blazing fast on Groq",
            },
            "llama-3.1-8b-instant": {
                "name": "Llama 3.1 8B (Groq)",
                "provider": "groq",
                "tier": 2,
                "api_key_field": "groq_api_key",
                "description": "Meta's insanely fast small model on Groq",
            },
            "gemma2-9b-it": {
                "name": "Gemma 2 9B (Groq)",
                "provider": "groq",
                "tier": 2,
                "api_key_field": "groq_api_key",
                "description": "Google's open model, very fast on Groq",
            },

            # ── NVIDIA NIM ──────────────────
            "meta/llama-3.1-70b-instruct": {
                "name": "Llama 3.1 70B (NVIDIA)",
                "provider": "nvidia",
                "tier": 1,
                "api_key_field": "nvidia_api_key",
                "description": "Meta Llama on NVIDIA DGX Cloud",
            },
            "mistralai/mistral-7b-instruct-v0.3": {
                "name": "Mistral 7B (NVIDIA)",
                "provider": "nvidia",
                "tier": 2,
                "api_key_field": "nvidia_api_key",
                "description": "Mistral 7B on NVIDIA infrastructure",
            },

            # ── OpenRouter ────────────────────
            "meta-llama/llama-3.3-70b-instruct:free": {
                "name": "Llama 3.3 70B (OpenRouter)",
                "provider": "openrouter",
                "tier": 1,
                "api_key_field": "openrouter_api_key",
                "description": "Meta Llama via OpenRouter free tier",
            },
            "nvidia/llama-3.1-nemotron-70b-instruct:free": {
                "name": "Nemotron 70B (OpenRouter)",
                "provider": "openrouter",
                "tier": 1,
                "api_key_field": "openrouter_api_key",
                "description": "NVIDIA Nemotron via OpenRouter free tier",
            },



        }

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
    }


@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()
