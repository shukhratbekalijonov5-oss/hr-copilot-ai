"""A job-specific cover letter draft for ONE external job (MAX premium).

Same shape as why-match, deliberately: render the ONE shared premium context,
call the generator, return structured text. Nothing here ranks, scores,
retrieves or mutates — the letter is a draft written FROM supplied facts, and
the backend caches it keyed by the same current-state fingerprint every other
premium feature uses.

The honesty constraint is the whole feature: a letter that invents years of
experience, degrees or employment history is worse than no letter, because
the candidate may send it. The system rules forbid fabrication in the
imperative, the context supplies only what the candidate actually stated, and
a thin profile therefore produces a shorter, conservative letter rather than
a padded one.
"""

from __future__ import annotations

from app.candidate.external_premium_context import build_context
from app.common.errors import GenerationUnavailableError
from app.common.logging import get_logger
from app.generation.client import ExternalCoverLetter
from app.models.schemas import ExternalCoverLetterRequest

logger = get_logger(__name__)


def write_cover_letter(
    *,
    request: ExternalCoverLetterRequest,
    generator,
) -> ExternalCoverLetter:
    """Generate the draft, or raise a controlled unavailability.

    Never swallowed: this endpoint exists only to produce a letter, so
    "nothing" is not a usable answer. The caller turns the raised error into
    a stable AI-unavailable response; search, detail, saved jobs and tracking
    keep working because none of them call this path.
    """
    if generator is None or not generator.enabled:
        raise GenerationUnavailableError("Generation is not configured")

    context = build_context(request)
    try:
        return generator.generate_external_cover_letter(
            context=context, locale=request.locale
        )
    except GenerationUnavailableError:
        raise
