# Reindexing and model migration

## Reprocessing after a parser/chunker fix (same collection)

When extraction or chunking improves (e.g. the 2026-08 layout-aware PDF
extraction fix), already-indexed documents still hold text produced by the old
code. No collection version bump is needed — the vector width is unchanged —
and the fix is applied by re-running processing for each document **into the
active collection**:

- org documents → `POST /internal/documents/process` with the original file,
  `documentId`, `organizationId`, `candidateId`, `fileName`, `documentType`
  (all read from the `documents` row; the file comes from backend storage);
- personal resumes (`organizationId` null) →
  `POST /internal/candidate/documents/process` with `documentId`,
  `candidateAccountId`, `fileName`.

Both stores **delete the document's old points before upserting**, so a
reprocess replaces the malformed vectors entirely — a shorter re-parse cannot
strand stale chunks, and re-running is idempotent. Only `COMPLETED` documents
have vectors; `FAILED`/`UPLOADED` ones have nothing to replace.

The backend's `POST /documents/:id/reprocess` covers stuck (non-COMPLETED)
documents only; bulk reprocessing of COMPLETED documents is an operator task
against the internal API until the bulk reindex job below is built.

## Model migration (new collection version)

Changing `EMBEDDING_MODEL` changes the vector width. Qdrant rejects a
dimension mismatch (by design — mixing widths silently corrupts retrieval), so
a model change needs a migration, not an in-place rewrite.

## Versioned collections

The active collection is `QDRANT_COLLECTION` + `_v` + `QDRANT_COLLECTION_VERSION`:

```
resume_chunks_v1   <- currently serving
resume_chunks_v2   <- being built
```

The old collection keeps serving search throughout. It is retired only after
the new one is verified — a failed migration must never take search down.

## Procedure

1. **Build the new version.** Leave `QDRANT_COLLECTION_VERSION` alone; the AI
   service keeps serving `_v1`. Re-run processing for every document with
   `targetCollection=resume_chunks_v2` on `POST /internal/documents/process`.
   Only names beginning with `{QDRANT_COLLECTION}_v` are accepted, so this
   cannot write into an arbitrary collection.

2. **Verify.** `GET /internal/collections` reports the active collection, the
   loaded model, its dimension, and every collection present. Compare point
   counts and spot-check retrieval against `_v2` before switching.

3. **Switch.** Set `QDRANT_COLLECTION_VERSION=2` and restart. This is the only
   step that changes what users see, and it is a config change — reversible by
   setting it back.

4. **Retire.** Delete `resume_chunks_v1` only after the new version has served
   correctly for long enough to trust. Deleting early removes the rollback.

## Bulk reindex job — designed, not yet implemented

Reindexing thousands of documents must not be a synchronous HTTP call. The
intended shape, reusing the existing BullMQ infrastructure:

- a dedicated queue (`document-reindex`) so a long migration cannot starve
  normal `resume-processing` uploads;
- one job per document, carrying `{ documentId, organizationId, targetCollection }`
  — identifiers only, as with `PROCESS_DOCUMENT`;
- batched enqueue with a bounded rate, since every document re-reads its file
  from storage and re-embeds;
- progress tracked on a `ReindexRun` row (total / completed / failed);
- idempotent by construction: point ids are `uuid5(documentId, chunkIndex)` and
  indexing deletes-then-upserts, so a retried job replaces rather than
  duplicates;
- admin-only. This is not a recruiter action.

**Status: the collection versioning, the `targetCollection` parameter and the
verification endpoint exist and are tested. The queue job itself is not built.**
