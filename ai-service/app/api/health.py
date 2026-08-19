"""Liveness and readiness probes.

Readiness reports what is actually true: Qdrant is pinged for real and the
embedding model must be loadable. Neither check is stubbed — a service that
reports ready while its model is missing would let the backend queue work that
cannot succeed.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Response, status

from app.api.dependencies import get_embedder, get_store
from app.common.errors import redact
from app.models.schemas import HealthCheck, LivenessResponse, ReadinessResponse

router = APIRouter(prefix="/health", tags=["health"])

_STARTED_AT = time.monotonic()


@router.get("/live", response_model=LivenessResponse)
async def live() -> LivenessResponse:
    """200 whenever the process is alive. Touches no dependency."""
    return LivenessResponse(
        status="ok", uptimeSeconds=int(time.monotonic() - _STARTED_AT)
    )


@router.get("/ready", response_model=ReadinessResponse)
async def ready(response: Response) -> ReadinessResponse:
    """200 only when Qdrant answers and the embedding model is available."""
    checks: dict[str, HealthCheck] = {
        "qdrant": _check(lambda: get_store().ping()),
        "embeddingModel": _check(lambda: get_embedder().load()),
    }

    healthy = all(check.status == "up" for check in checks.values())
    response.status_code = (
        status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    )
    return ReadinessResponse(status="ok" if healthy else "error", checks=checks)


def _check(probe) -> HealthCheck:
    try:
        probe()
        return HealthCheck(status="up")
    except Exception as exc:
        # Type and short message only — no traceback, and any URL is redacted
        # because driver errors embed the connection string they failed on.
        return HealthCheck(
            status="down", error=redact(f"{type(exc).__name__}: {exc}")
        )
