"""Job-specific interview preparation for ONE external job (MAX premium).

NOT a generic question generator: every question exists because a supplied
job fact (a required skill, the seniority, the domain) or a supplied
deterministic match fact makes it likely, and every piece of preparation
advice points at what the candidate's CURRENT profile actually contains.
Where the job asks for something the profile does not show, the advice is to
prepare an honest account of the real current level — never a scripted story.

Same architecture as why-match and cover letter: the ONE shared premium
context in, structured output back, nothing ranked, retrieved or mutated.
"""

from __future__ import annotations

from app.candidate.external_premium_context import build_context
from app.common.errors import GenerationUnavailableError
from app.common.logging import get_logger
from app.generation.client import ExternalInterviewPrep
from app.models.schemas import ExternalInterviewPrepRequest

logger = get_logger(__name__)


def prepare_interview(
    *,
    request: ExternalInterviewPrepRequest,
    generator,
) -> ExternalInterviewPrep:
    """Generate the preparation, or raise a controlled unavailability."""
    if generator is None or not generator.enabled:
        raise GenerationUnavailableError("Generation is not configured")

    context = build_context(request)
    try:
        return generator.generate_external_interview_prep(
            context=context, locale=request.locale
        )
    except GenerationUnavailableError:
        raise
