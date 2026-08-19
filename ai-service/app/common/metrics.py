"""In-process metrics for the AI pipeline.

Deliberately dependency-free. This is local development: pulling in a
Prometheus client and an exporter now would be infrastructure the project is
not ready to run. What matters at this stage is that the *call sites* exist and
are named correctly, so wiring a real backend later is a change in this file
rather than a hunt through the codebase.

Counters and timings are exposed at `GET /internal/metrics` as JSON. Swapping
the storage below for `prometheus_client` keeps every call site unchanged.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from contextlib import contextmanager

_lock = threading.Lock()
_counters: dict[str, int] = defaultdict(int)
# Kept as a running count + total so a histogram can be derived later without
# retaining every observation.
_durations: dict[str, dict[str, float]] = defaultdict(
    lambda: {"count": 0.0, "totalMs": 0.0, "maxMs": 0.0}
)

# Metric names. Defined as constants so a typo is a NameError, not a silently
# separate series.
RAG_REQUESTS = "rag_requests_total"
RAG_FAILURES = "rag_failures_total"
RAG_INSUFFICIENT_EVIDENCE = "rag_insufficient_evidence_total"
RAG_DURATION = "rag_duration_seconds"

LLM_REQUESTS = "llm_requests_total"
LLM_ERRORS = "llm_errors_total"
LLM_DURATION = "llm_duration_seconds"

RERANKER_DURATION = "reranker_duration_seconds"
RETRIEVAL_DURATION = "retrieval_duration_seconds"

JD_MAPPING_TOTAL = "jd_mapping_total"
JD_MAPPING_FAILURES = "jd_mapping_failures_total"
JD_MAPPING_DURATION = "jd_mapping_duration_seconds"

INDEXING_DOCUMENTS = "indexing_documents_total"
INDEXING_FAILURES = "indexing_failures_total"

CITATIONS_REJECTED = "citations_rejected_total"


def increment(name: str, amount: int = 1) -> None:
    with _lock:
        _counters[name] += amount


def observe_ms(name: str, milliseconds: float) -> None:
    with _lock:
        entry = _durations[name]
        entry["count"] += 1
        entry["totalMs"] += milliseconds
        entry["maxMs"] = max(entry["maxMs"], milliseconds)


@contextmanager
def timed(name: str):
    """Times a block and records it, whether or not it raises."""
    started = time.perf_counter()
    try:
        yield
    finally:
        observe_ms(name, (time.perf_counter() - started) * 1000)


def snapshot() -> dict:
    """Current values. Safe to expose — carries no tenant or document data."""
    with _lock:
        return {
            "counters": dict(_counters),
            "durations": {
                name: {
                    "count": int(v["count"]),
                    "totalMs": round(v["totalMs"], 2),
                    "avgMs": round(v["totalMs"] / v["count"], 2) if v["count"] else 0.0,
                    "maxMs": round(v["maxMs"], 2),
                }
                for name, v in _durations.items()
            },
        }


def reset() -> None:
    """Test hook."""
    with _lock:
        _counters.clear()
        _durations.clear()
