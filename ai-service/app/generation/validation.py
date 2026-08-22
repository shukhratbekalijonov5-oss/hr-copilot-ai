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

import re
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
    allowed_account_ids: set[str] | None = None,
) -> ValidationOutcome:
    """Turns model-claimed chunk ids into verified citations.

    Args:
        claimed_chunk_ids: what the model said it used.
        context: the passages actually sent to the model.
        allowed_account_ids: when set, citations whose passage belongs to any
            other candidate account are dropped.
    """
    by_id = {hit.chunkId: hit for hit in context if hit.chunkId}

    citations: list[Citation] = []
    rejected: list[str] = []
    seen: set[str] = set()

    # The prompt shows passages as "PASSAGE n — chunkId: <id>", and despite
    # being told to cite by chunkId the model sometimes cites by the passage
    # NUMBER instead. That is not an invented source — it is a deterministic
    # reference into the exact context we sent — so map it back to the real
    # chunkId before validating. Anything out of range stays rejected, and
    # membership/candidate checks below run unchanged, so nothing about this
    # loosens what a citation may point at.
    claimed_chunk_ids = [
        _normalise_claimed_id(raw, context) for raw in claimed_chunk_ids
    ]

    for chunk_id in claimed_chunk_ids:
        if not chunk_id or chunk_id in seen:
            continue
        seen.add(chunk_id)

        hit = by_id.get(chunk_id)
        if hit is None:
            # Either invented, or a real id that was not in this context.
            rejected.append(chunk_id)
            continue

        if (
            allowed_account_ids is not None
            and hit.candidateAccountId not in allowed_account_ids
        ):
            rejected.append(chunk_id)
            continue

        # Metadata comes from the retrieved chunk, never from the model. The
        # URL included: a model that invented a plausible-looking
        # "portfolio.example.com/kubernetes" would be handing a recruiter a
        # link that looks verifiable and leads nowhere.
        citations.append(
            Citation(
                chunkId=hit.chunkId,
                documentId=hit.documentId,
                fileName=hit.fileName,
                pageNumber=hit.pageNumber,
                section=hit.section,
                text=hit.text,
                sourceType=hit.sourceType,
                sourceTitle=hit.sourceTitle or hit.fileName,
                sourceUrl=hit.sourceUrl,
            )
        )

    if rejected:
        logger.warning(
            "Rejected citations not present in retrieved context",
            extra={
                "rejectedCount": len(rejected),
                "acceptedCount": len(citations),
            },
        )

    return ValidationOutcome(citations=citations, rejected_chunk_ids=rejected)


def scrub_context(
    hits: list[EvidenceHit], *, allowed_account_ids: set[str] | None
) -> list[EvidenceHit]:
    """Last check on what is about to be sent to the model.

    Retrieval already filters by the authorized accounts. This re-checks
    immediately before the text leaves the process for a third-party API,
    because that is the one place where a mistake becomes an external data
    disclosure.
    """
    safe: list[EvidenceHit] = []
    for hit in hits:
        if (
            allowed_account_ids is not None
            and hit.candidateAccountId not in allowed_account_ids
        ):
            logger.error(
                "Dropped a retrieved passage for the wrong candidate account",
                extra={"stage": "scrub"},
            )
            continue
        safe.append(hit)
    return safe


_ORDINAL_CLAIM = re.compile(r"^\[?\s*(\d{1,3})\s*\]?$")


def _normalise_claimed_id(raw: str, context: list[EvidenceHit]) -> str:
    """Maps a passage-ordinal claim ("3", "[3]") to the real chunkId."""
    match = _ORDINAL_CLAIM.match(raw.strip()) if raw else None
    if not match:
        return raw
    position = int(match.group(1))
    if 1 <= position <= len(context):
        return context[position - 1].chunkId
    return raw


_UUID_SOURCE = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
# A bracketed run of ordinals ("[1]", "[1, 3]"), a bracketed run of chunk ids,
# or a bare chunk id in prose.
_ANSWER_MARKER = re.compile(
    rf"\[\s*\d{{1,3}}(?:\s*[,;]\s*\d{{1,3}})*\s*\]"
    rf"|\[\s*{_UUID_SOURCE}(?:\s*[,;]?\s*{_UUID_SOURCE})*\s*\]"
    rf"|\({_UUID_SOURCE}\)"
    rf"|{_UUID_SOURCE}"
)
_NUM = re.compile(r"\d{1,3}")
_UUID = re.compile(_UUID_SOURCE)


def reconcile_answer_markers(
    answer: str,
    context: list[EvidenceHit],
    accepted: list[Citation],
) -> str:
    """Makes the answer PROSE agree with the validated citation list.

    The invariant delivered to callers: every citation marker remaining in the
    answer corresponds to an ACCEPTED citation, expressed canonically as
    ``[<chunkId>]``. Ordinal markers ("[3]") are rewritten to the accepted
    chunkId they refer to; markers whose reference was rejected (or points
    nowhere) are removed entirely. With zero accepted citations the answer
    therefore contains no source markers at all — an answer must never imply
    sources that the response does not carry.

    Prose brackets that are not pure ordinals/ids ("[internal tooling]") are
    untouched.
    """
    accepted_ids = {c.chunkId for c in accepted}

    def replace(match: re.Match) -> str:
        token = match.group(0)
        ids: list[str] = []
        uuids = _UUID.findall(token)
        if uuids:
            ids = [u for u in uuids if u in accepted_ids]
        else:
            for num in _NUM.findall(token):
                position = int(num)
                if 1 <= position <= len(context):
                    chunk_id = context[position - 1].chunkId
                    if chunk_id in accepted_ids and chunk_id not in ids:
                        ids.append(chunk_id)
        return "".join(f"[{i}]" for i in ids)

    cleaned = _ANSWER_MARKER.sub(replace, answer)
    # Removing a marker can leave doubled spaces or a space before punctuation.
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" +([.,;:!?)])", r"\1", cleaned)
    return cleaned.strip()
