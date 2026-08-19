"""Internal service authentication.

Backend-to-AI traffic uses a dedicated shared credential, never a recruiter's
JWT: an end-user token must not be replayable against internal machinery, and
the AI service has no business validating user sessions.

The token is compared in constant time and never logged, echoed in an error, or
included in a response.
"""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, status

from app.common.logging import get_logger
from app.config import Settings, get_settings

logger = get_logger(__name__)

INTERNAL_TOKEN_HEADER = "X-Internal-Service-Token"


async def require_internal_token(
    x_internal_service_token: str | None = Header(default=None),
) -> None:
    """FastAPI dependency guarding every /internal/* route."""
    settings: Settings = get_settings()

    if not settings.internal_auth_configured:
        # Fail closed. An unset token must not mean "allow everyone".
        logger.error("INTERNAL_SERVICE_TOKEN is not configured; rejecting request")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal authentication is not configured",
        )

    if not x_internal_service_token or not secrets.compare_digest(
        x_internal_service_token, settings.internal_service_token
    ):
        # Deliberately identical response for missing and wrong tokens, and no
        # detail about what was received.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal service token",
        )
