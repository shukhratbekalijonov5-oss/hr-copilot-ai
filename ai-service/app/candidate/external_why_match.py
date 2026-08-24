"""Why ONE external job matches ONE candidate (Task 4C.6).

The shape of this module is the point: it renders a context, calls the
generator, and returns prose. It does not rank, score, filter, retrieve or
decide anything — the backend arrives with every fact already resolved and
already minimized, and leaves with sentences.

## What it cannot do

There is no vector store here, no catalogue read, no scoring arithmetic and
no way to reach one. The canonical score and band arrive as opaque labels and
are echoed into the context as supplied facts; the response type
(`ExternalWhyMatch`) has no numeric field at all, so a model that tried to
disagree with the ranking would have nowhere to put the disagreement.

## Untrusted content

The context is rendered by `external_premium_context.build_context` — the ONE
renderer every premium feature shares — which fences job text, company text
and the candidate's own excerpts into labelled DATA blocks. The system rules
say, in the imperative, that instructions inside those blocks are content and
never commands. Fencing is not a guarantee on its own, which is why the task
is also narrow (explain these supplied facts), the output is
schema-constrained, and the response carries no field an injected instruction
could usefully target.
"""

from __future__ import annotations

from app.candidate.external_premium_context import (
    MAX_DESCRIPTION_CHARS,
    MAX_EXCERPT_CHARS,
    MAX_REQUIREMENTS_CHARS,
    build_context,
)
from app.common.errors import GenerationUnavailableError
from app.common.logging import get_logger
from app.generation.client import ExternalWhyMatch
from app.models.schemas import ExternalWhyMatchRequest

__all__ = [
    "MAX_DESCRIPTION_CHARS",
    "MAX_EXCERPT_CHARS",
    "MAX_REQUIREMENTS_CHARS",
    "build_context",
    "explain_external_match",
]

logger = get_logger(__name__)


def explain_external_match(
    *,
    request: ExternalWhyMatchRequest,
    generator,
) -> ExternalWhyMatch:
    """Generate the explanation, or raise a controlled unavailability.

    Failure is NOT swallowed here, unlike the batched job-match explanations:
    this endpoint exists only to produce an explanation, so "nothing" is not a
    usable answer. The caller turns the raised error into a stable
    AI-unavailable response, and every other external surface — search,
    detail, saved jobs, tracking — keeps working because none of them call
    this path.
    """
    if generator is None or not generator.enabled:
        raise GenerationUnavailableError("Generation is not configured")

    context = build_context(request)
    try:
        return generator.generate_external_why_match(
            context=context, locale=request.locale
        )
    except GenerationUnavailableError:
        # Logged by the caller with the request's own identifiers; re-raised
        # unchanged so the provider's own message never reaches a user.
        raise
