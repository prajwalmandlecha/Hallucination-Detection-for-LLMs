"""
Local embedding generation using Ollama.

We use `nomic-embed-text` (768 dimensions), which runs locally
and completely free on your hardware.
"""

import logging
from typing import List
import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

class EmbeddingPipeline:
    def __init__(self):
        settings = get_settings()
        self.base_url = settings.ollama_base_url
        self.model = settings.embedding_model

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for a list of texts using Ollama.
        """
        if not texts:
            return []

        embeddings = []
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                for text in texts:
                    # Ollama API: /api/embeddings
                    response = await client.post(
                        f"{self.base_url}/api/embeddings",
                        json={
                            "model": self.model,
                            "prompt": text
                        }
                    )
                    response.raise_for_status()
                    data = response.json()
                    embeddings.append(data.get("embedding", []))
            
            logger.info(f"Generated {len(embeddings)} embeddings using Ollama ({self.model})")
            return embeddings

        except Exception as e:
            logger.error(f"Failed to generate embeddings via Ollama: {e}")
            raise

_pipeline = None

def get_embedding_pipeline() -> EmbeddingPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = EmbeddingPipeline()
    return _pipeline
