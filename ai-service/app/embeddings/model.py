"""Sentence-embedding model (PyTorch, via sentence-transformers).

Model choice — ``paraphrase-multilingual-MiniLM-L12-v2``:

  * Multilingual. Resumes in this product may be English, Korean or other
    languages, and a monolingual model would silently retrieve poorly on them.
    This model covers 50+ languages in one shared vector space, so a Korean
    resume is searchable with an English query.
  * Small. ~470MB, 384 dimensions, 12 layers — it runs on a laptop CPU with no
    GPU, which keeps local development and CI realistic.
  * Local. Inference happens in-process with PyTorch; no text is sent to an
    external API, which matters because resumes are personal data.

The vector dimension is read from the loaded model rather than hardcoded, so
swapping EMBEDDING_MODEL cannot silently desynchronise the Qdrant collection.
"""

from __future__ import annotations

import threading
import time

from app.common.errors import ModelUnavailableError
from app.common.logging import get_logger

logger = get_logger(__name__)


class EmbeddingModel:
    """Lazily-loaded singleton wrapper around a SentenceTransformer."""

    def __init__(
        self,
        model_name: str,
        *,
        batch_size: int = 16,
        max_seq_length: int = 256,
    ) -> None:
        self._model_name = model_name
        self._batch_size = batch_size
        self._max_seq_length = max_seq_length
        self._model = None
        self._dimension: int | None = None
        # Loading is slow; make concurrent first requests wait rather than
        # each loading its own copy of the weights.
        self._lock = threading.Lock()

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def dimension(self) -> int:
        """Vector width, taken from the model itself."""
        self.load()
        assert self._dimension is not None
        return self._dimension

    def load(self):
        if self._model is not None:
            return self._model

        with self._lock:
            if self._model is not None:
                return self._model
            started = time.perf_counter()
            try:
                # Imported here so merely importing this module does not pull
                # torch into memory (keeps unrelated tests fast).
                from sentence_transformers import SentenceTransformer

                model = SentenceTransformer(self._model_name, device="cpu")
                model.max_seq_length = min(
                    self._max_seq_length, model.max_seq_length or self._max_seq_length
                )
                dimension = model.get_sentence_embedding_dimension()
            except Exception as exc:
                raise ModelUnavailableError(
                    f"Embedding model '{self._model_name}' could not be loaded: {exc}"
                ) from exc

            self._model = model
            self._dimension = int(dimension)
            logger.info(
                "Embedding model loaded",
                extra={
                    "model": self._model_name,
                    "dimension": self._dimension,
                    "loadMs": int((time.perf_counter() - started) * 1000),
                },
            )
            return self._model

    def encode_passages(self, texts: list[str]) -> list[list[float]]:
        """Embeds document chunks for indexing."""
        return self._encode(texts)

    def encode_query(self, text: str) -> list[float]:
        """Embeds a single search query."""
        return self._encode([text])[0]

    def _encode(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        model = self.load()
        vectors = model.encode(
            texts,
            batch_size=self._batch_size,
            # Cosine similarity in Qdrant assumes unit-length vectors.
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return [vector.tolist() for vector in vectors]


_instance: EmbeddingModel | None = None
_instance_lock = threading.Lock()


def get_embedding_model() -> EmbeddingModel:
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                from app.config import get_settings

                settings = get_settings()
                _instance = EmbeddingModel(
                    settings.embedding_model,
                    batch_size=settings.embedding_batch_size,
                    max_seq_length=settings.embedding_max_seq_length,
                )
    return _instance


def reset_embedding_model() -> None:
    """Test hook: drops the cached singleton."""
    global _instance
    with _instance_lock:
        _instance = None
