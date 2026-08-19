"""Reports pipeline stages back to the NestJS backend as they complete.

This exists so document progress is *observed* rather than guessed. The backend
cannot see inside a single /internal/documents/process call, so if it wrote
PARSING -> CHUNKING -> EMBEDDING -> INDEXING around that call it would be
inventing transitions. Instead the service that performs each stage reports it
the moment it finishes.

Reporting is best-effort: progress is a UI nicety, and a callback failure must
never fail a document that was otherwise processed correctly.
"""

from __future__ import annotations

import httpx

from app.common.logging import get_logger, request_id_var

logger = get_logger(__name__)

# Mirrors the backend's DocumentStatus values for the stages the AI service
# actually performs. COMPLETED/FAILED are terminal and owned by the worker.
STAGE_PARSING = "PARSING"
STAGE_CHUNKING = "CHUNKING"
STAGE_EMBEDDING = "EMBEDDING"
STAGE_INDEXING = "INDEXING"


class ProgressReporter:
    """Posts stage updates to the backend's internal progress endpoint."""

    def __init__(
        self,
        callback_url: str,
        token: str,
        *,
        timeout: float = 5.0,
        enabled: bool = True,
    ) -> None:
        self._url = callback_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._enabled = enabled and bool(self._url) and bool(token)

    @property
    def enabled(self) -> bool:
        return self._enabled

    def report(
        self,
        *,
        document_id: str,
        organization_id: str,
        stage: str,
        progress: int,
    ) -> None:
        if not self._enabled:
            return

        headers = {
            # Same shared credential the backend uses to call this service.
            # Never logged.
            "X-Internal-Service-Token": self._token,
            "content-type": "application/json",
        }
        request_id = request_id_var.get()
        if request_id:
            headers["X-Request-Id"] = request_id

        try:
            response = httpx.post(
                self._url,
                json={
                    "documentId": document_id,
                    "organizationId": organization_id,
                    "stage": stage,
                    "progress": progress,
                },
                headers=headers,
                timeout=self._timeout,
            )
            if response.status_code >= 400:
                logger.warning(
                    "Progress callback rejected",
                    extra={
                        "documentId": document_id,
                        "organizationId": organization_id,
                        "stage": stage,
                        "statusCode": response.status_code,
                    },
                )
        except Exception as exc:
            # Never fail the document because the UI missed an update.
            logger.warning(
                "Progress callback failed",
                extra={
                    "documentId": document_id,
                    "organizationId": organization_id,
                    "stage": stage,
                    "errorType": type(exc).__name__,
                },
            )


class NullProgressReporter(ProgressReporter):
    """Used when no callback URL is configured (e.g. in tests)."""

    def __init__(self) -> None:
        super().__init__("", "", enabled=False)
