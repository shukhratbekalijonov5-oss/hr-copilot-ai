"""Shared FastAPI dependencies (singletons for model and vector store)."""

from __future__ import annotations

import threading

from app.config import Settings, get_settings
from app.embeddings import EmbeddingModel, get_embedding_model
from app.reranker import CrossEncoderReranker, get_reranker
from app.vectorstore import QdrantStore

_store: QdrantStore | None = None
_store_lock = threading.Lock()


def get_store() -> QdrantStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                settings = get_settings()
                _store = QdrantStore(
                    settings.qdrant_url,
                    settings.active_collection,
                    api_key=settings.qdrant_api_key,
                    timeout=settings.qdrant_timeout_seconds,
                )
    return _store


def reset_store() -> None:
    """Test hook: drops the cached client."""
    global _store
    with _store_lock:
        _store = None


def get_progress_reporter():
    from app.common.progress import ProgressReporter

    settings = get_settings()
    return ProgressReporter(
        settings.progress_callback_url,
        settings.internal_service_token,
        timeout=settings.progress_callback_timeout_seconds,
    )


_generator = None
_generator_lock = threading.Lock()


def get_generator():
    """The configured GenerationClient, or a disabled one that refuses."""
    global _generator
    if _generator is None:
        with _generator_lock:
            if _generator is None:
                from app.generation.factory import build_generation_client

                _generator = build_generation_client(get_settings())
    return _generator


def reset_generator() -> None:
    """Test hook: drops the cached client."""
    global _generator
    with _generator_lock:
        _generator = None


def get_current_settings() -> Settings:
    return get_settings()


def get_embedder() -> EmbeddingModel:
    return get_embedding_model()


def get_cross_encoder() -> CrossEncoderReranker:
    return get_reranker()
