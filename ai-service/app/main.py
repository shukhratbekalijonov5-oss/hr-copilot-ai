"""HR Copilot AI service — FastAPI application.

Responsibilities: parse resumes, chunk them, embed with PyTorch, index into
Qdrant, and answer semantic evidence searches with citable provenance.

Explicitly *not* responsibilities: deciding whether to hire, reject, promote or
fire anyone; scoring candidate quality; or ranking people by protected
attributes. Retrieval scores describe how well a passage matches a query, and
nothing else.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api import health, internal
from app.common.errors import AiServiceError
from app.common.logging import configure_logging, get_logger, request_id_var
from app.config import get_settings

settings = get_settings()
configure_logging(settings.log_level)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "AI service starting",
        extra={
            "port": settings.ai_service_port,
            "environment": settings.environment,
            "embeddingModel": settings.embedding_model,
            "rerankerEnabled": settings.reranker_enabled,
            "qdrantCollection": settings.qdrant_collection,
            # Never log the internal token or the Qdrant API key.
            "internalAuthConfigured": settings.internal_auth_configured,
        },
    )

    if not settings.internal_auth_configured:
        logger.warning(
            "INTERNAL_SERVICE_TOKEN is not set; all /internal/* requests will be "
            "rejected with 503 until it is configured"
        )

    if settings.eager_load_models:
        # Opt-in: pays the model load cost at boot instead of on the first
        # request. Without it a cold container's first search can take minutes
        # while ~1.6GB of weights download, long enough to time out.
        # Both models are loaded — the reranker is the larger of the two.
        from app.api.dependencies import get_cross_encoder, get_embedder

        for name, load in (
            ("embedding", lambda: get_embedder().load()),
            ("reranker", lambda: get_cross_encoder().load()),
        ):
            if name == "reranker" and not settings.reranker_enabled:
                continue
            try:
                load()
            except Exception as exc:
                # Startup continues; readiness reports the real state.
                logger.warning(
                    "Eager model load failed; readiness will report it",
                    extra={"model": name, "errorType": type(exc).__name__},
                )

    yield
    logger.info("AI service stopping")


app = FastAPI(
    title="HR Copilot AI Service",
    description=(
        "Resume parsing, embedding, vector indexing and semantic evidence "
        "retrieval for HR Copilot AI."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Attaches a request ID so every log line in a request can be correlated."""
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    token = request_id_var.set(request_id)
    try:
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response
    finally:
        request_id_var.reset(token)


@app.exception_handler(AiServiceError)
async def handle_domain_error(request: Request, exc: AiServiceError) -> JSONResponse:
    logger.warning(
        "Request failed",
        extra={"errorType": type(exc).__name__, "code": exc.code, "path": request.url.path},
    )
    return JSONResponse(
        status_code=exc.http_status,
        content={"code": exc.code, "message": exc.message},
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"code": "validation_error", "message": "Invalid request payload"},
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    """Last resort: never return a Python traceback to a caller.

    A traceback can quote document text and exposes internal structure. The
    detail goes to the log; the caller gets a flat 500.
    """
    logger.error(
        "Unhandled error",
        exc_info=True,
        extra={"path": request.url.path, "errorType": type(exc).__name__},
    )
    return JSONResponse(
        status_code=500,
        content={"code": "internal_error", "message": "An unexpected error occurred"},
    )


app.include_router(health.router)
app.include_router(internal.router)


def run() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.ai_service_host,
        port=settings.ai_service_port,
        log_config=None,
    )


if __name__ == "__main__":
    run()
