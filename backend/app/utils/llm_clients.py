"""
LLM API clients for multi-model chat support.

ALL PROVIDERS ARE FREE:
- Groq — free tier (OpenAI-compatible, fastest)
- NVIDIA NIM — free credits via OpenAI-compatible API
- OpenRouter — free models via OpenAI-compatible API
- Ollama — fully local
"""

import logging
from typing import AsyncGenerator, Optional

from app.config import get_settings

logger = logging.getLogger(__name__)


class LLMClient:
    """
    Unified client for multiple FREE LLM providers.
    
    Groq, NVIDIA NIM, and OpenRouter all use OpenAI-compatible APIs,
    so we reuse the same OpenAI client with different base_url and api_key.
    """

    def __init__(self):
        self.settings = get_settings()
        self._clients: dict[str, object] = {}

    def _get_openai_compatible_client(self, provider: str):
        """
        Get an OpenAI-compatible async client for a given provider.
        
        Groq, NVIDIA NIM, and OpenRouter all support the OpenAI API format.
        """
        if provider in self._clients:
            return self._clients[provider]

        from openai import AsyncOpenAI

        provider_config = {
            "groq": {
                "base_url": "https://api.groq.com/openai/v1",
                "api_key": self.settings.groq_api_key,
            },
            "nvidia": {
                "base_url": "https://integrate.api.nvidia.com/v1",
                "api_key": self.settings.nvidia_api_key,
            },
            "openrouter": {
                "base_url": "https://openrouter.ai/api/v1",
                "api_key": self.settings.openrouter_api_key,
            },
        }

        config = provider_config.get(provider)
        if not config or not config["api_key"]:
            return None

        client = AsyncOpenAI(
            base_url=config["base_url"],
            api_key=config["api_key"],
        )
        self._clients[provider] = client
        return client


    async def chat(
        self,
        model_id: str,
        message: str,
        conversation_history: Optional[list[dict]] = None,
    ) -> str:
        """
        Send a message to the specified LLM and return the response.
        
        Args:
            model_id: Model identifier from supported_models registry
            message: User's message
            conversation_history: Previous messages [{role, content}, ...]
            
        Returns:
            The model's response text.
        """
        model_info = self.settings.supported_models.get(model_id)
        if not model_info:
            raise ValueError(f"Unsupported model: {model_id}")

        provider = model_info["provider"]
        history = conversation_history or []

        if provider in ("groq", "nvidia", "openrouter"):
            return await self._chat_openai_compatible(provider, model_id, message, history)
        elif provider == "ollama":
            return await self._chat_ollama(model_id, message, history)
        else:
            raise ValueError(f"Unknown provider: {provider}")

    async def chat_stream(
        self,
        model_id: str,
        message: str,
        conversation_history: Optional[list[dict]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Stream a response from the specified LLM.
        Yields response text chunks.
        """
        model_info = self.settings.supported_models.get(model_id)
        if not model_info:
            raise ValueError(f"Unsupported model: {model_id}")

        provider = model_info["provider"]
        history = conversation_history or []

        if provider in ("groq", "nvidia", "openrouter"):
            async for chunk in self._stream_openai_compatible(provider, model_id, message, history):
                yield chunk
        elif provider == "ollama":
            async for chunk in self._stream_ollama(model_id, message, history):
                yield chunk

    # ── OpenAI-Compatible (Groq, NVIDIA NIM, OpenRouter) ──────────────

    async def _chat_openai_compatible(
        self, provider: str, model_id: str, message: str, history: list[dict]
    ) -> str:
        client = self._get_openai_compatible_client(provider)
        if not client:
            raise RuntimeError(f"{provider} API key not configured")

        messages = [{"role": m["role"], "content": m["content"]} for m in history]
        messages.append({"role": "user", "content": message})

        extra_kwargs = {}
        if provider == "openrouter":
            extra_kwargs["extra_headers"] = {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "AI Hallucination Detector",
            }

        response = await client.chat.completions.create(
            model=model_id,
            messages=messages,
            **extra_kwargs,
        )
        return response.choices[0].message.content

    async def _stream_openai_compatible(
        self, provider: str, model_id: str, message: str, history: list[dict]
    ):
        client = self._get_openai_compatible_client(provider)
        if not client:
            raise RuntimeError(f"{provider} API key not configured")

        messages = [{"role": m["role"], "content": m["content"]} for m in history]
        messages.append({"role": "user", "content": message})

        extra_kwargs = {}
        if provider == "openrouter":
            extra_kwargs["extra_headers"] = {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "AI Hallucination Detector",
            }

        stream = await client.chat.completions.create(
            model=model_id,
            messages=messages,
            stream=True,
            **extra_kwargs,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    # ── Ollama (LOCAL — fully free) ───────────────────────────────────

    async def _chat_ollama(self, model_id: str, message: str, history: list[dict]) -> str:
        import ollama as ollama_lib

        messages = [{"role": m["role"], "content": m["content"]} for m in history]
        messages.append({"role": "user", "content": message})

        response = ollama_lib.chat(
            model=model_id,
            messages=messages,
        )
        return response["message"]["content"]

    async def _stream_ollama(self, model_id: str, message: str, history: list[dict]):
        import ollama as ollama_lib

        messages = [{"role": m["role"], "content": m["content"]} for m in history]
        messages.append({"role": "user", "content": message})

        stream = ollama_lib.chat(
            model=model_id,
            messages=messages,
            stream=True,
        )
        for chunk in stream:
            content = chunk.get("message", {}).get("content", "")
            if content:
                yield content


# ── Module-level singleton ────────────────────────────────────────────────

_llm_client: Optional[LLMClient] = None


def get_llm_client() -> LLMClient:
    """Get or create the LLM client singleton."""
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client
