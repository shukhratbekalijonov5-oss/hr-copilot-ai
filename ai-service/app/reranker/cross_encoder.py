"""Second-stage cross-encoder reranker (PyTorch).

Vector search compares a query embedding against passage embeddings that were
computed independently — it never sees the pair together. A cross-encoder does:
it runs (query, passage) through a transformer jointly and scores the pair
directly, which is markedly more accurate but far too slow to run over a whole
collection. So it runs as a second stage over the top-N vector hits:

    query -> Qdrant top 20-30 -> cross-encoder -> top 5-10

The score produced is *query-to-passage relevance*. It says how well a passage
answers the query. It is not a candidate score, a hiring score, or a
probability of success, and nothing in this codebase may present it as one.

``ms-marco-MiniLM-L-6-v2`` is the default: 6 layers, ~90MB, trained for
exactly this passage-ranking task, and fast enough to rank 30 passages on CPU.
"""

from __future__ import annotations

import threading
import time

from app.common.errors import ModelUnavailableError
from app.common.logging import get_logger

logger = get_logger(__name__)


class CrossEncoderReranker:
    def __init__(self, model_name: str) -> None:
        self._model_name = model_name
        self._model = None
        self._lock = threading.Lock()

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load(self):
        if self._model is not None:
            return self._model

        with self._lock:
            if self._model is not None:
                return self._model
            started = time.perf_counter()
            try:
                from sentence_transformers import CrossEncoder

                model = CrossEncoder(self._model_name, device="cpu", max_length=512)
            except Exception as exc:
                raise ModelUnavailableError(
                    f"Reranker model '{self._model_name}' could not be loaded: {exc}"
                ) from exc

            self._model = model
            logger.info(
                "Reranker model loaded",
                extra={
                    "model": self._model_name,
                    "loadMs": int((time.perf_counter() - started) * 1000),
                },
            )
            return self._model

    def score(self, query: str, passages: list[str]) -> list[float]:
        """Scores each passage against the query. Higher is more relevant."""
        if not passages:
            return []
        model = self.load()
        scores = model.predict(
            [(query, passage) for passage in passages],
            show_progress_bar=False,
        )
        return [float(score) for score in scores]


_instance: CrossEncoderReranker | None = None
_instance_lock = threading.Lock()


def get_reranker() -> CrossEncoderReranker:
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                from app.config import get_settings

                _instance = CrossEncoderReranker(get_settings().reranker_model)
    return _instance


def reset_reranker() -> None:
    """Test hook: drops the cached singleton."""
    global _instance
    with _instance_lock:
        _instance = None
