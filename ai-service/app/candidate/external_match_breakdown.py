"""Prose for the Advanced Match Breakdown of ONE external job (MAX premium).

The division of labour is the whole design: the BACKEND classified every
dimension (STRONG/PARTIAL/GAP/UNKNOWN) from stored values and the shared
deterministic matchers before this module runs. What happens here is
rendering and prose only — the shared premium context plus a fourth fenced
block carrying the decided dimension table, and a schema whose only fields
are a summary and per-key explanations. A model that wanted to re-decide a
status has no field to put it in.
"""

from __future__ import annotations

from app.candidate.external_premium_context import build_context
from app.common.errors import GenerationUnavailableError
from app.common.logging import get_logger
from app.generation.client import ExternalMatchBreakdown
from app.models.schemas import ExternalMatchBreakdownRequest

logger = get_logger(__name__)


def _dimensions_block(request: ExternalMatchBreakdownRequest) -> str:
    lines: list[str] = []
    for dimension in request.dimensions:
        lines.append(
            f"- key: {dimension.key} | label: {dimension.label} | "
            f"status (already decided): {dimension.status}"
        )
        if dimension.matched:
            lines.append(f"    matched: {', '.join(dimension.matched)}")
        if dimension.missing:
            lines.append(f"    not shown on profile: {', '.join(dimension.missing)}")
        if dimension.reason.strip():
            lines.append(f"    deterministic ground: {dimension.reason.strip()}")
    if not lines:
        lines.append("(no dimensions were supplied)")
    return "\n".join(lines)


def build_breakdown_context(request: ExternalMatchBreakdownRequest) -> str:
    """The shared three DATA blocks plus the decided dimension table."""
    return (
        f"{build_context(request)}\n\n"
        "=== BEGIN DATA: DIMENSION STATUSES DECIDED BY THE SYSTEM "
        "(authoritative, explain them, never re-decide them) ===\n"
        f"{_dimensions_block(request)}\n"
        "=== END DATA: DIMENSION STATUSES ==="
    )


def breakdown_external_match(
    *,
    request: ExternalMatchBreakdownRequest,
    generator,
) -> ExternalMatchBreakdown:
    """Generate the prose, or raise a controlled unavailability."""
    if generator is None or not generator.enabled:
        raise GenerationUnavailableError("Generation is not configured")

    context = build_breakdown_context(request)
    try:
        return generator.generate_external_match_breakdown(
            context=context,
            locale=request.locale,
            dimension_keys=[d.key for d in request.dimensions],
        )
    except GenerationUnavailableError:
        raise
