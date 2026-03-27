"""
NLI (Natural Language Inference) model wrapper for claim verification.

Uses DeBERTa-v3-base cross-encoder to classify (claim, evidence) pairs
as entailment, contradiction, or neutral.
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import numpy as np
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

from app.config import get_settings

logger = logging.getLogger(__name__)

# Thread pool for non-blocking GPU inference
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="nli-inference")


class NLIModel:
    """
    DeBERTa-v3-base NLI cross-encoder for claim verification.
    
    Classifies (premise, hypothesis) pairs into:
    - ENTAILMENT: premise supports hypothesis
    - CONTRADICTION: premise contradicts hypothesis  
    - NEUTRAL: premise is inconclusive about hypothesis
    """

    # Label mapping for cross-encoder/nli-deberta-v3-base
    LABELS = ["contradiction", "entailment", "neutral"]

    def __init__(self):
        settings = get_settings()
        self.model_name = settings.nli_model_name
        self.device = settings.nli_device

        # Check CUDA availability
        if self.device == "cuda" and not torch.cuda.is_available():
            logger.warning("CUDA not available, falling back to CPU")
            self.device = "cpu"

        self.tokenizer = None
        self.model = None
        self._loaded = False

    def load(self):
        """Load the NLI model and tokenizer. Call during app startup."""
        if self._loaded:
            return

        logger.info(f"Loading NLI model: {self.model_name} on {self.device}")

        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(self.model_name)
        self.model.to(self.device)
        self.model.eval()

        # Warm up with a dummy inference
        self._inference_sync([("test premise", "test hypothesis")])

        logger.info(f"NLI model loaded successfully on {self.device}")
        self._loaded = True

    def _inference_sync(
        self, pairs: list[tuple[str, str]]
    ) -> list[dict[str, float]]:
        """
        Run NLI inference synchronously (blocking).
        
        Args:
            pairs: List of (premise/evidence, hypothesis/claim) tuples.
            
        Returns:
            List of score dicts: [{"entailment": 0.9, "contradiction": 0.05, "neutral": 0.05}, ...]
        """
        if not self.model or not self.tokenizer:
            raise RuntimeError("NLI model not loaded. Call load() first.")

        if not pairs:
            return []

        # Tokenize all pairs
        premises = [p[0] for p in pairs]
        hypotheses = [p[1] for p in pairs]

        inputs = self.tokenizer(
            premises,
            hypotheses,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="pt",
        ).to(self.device)

        # Run inference
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits
            probabilities = torch.softmax(logits, dim=-1).cpu().numpy()

        # Convert to labeled dicts
        results = []
        for probs in probabilities:
            result = {
                label: float(prob)
                for label, prob in zip(self.LABELS, probs)
            }
            results.append(result)

        return results

    async def predict(
        self, pairs: list[tuple[str, str]]
    ) -> list[dict[str, float]]:
        """
        Async NLI inference — runs on thread pool to avoid blocking FastAPI.
        
        GPU operations release the GIL during CUDA compute, so other
        async tasks can proceed while inference runs.
        
        Args:
            pairs: List of (evidence_text, claim_text) tuples.
            
        Returns:
            List of score dicts with keys: entailment, contradiction, neutral.
        """
        if not pairs:
            return []

        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            _executor, self._inference_sync, pairs
        )
        return results

    async def predict_single(
        self, evidence: str, claim: str
    ) -> dict[str, float]:
        """
        Predict NLI scores for a single (evidence, claim) pair.
        
        Returns:
            Score dict: {"entailment": 0.9, "contradiction": 0.05, "neutral": 0.05}
        """
        results = await self.predict([(evidence, claim)])
        return results[0] if results else {"entailment": 0.0, "contradiction": 0.0, "neutral": 0.0}

    def get_label(self, scores: dict[str, float]) -> str:
        """Get the predicted NLI label from scores."""
        return max(scores, key=scores.get).upper()

    @property
    def is_loaded(self) -> bool:
        return self._loaded


# ── Module-level singleton ────────────────────────────────────────────────

_nli_model: Optional[NLIModel] = None


def get_nli_model() -> NLIModel:
    """Get or create the NLI model singleton."""
    global _nli_model
    if _nli_model is None:
        _nli_model = NLIModel()
    return _nli_model
