"""Typed application settings, read once from the environment.

No module reads ``os.environ`` directly. Nothing in here is ever logged: the
internal service token is a credential, and ``QDRANT_URL`` may carry one.
"""

from __future__ import annotations

from functools import lru_cache
from typing import ClassVar, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env.local", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Service ----------------------------------------------------------
    ai_service_port: int = Field(default=8000, ge=1, le=65535)
    ai_service_host: str = "0.0.0.0"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    # --- Internal auth ----------------------------------------------------
    # Shared with the NestJS backend. Requests to /internal/* must present it
    # in the X-Internal-Service-Token header. Never reuse a recruiter JWT.
    internal_service_token: str = ""

    # --- Progress callback -------------------------------------------------
    # Backend endpoint that receives real per-stage progress. Authenticated
    # with the same INTERNAL_SERVICE_TOKEN. Empty disables reporting.
    progress_callback_url: str = ""
    progress_callback_timeout_seconds: float = 5.0

    # --- Qdrant -----------------------------------------------------------
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""
    # Base collection name. The ACTIVE collection is this plus a version
    # suffix (see `active_collection`). Versioning exists because changing the
    # embedding model changes the vector width: the old collection stays intact
    # and serving while the new one is built, and is only retired once the
    # migration is verified.
    qdrant_collection: str = "resume_chunks"
    qdrant_collection_version: int = Field(default=1, ge=1)
    qdrant_timeout_seconds: float = 30.0

    # --- Candidate-side collections (Job Match) -----------------------------
    #
    # PHYSICALLY separate from the org-scoped resume collection. Personal
    # candidate resumes must never be reachable through any organization
    # filter, so they do not share a collection with tenant data — isolation
    # by construction, not by query discipline. Same versioning rationale as
    # `qdrant_collection`.
    qdrant_candidate_collection: str = "candidate_resume_chunks"
    qdrant_vacancy_collection: str = "vacancy_chunks"

    # --- Candidate job matching --------------------------------------------
    # How many vacancy chunks the first-stage vector search considers before
    # grouping into vacancies and reranking.
    match_vacancy_pool: int = Field(default=32, ge=4, le=200)
    # Per-vacancy cap on requirements compared in depth; a JD with 40 bullet
    # points does not get 40 retrieval rounds.
    match_max_requirements: int = Field(default=12, ge=1, le=30)

    # --- Embeddings -------------------------------------------------------
    #
    # paraphrase-multilingual-MiniLM-L12-v2 is the default because resumes in
    # this product may be English, Korean or other languages, and this model is
    # trained on 50+ languages while staying small enough (~470MB, 384 dims) to
    # run on a laptop CPU. See README for the full rationale.
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    embedding_batch_size: int = Field(default=16, ge=1, le=256)
    # Truncated to the model's own limit at load time; see EmbeddingModel.
    embedding_max_seq_length: int = Field(default=256, ge=32, le=512)

    # --- Reranking (PyTorch cross-encoder, second stage) -------------------
    #
    # bge-reranker-base is multilingual (XLM-RoBERTa), matching the multilingual
    # bi-encoder above so a Korean query can rerank English evidence.
    #
    # NOTE: the widely-cited `cross-encoder/ms-marco-MiniLM-L-6-v2` and
    # `-L6-v2` checkpoints produce NaN logits under transformers 4.57.x — the
    # NaN appears in the first encoder layer with clean weights and inputs.
    # They are unusable here; do not "restore" them without re-verifying.
    reranker_enabled: bool = True
    reranker_model: str = "BAAI/bge-reranker-base"
    # How many vector hits to hand the cross-encoder before cutting to `limit`.
    reranker_candidate_pool: int = Field(default=30, ge=1, le=200)

    # --- Grounded generation (LLM) ----------------------------------------
    #
    # Provider-neutral by design: application code depends on GenerationClient,
    # never on a vendor SDK. Switching provider is a config change.
    #
    # Secrets: each provider keeps its own named variable (GEMINI_API_KEY,
    # ANTHROPIC_API_KEY) because that is how the credential is actually issued
    # and rotated. LLM_API_KEY is a generic override that wins when set, so a
    # deployment can inject one secret under one name if it prefers.
    # `resolved_api_key` is the single place that precedence is decided.
    #
    # No key for the active provider => generation is disabled and every RAG
    # endpoint fails honestly rather than answering from the model's own
    # knowledge. Retrieval, search and JD mapping are unaffected.
    llm_provider: Literal["gemini", "anthropic", "none"] = "gemini"
    llm_model: str = ""
    llm_api_key: str = ""
    gemini_api_key: str = ""
    anthropic_api_key: str = ""
    llm_max_tokens: int = Field(default=4096, ge=256, le=32000)
    llm_timeout_seconds: float = Field(default=120.0, gt=0)
    # Grounded extraction wants determinism, not creativity: the task is to
    # report what the passages say, so near-zero temperature is correct.
    llm_temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    # Thinking models (gemini-2.5+/3.x) spend "thoughts" tokens INSIDE
    # max_output_tokens. Left uncapped, gemini-3.6-flash was measured thinking
    # 2300-3900 tokens on a routine candidate summary — starving the actual
    # structured answer and finishing MAX_TOKENS with no parsable payload
    # (~50% of calls). Grounded extraction is a reporting task, not a deep
    # reasoning one, so a small budget is correct; it also roughly halves
    # latency. The budget is a strong hint, not a hard cap — retries below
    # absorb the residual overshoot. 0 requests no thinking at all.
    llm_thinking_budget: int = Field(default=512, ge=0, le=24576)
    # Total attempts per generation call. Two failure classes are stochastic
    # and vanish on retry: transient provider errors (429/500/503/504) and
    # truncated/empty structured output. Measured without retries: roughly one
    # user-visible failure per three calls. Bounded attempts make that rare
    # without masking a persistent outage — the final error still surfaces.
    llm_max_attempts: int = Field(default=3, ge=1, le=5)

    # Default model per provider, used when LLM_MODEL is unset. Keeping the
    # default here rather than inline means the rest of the system never has to
    # know a model name.
    #
    # NOTE: `gemini-2.5-flash` was retired by Google for newer accounts: it
    # still appears in ListModels, but generateContent returns 404 ("no longer
    # available to new users") in every name format and API version. Do not
    # "restore" it without verifying against the live endpoint.
    _DEFAULT_MODELS: ClassVar[dict[str, str]] = {
        "gemini": "gemini-3.6-flash",
        "anthropic": "claude-opus-5",
    }

    # --- Requirement mapping ----------------------------------------------
    # Decision boundaries for JD -> evidence mapping. Measured against the
    # fixture resume; see docs/evidence-thresholding.md. These are NOT a
    # candidate score and are never returned to a client.
    mapping_lexical_found: float = Field(default=0.6, ge=0.0, le=1.0)
    mapping_semantic_review: float = Field(default=0.30, ge=0.0, le=1.0)
    mapping_max_evidence: int = Field(default=3, ge=1, le=20)
    mapping_candidate_pool: int = Field(default=8, ge=1, le=50)

    # --- Chunking ---------------------------------------------------------
    # Tuned for resumes, which have short sections. Leaving a multi-topic
    # Experience section as one ~800-char chunk measurably hurt retrieval: its
    # embedding averaged NestJS + Redis + Kubernetes together and a specific
    # "Kubernetes" query then ranked the generic Summary chunk first.
    chunk_target_chars: int = Field(default=400, ge=100, le=4000)
    chunk_overlap_chars: int = Field(default=80, ge=0, le=1000)
    # Sections shorter than this are kept whole rather than split, so a compact
    # skills list is not fragmented into meaningless pieces.
    chunk_min_split_chars: int = Field(default=350, ge=100, le=8000)

    # --- Uploads ----------------------------------------------------------
    max_file_size_bytes: int = Field(default=50 * 1024 * 1024, ge=1)

    # --- Model warm-up ----------------------------------------------------
    # Loading the model at import time makes tests slow and startup fragile;
    # readiness reports whether it is actually loaded.
    eager_load_models: bool = False

    @field_validator("qdrant_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def internal_auth_configured(self) -> bool:
        return bool(self.internal_service_token.strip())

    @property
    def resolved_api_key(self) -> str:
        """Credential for the active provider.

        Precedence: the generic LLM_API_KEY (an explicit deployment override)
        beats the provider-specific variable. Documented here so two variables
        can coexist without ambiguity.
        """
        if self.llm_api_key.strip():
            return self.llm_api_key.strip()
        if self.llm_provider == "gemini":
            return self.gemini_api_key.strip()
        if self.llm_provider == "anthropic":
            return self.anthropic_api_key.strip()
        return ""

    @property
    def resolved_llm_model(self) -> str:
        """Configured model, or the active provider's default."""
        if self.llm_model.strip():
            return self.llm_model.strip()
        return self._DEFAULT_MODELS.get(self.llm_provider, "")

    @property
    def generation_configured(self) -> bool:
        return self.llm_provider != "none" and bool(self.resolved_api_key)

    @property
    def active_collection(self) -> str:
        """Collection currently served, e.g. ``resume_chunks_v1``.

        A model change means bumping QDRANT_COLLECTION_VERSION and reindexing
        into the new name, never rewriting the live one in place — a failed
        migration must leave search working.
        """
        return f"{self.qdrant_collection}_v{self.qdrant_collection_version}"

    def collection_for_version(self, version: int) -> str:
        return f"{self.qdrant_collection}_v{version}"

    @property
    def active_candidate_collection(self) -> str:
        """Personal-resume collection, e.g. ``candidate_resume_chunks_v1``."""
        return f"{self.qdrant_candidate_collection}_v{self.qdrant_collection_version}"

    @property
    def active_vacancy_collection(self) -> str:
        """Vacancy index collection, e.g. ``vacancy_chunks_v1``."""
        return f"{self.qdrant_vacancy_collection}_v{self.qdrant_collection_version}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
