from __future__ import annotations

import os

import pytest

# Set before app.config is imported anywhere so the cached Settings pick it up.
TEST_TOKEN = "test-internal-service-token-value"
os.environ.setdefault("INTERNAL_SERVICE_TOKEN", TEST_TOKEN)
os.environ.setdefault("QDRANT_COLLECTION", "resume_chunks_test")
# The HTTP path resolves the personal collection from settings; point it at a
# test name so end-to-end tests never write into the dev personal collection.
os.environ.setdefault("QDRANT_CANDIDATE_COLLECTION", "candidate_resume_chunks_test")
os.environ.setdefault("ENVIRONMENT", "test")


@pytest.fixture(scope="session")
def internal_token() -> str:
    return os.environ["INTERNAL_SERVICE_TOKEN"]


@pytest.fixture()
def auth_headers(internal_token: str) -> dict[str, str]:
    return {"X-Internal-Service-Token": internal_token}


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def qdrant_available() -> bool:
    """True when a live Qdrant is reachable; integration tests skip otherwise."""
    import httpx

    from app.config import get_settings

    try:
        response = httpx.get(f"{get_settings().qdrant_url}/healthz", timeout=3.0)
        return response.status_code == 200
    except Exception:
        return False


@pytest.fixture()
def store(qdrant_available: bool):
    if not qdrant_available:
        pytest.skip("Qdrant is not running")

    from app.config import get_settings
    from app.vectorstore import QdrantStore

    settings = get_settings()
    return QdrantStore(
        settings.qdrant_url,
        settings.qdrant_collection,
        api_key=settings.qdrant_api_key,
    )


@pytest.fixture()
def candidate_store(qdrant_available: bool):
    """A throwaway PERSONAL collection, torn down after each test.

    Retrieval now reads the candidate personal collection, so integration
    tests index and search through a scratch CandidateResumeStore rather than
    the org-scoped QdrantStore.
    """
    if not qdrant_available:
        pytest.skip("Qdrant is not running")

    import uuid

    from app.candidate.store import CandidateResumeStore
    from app.config import get_settings

    settings = get_settings()
    scratch = CandidateResumeStore(
        settings.qdrant_url,
        f"test_candidate_chunks_{uuid.uuid4().hex[:8]}",
        api_key=settings.qdrant_api_key,
    )
    yield scratch
    scratch._client.delete_collection(scratch.collection)


@pytest.fixture()
def vacancy_store(qdrant_available: bool):
    if not qdrant_available:
        pytest.skip("Qdrant is not running")

    import uuid

    from app.candidate.store import VacancyStore
    from app.config import get_settings

    settings = get_settings()
    scratch = VacancyStore(
        settings.qdrant_url,
        f"test_vacancy_chunks_{uuid.uuid4().hex[:8]}",
        api_key=settings.qdrant_api_key,
    )
    yield scratch
    scratch._client.delete_collection(scratch.collection)


@pytest.fixture(scope="session")
def embedder():
    """The real PyTorch model. Downloaded once, then cached by huggingface."""
    from app.embeddings import EmbeddingModel

    model = EmbeddingModel(
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        batch_size=8,
        max_seq_length=256,
    )
    try:
        model.load()
    except Exception as exc:  # offline / no cache
        pytest.skip(f"Embedding model unavailable: {exc}")
    return model


@pytest.fixture(scope="session")
def reranker():
    """The real PyTorch cross-encoder used for second-stage ranking."""
    from app.reranker import CrossEncoderReranker
    from app.config import get_settings

    model = CrossEncoderReranker(get_settings().reranker_model)
    try:
        model.load()
    except Exception as exc:  # offline / no cache
        pytest.skip(f"Reranker model unavailable: {exc}")
    return model
