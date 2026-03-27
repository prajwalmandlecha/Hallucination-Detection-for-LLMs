"""
AI Hallucination Detection System — FastAPI Application

Main entry point. Sets up the FastAPI app, registers routes,
configures CORS, and handles model loading on startup.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api import detect, chat, documents, conversations

# ── Logging ───────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-8s │ %(name)-30s │ %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── App Lifespan (Startup / Shutdown) ─────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events."""
    logger.info("=" * 60)
    logger.info("🛡️  AI Hallucination Detection System — Starting Up")
    logger.info("=" * 60)

    settings = get_settings()

    # Load NLI model (DeBERTa-v3-base)
    try:
        from app.core.nli_model import get_nli_model
        nli_model = get_nli_model()
        nli_model.load()
        logger.info(f"✅ NLI Model loaded: {settings.nli_model_name} on {settings.nli_device}")
    except Exception as e:
        logger.warning(f"⚠️  NLI Model failed to load: {e}")
        logger.warning("   Detection will work but NLI verification will be disabled")

    # Load NER model (spaCy)
    try:
        from app.core.ner_extractor import get_ner_extractor
        ner = get_ner_extractor()
        ner.load()
        if ner.is_loaded:
            logger.info("✅ NER Model loaded (spaCy)")
        else:
            logger.warning("⚠️  NER Model not available — install a spaCy model")
    except Exception as e:
        logger.warning(f"⚠️  NER Model failed to load: {e}")

    # Verify FREE API keys
    has_claim_provider = False
    if settings.groq_api_key:
        logger.info("✅ Groq key configured (CLAIM EXTRACTION + chat — fastest FREE)")
        has_claim_provider = True
    if settings.nvidia_api_key:
        logger.info("✅ NVIDIA NIM key configured (1000 free credits)")
        if not has_claim_provider:
            has_claim_provider = True
    if settings.openrouter_api_key:
        logger.info("✅ OpenRouter key configured (free models)")
        if not has_claim_provider:
            has_claim_provider = True

    if not has_claim_provider:
        logger.warning("⚠️  No LLM API key configured — claim extraction won't work!")
        logger.warning("   Get free Groq key at: https://console.groq.com/keys")

    # Web search
    if settings.tavily_api_key:
        logger.info("✅ Tavily web search configured (1000 free credits)")
    else:
        logger.warning("⚠️  Tavily API key not set — web verification disabled")
        logger.warning("   Get free key at: https://tavily.com")

    # Count available providers
    available = sum([
        bool(settings.groq_api_key),
        bool(settings.nvidia_api_key),
        bool(settings.openrouter_api_key),
    ])
    logger.info(f"📊 {available}/3 free LLM providers configured")

    logger.info("=" * 60)
    logger.info("🚀 Server ready!")
    logger.info("=" * 60)

    yield  # App is running

    # Shutdown
    logger.info("Shutting down...")


# ── FastAPI App ───────────────────────────────────────────────────────────

app = FastAPI(
    title="AI Hallucination Detection System",
    description=(
        "Detect, flag, and explain LLM hallucinations. "
        "Extracts claims from AI responses, verifies them against "
        "multiple sources (web, documents, conversation history), "
        "and provides detailed risk analysis."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────────────────────────

app.include_router(detect.router, prefix="/api/v1", tags=["Detection"])
app.include_router(chat.router, prefix="/api/v1", tags=["Chat"])
app.include_router(documents.router, prefix="/api/v1", tags=["Documents"])
app.include_router(conversations.router, prefix="/api/v1", tags=["Conversations"])


# ── Health Check ──────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
async def health_check():
    """System health check."""
    from app.core.nli_model import get_nli_model
    from app.core.ner_extractor import get_ner_extractor

    settings = get_settings()
    nli = get_nli_model()
    ner = get_ner_extractor()

    return {
        "status": "healthy",
        "version": "0.1.0",
        "components": {
            "nli_model": {
                "loaded": nli.is_loaded,
                "model": settings.nli_model_name,
                "device": settings.nli_device,
            },
            "ner_model": {
                "loaded": ner.is_loaded,
            },
            "claim_extraction": {
                "available": any([
                    settings.groq_api_key,
                    settings.nvidia_api_key,
                    settings.openrouter_api_key,
                ]),
                "priority": "groq > nvidia > openrouter",
            },
            "web_search": {
                "available": settings.tavily_api_key is not None,
                "provider": "tavily",
                "enabled": settings.web_search_enabled,
            },
            "llm_providers": {
                "groq": settings.groq_api_key is not None,
                "nvidia": settings.nvidia_api_key is not None,
                "openrouter": settings.openrouter_api_key is not None,
                "ollama": True,
            },
        },
        "supported_models": list(settings.supported_models.keys()),
    }


@app.get("/api/v1/models", tags=["System"])
async def list_models():
    """List all supported LLM models."""
    settings = get_settings()
    models = []
    for model_id, info in settings.supported_models.items():
        api_key_field = info.get("api_key_field")
        is_available = (
            api_key_field is None  # Ollama (no key needed)
            or getattr(settings, api_key_field, None) is not None
        )
        models.append({
            "id": model_id,
            "name": info["name"],
            "provider": info["provider"],
            "tier": info["tier"],
            "available": is_available,
            "free": info.get("free", True),
            "description": info.get("description", ""),
        })
    return {"models": models}
