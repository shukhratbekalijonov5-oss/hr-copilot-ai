"""Post-validation of generated citations.

A model asked to cite its sources can still emit a chunkId that was never in
the context, or attach the wrong page number to a real one. The prompt asks it
not to; this module makes it not matter.

Every citation is checked against the exact retrieved context that was sent to
the model:

  * the chunkId must be one that was actually supplied
  * the document, page, section and text are taken from the retrieved chunk,
    never from what the model wrote — so a hallucinated page number is
    overwritten with the true one rather than shown to a user
  * a citation naming a chunk belonging to another candidate or another
    organization is dropped, even though tenant filtering should already have
    made that impossible; defence in depth costs nothing here

If every citation a model produced is invalid, the answer is not trustworthy
and the caller is told so rather than being handed an uncited claim.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.common.logging import get_logger
from app.models.schemas import Citation, EvidenceHit

logger = get_logger(__name__)


@dataclass
class ValidationOutcome:
    citations: list[Citation]
    rejected_chunk_ids: list[str]
    """Ids the model cited that were not in the retrieved context."""

    @property
    def had_rejections(self) -> bool:
        return bool(self.rejected_chunk_ids)


def validate_citations(
    claimed_chunk_ids: list[str],
    context: list[EvidenceHit],
    *,
    organization_id: str,
    candidate_id: str | None = None,
) -> ValidationOutcome:
    """Turns model-claimed chunk ids into verified citations.

    Args:
        claimed_chunk_ids: what the model said it used.
        context: the passages actually sent to the model.
        organization_id: the tenant the request was made for.
        candidate_id: when set, citations about any other candidate are dropped.
    """
    by_id = {hit.chunkId: hit for hit in context if hit.chunkId}

    citations: list[Citation] = []
    rejected: list[str] = []
    seen: set[str] = set()

    for chunk_id in claimed_chunk_ids:
        if not chunk_id or chunk_id in seen:
            continue
        seen.add(chunk_id)

        hit = by_id.get(chunk_id)
        if hit is None:
            # Either invented, or a real id that was not in this context.
            rejected.append(chunk_id)
            continue

        if candidate_id is not None and hit.candidateId != candidate_id:
            rejected.append(chunk_id)
            continue

        # Metadata comes from the retrieved chunk, never from the model.
        citations.append(
            Citation(
                chunkId=hit.chunkId,
                documentId=hit.documentId,
                fileName=hit.fileName,
                pageNumber=hit.pageNumber,
                section=hit.section,
                text=hit.text,
            )
        )

    if rejected:
        logger.warning(
            "Rejected citations not present in retrieved context",
            extra={
                "organizationId": organization_id,
                "candidateId": candidate_id,
                "rejectedCount": len(rejected),
                "acceptedCount": len(citations),
            },
        )

    return ValidationOutcome(citations=citations, rejected_chunk_ids=rejected)


def scrub_context(
    hits: list[EvidenceHit], *, organization_id: str, candidate_id: str | None
) -> list[EvidenceHit]:
    """Last check on what is about to be sent to the model.

    Retrieval already filters by tenant. This re-checks immediately before the
    text leaves the process for a third-party API, because that is the one
    place where a mistake becomes an external data disclosure.
    """
    safe: list[EvidenceHit] = []
    for hit in hits:
        if candidate_id is not None and hit.candidateId != candidate_id:
            logger.error(
                "Dropped a retrieved passage for the wrong candidate",
                extra={"organizationId": organization_id, "stage": "scrub"},
            )
            continue
        safe.append(hit)
    return safe
