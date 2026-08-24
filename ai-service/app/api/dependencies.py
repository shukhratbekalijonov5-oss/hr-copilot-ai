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


_candidate_store = None
_candidate_store_lock = threading.Lock()


def get_candidate_store():
    """Personal-resume collection — physically separate from tenant data."""
    global _candidate_store
    if _candidate_store is None:
        with _candidate_store_lock:
            if _candidate_store is None:
                from app.candidate.store import CandidateResumeStore

                settings = get_settings()
                _candidate_store = CandidateResumeStore(
                    settings.qdrant_url,
                    settings.active_candidate_collection,
                    api_key=settings.qdrant_api_key,
                    timeout=settings.qdrant_timeout_seconds,
                )
    return _candidate_store


_vacancy_store = None
_vacancy_store_lock = threading.Lock()


_external_job_store = None
_external_job_store_lock = threading.Lock()


def get_external_job_store():
    """External job index — public job ads, no tenant and no personal data."""
    global _external_job_store
    if _external_job_store is None:
        with _external_job_store_lock:
            if _external_job_store is None:
                from app.candidate.store import ExternalJobStore

                settings = get_settings()
                _external_job_store = ExternalJobStore(
                    settings.qdrant_url,
                    settings.active_external_job_collection,
                    api_key=settings.qdrant_api_key,
                    timeout=settings.qdrant_timeout_seconds,
                )
    return _external_job_store


def get_vacancy_store():
    """Candidate-discoverable vacancy index."""
    global _vacancy_store
    if _vacancy_store is None:
        with _vacancy_store_lock:
            if _vacancy_store is None:
                from app.candidate.store import VacancyStore

                settings = get_settings()
                _vacancy_store = VacancyStore(
                    settings.qdrant_url,
                    settings.active_vacancy_collection,
                    api_key=settings.qdrant_api_key,
                    timeout=settings.qdrant_timeout_seconds,
                )
    return _vacancy_store


def reset_candidate_stores() -> None:
    """Test hook: drops the cached candidate-side clients."""
    global _candidate_store, _vacancy_store
    with _candidate_store_lock:
        _candidate_store = None
    with _vacancy_store_lock:
        _vacancy_store = None
