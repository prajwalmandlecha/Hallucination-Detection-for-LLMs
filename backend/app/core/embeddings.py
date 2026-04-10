"""
Embedding generation using native SentenceTransformers.

We use `all-MiniLM-L6-v2` (384 dimensions), which runs 100% locally 
inside the python process without requiring external APIs.
"""

import logging
from typing import List
import asyncio
from concurrent.futures import ThreadPoolExecutor

from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

# Run CPU-bound embeddings in a thread pool so we don't block asyncio
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="emb-inference")

class EmbeddingPipeline:
    def __init__(self):
        self.model_name = "all-MiniLM-L6-v2"
        self._model = None
        
    def _load_sync(self):
        if self._model is None:
            logger.info(f"Loading embedding model {self.model_name} natively...")
            self._model = SentenceTransformer(self.model_name)
            logger.info(f"Native embedding model loaded successfully.")

    def _embed_sync(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        self._load_sync()
        embeddings = self._model.encode(texts, convert_to_numpy=True)
        return embeddings.tolist()

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for a list of texts natively via SentenceTransformers.
        """
        if not texts:
            return []

        try:
            loop = asyncio.get_event_loop()
            embeddings = await loop.run_in_executor(_executor, self._embed_sync, texts)
            return embeddings
        except Exception as e:
            logger.error(f"Failed to generate embeddings natively: {e}")
            raise

_pipeline = None

def get_embedding_pipeline() -> EmbeddingPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = EmbeddingPipeline()
    return _pipeline
