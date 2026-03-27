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
        default="postgresql+asyncpg://postgres:postgres@localhost:5433/db",
        description="Async PostgreSQL connection string",
    )
    database_url_sync: str = Field(
        default="postgresql://postgres:postgres@localhost:5433/db",
        description="Sync PostgreSQL connection string (for Alembic)",
    )


    # ── Ollama (Local Embeddings + Models) ────────────────────────────────
    ollama_base_url: str = Field(
        default="http://localhost:11434",
        description="Ollama server base URL",
    )
    embedding_model: str = Field(
        default="nomic-embed-text",
        description="Ollama embedding model name",
    )
    embedding_dimensions: int = Field(
        default=768,
        description="Embedding vector dimensions",
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
        default="llama-3.3-70b-versatile",
        description="Primary model for claim extraction",
    )

    # ── Pipeline Config ───────────────────────────────────────────────────
    claim_confidence_threshold: float = Field(
        default=0.3,
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

    # ── Risk Score Weights ────────────────────────────────────────────────
    weight_source_support: float = 0.30
    weight_contradiction: float = 0.30
    weight_source_coverage: float = 0.15
    weight_claim_importance: float = 0.10
    weight_source_agreement: float = 0.10
    weight_evidence_count: float = 0.05

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
        - Ollama 
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
            "google/gemini-2.5-flash:free": {
                "name": "Gemini 2.5 Flash (OpenRouter)",
                "provider": "openrouter",
                "tier": 2,
                "api_key_field": "openrouter_api_key",
                "description": "Google Gemini via OpenRouter free tier",
            },

            # ── Ollama ───────────────
            "llama3.1:8b": {
                "name": "Llama 3.1 8B (Local)",
                "provider": "ollama",
                "tier": 3,
                "api_key_field": None,
                "description": "Runs locally via Ollama, no internet needed",
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
