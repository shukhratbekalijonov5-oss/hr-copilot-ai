# HR Copilot AI Service

Python FastAPI service that turns resumes into **searchable, citable evidence**
for HR Copilot AI.

```
NestJS backend ──(X-Internal-Service-Token)──> FastAPI
                                                 ├── parse (PDF / DOCX)
                                                 ├── section-aware chunking
                                                 ├── PyTorch embeddings
                                                 ├── Qdrant index
                                                 └── search + PyTorch reranking
```

## What this service does and does not do

It finds passages in resumes that match a query, and returns them with enough
provenance to cite (`resume.pdf · page 2`).

It does **not** decide whether to hire, reject, promote or fire anyone. It
produces no candidate-quality score and does not rank people by protected
attributes. `retrievalScore` and `rerankScore` describe **query ↔ passage
relevance** and nothing else — presenting either as a candidate rating would
misrepresent what was measured.

Where evidence is absent, the service returns weak-scoring passages that do not
contain it, rather than inventing a match. See "Evidence found vs not found".

---

## Requirements

- Python 3.12
- Qdrant (Docker)
- ~2GB disk for model weights on first run

---

## Getting started

```bash
cd ai-service
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt

cp .env.example .env
# set INTERNAL_SERVICE_TOKEN to the SAME value as backend/.env

docker run -d --name hrcopilot-qdrant -p 6333:6333 -p 6334:6334 \
  -v hrcopilot-qdrant-storage:/qdrant/storage qdrant/qdrant:v1.12.4

.venv/bin/python -m app.main
```

The service listens on `http://localhost:8000` (`AI_SERVICE_PORT`).

```bash
curl http://localhost:8000/health/live
curl http://localhost:8000/health/ready
```

Models download on first request (~1.6GB total) and are cached by Hugging Face.
Set `EAGER_LOAD_MODELS=true` to pay that cost at startup instead.

### Tests

```bash
.venv/bin/python -m pytest              # everything
.venv/bin/python -m pytest -m "not integration"   # no Qdrant needed
```

Integration tests skip automatically when Qdrant is not reachable. All fixtures
are fictional — **no real candidate data may enter this repository**.

---

## Ports

| Service        | Port   |
| -------------- | ------ |
| Frontend       | `3000` |
| NestJS backend | `3001` |
| **AI service** | `8000` |
| Qdrant HTTP    | `6333` |

---

## API

Every `/internal/*` route requires the `X-Internal-Service-Token` header. These
routes are for the backend only and must never be exposed to a browser.

| Method | Path                         | Purpose                                  |
| ------ | ---------------------------- | ---------------------------------------- |
| GET    | `/health/live`               | 200 while the process is alive           |
| GET    | `/health/ready`              | 200 when Qdrant **and** the model are up |
| POST   | `/internal/documents/process`| multipart: parse → chunk → embed → index |
| POST   | `/internal/search`           | semantic evidence search                 |
| POST   | `/internal/rerank`           | reorder supplied passages                |
| POST   | `/internal/documents/delete` | remove a document's vectors              |

### Internal authentication

Backend-to-AI traffic uses a dedicated shared secret (`INTERNAL_SERVICE_TOKEN`),
never a recruiter's JWT — an end-user token must not be replayable against
internal machinery. Missing and wrong tokens produce an identical `401`, the
comparison is constant-time, and the token is never logged or echoed.

If the token is unset the service **fails closed**: every `/internal/*` request
returns `503`. Unset never means "allow everyone".

---

## Model choices

### Embeddings — `paraphrase-multilingual-MiniLM-L12-v2`

384 dimensions, ~470MB, runs on CPU.

- **Multilingual by design.** Resumes here may be English, Korean or other
  languages. This model puts 50+ languages in one shared vector space, so a
  Korean query retrieves English evidence (there is a test for exactly that).
  A monolingual model would silently retrieve poorly instead of failing loudly.
- **Local.** Inference is in-process; resume text never leaves the service.
  Calling an external embedding API would ship personal data to a third party.
- **Small enough** to keep local development and CI honest.

The vector width is read from the loaded model, never hardcoded, and the Qdrant
collection is rejected at startup if its width disagrees.

### Reranking — `BAAI/bge-reranker-base`

A bi-encoder embeds query and passage separately and never sees them together.
A cross-encoder scores the pair jointly — much more accurate, far too slow for
a whole collection. So it runs as a second stage:

```
query → Qdrant top 30 → cross-encoder → top 10
```

This is where PyTorch earns its place. Measured on the test fixture:

| Query                              | Bi-encoder | Cross-encoder |
| ---------------------------------- | ---------- | ------------- |
| `Redis Pub/Sub` (**present**)      | 0.41       | **+0.9967**   |
| `production Kubernetes` (**present**) | 0.41    | **+0.2196**   |
| `AWS production experience` (**absent**) | 0.41 | **+0.0377**   |

The bi-encoder scores all three about the same — "AWS production experience"
shares the wording *"production experience"* with the resume, and cosine
similarity cannot tell that AWS specifically is missing. The cross-encoder
separates present from absent by more than an order of magnitude, which is what
makes an honest "evidence not found" possible.

> **Known issue:** `cross-encoder/ms-marco-MiniLM-L-6-v2` and `-L6-v2` produce
> `NaN` logits under transformers 4.57.x — the NaN appears in the first encoder
> layer with clean weights and valid inputs. They are unusable here. Do not
> switch back without re-verifying.

---

## Pipeline

### Parsing

- **PDF** via pdfminer.six layout analysis (primary), falling back to pypdf's
  plain text-layer read when pdfminer fails or scores worse on degradation
  signals. Layout analysis reconstructs word boundaries and column order from
  glyph positions, so per-glyph positioned CVs ("R a k h m a t i l l o") and
  multi-column layouts extract readably. Both outputs pass the same
  conservative cleanup (`app/parsers/text_cleanup.py`): evidently glyph-spaced
  lines are collapsed back into words; nothing ever splits merged words apart
  by guessing. Real page numbers are preserved. No OCR: a scan with no text
  layer is reported as `empty_document` rather than silently indexing nothing.
- **DOCX** via python-docx, including table cells. DOCX stores no pagination,
  so everything is page 1 and citations omit a page number — inventing page
  numbers would put a false locator behind a citation.

File type is decided by **magic bytes**, not by the declared content type or
the extension, both of which are caller-controlled.

### Section detection

Conservative pattern matching over common resume headings (English and Korean).
A heading must be a short line matching known vocabulary; a sentence merely
mentioning "experience" is not one. Unrecognised text is labelled `None`
("unknown"), never guessed — a fabricated section attribution would sit behind
a citation a human is meant to trust.

### Chunking

Tuned for resumes, whose sections are short:

```
CHUNK_TARGET_CHARS=400   CHUNK_OVERLAP_CHARS=80   CHUNK_MIN_SPLIT_CHARS=350
```

Short sections stay whole so a compact skills list is not fragmented. Long
sections split on paragraph then sentence boundaries with overlap.

These numbers were measured, not guessed. At the initial 900/1200 settings the
entire Experience section became one ~800-char chunk whose embedding averaged
NestJS + Redis + Kubernetes together — a specific "Kubernetes" query then
ranked the generic Summary chunk first. Splitting it fixed the ranking.

### Qdrant payload

```
organizationId  candidateId  documentId  section
pageNumber      chunkIndex   text        fileName  documentType
```

No signed URLs, storage keys or credentials: a leak of the vector store must
not become a leak of the documents.

---

## Multi-tenancy

`organizationId` arrives from the backend, which derived it from the
authenticated user's JWT. The AI service never accepts a tenant identity from
an end user.

`QdrantStore.search()` takes `organization_id` as a **required keyword
argument** and always builds the filter from it. There is no code path that can
query the collection without a tenant filter, so a caller cannot forget one.
A `candidateId` filter narrows *within* a tenant and cannot cross out of it.

---

## Idempotency

Point IDs are `uuid5(namespace, "{documentId}:{chunkIndex}")` — deterministic
across processes and restarts. Re-indexing deletes every existing point for the
document first, then upserts.

Delete-then-upsert rather than relying on ID collision alone: if a re-parse
produces *fewer* chunks, overwriting would leave the previous run's tail
vectors stranded in the index. A BullMQ retry therefore replaces a document's
vectors and never accumulates duplicates — both cases are tested.

---

## Evidence found vs not found

Vector search always returns nearest neighbours, so a query for an absent skill
still returns *something*. What must never happen is a returned passage that
appears to contain evidence it does not.

Tested against the fictional Ji-woo Han fixture, who **has** NestJS, Redis
Pub/Sub and production Kubernetes and **has no** AWS experience:

- `production Kubernetes experience` → the actual Kubernetes migration sentence
- `AWS production experience` → no passage containing AWS, scored ~26× lower
- same query as another organization → **zero** results

---

## Security

- Internal token: constant-time compare, fail-closed, never logged.
- Resume text is never logged — logs carry ids, stages, counts and durations.
- Search queries are not logged (user input may quote personal details).
- API errors return `{code, message}`; a Python traceback is never returned, as
  it can quote document text.
- URLs are redacted from health output — driver errors embed the connection
  string they failed on, which may carry credentials.
- Documents are streamed from the backend over the internal channel. The AI
  service never receives a public or signed URL, and none is stored in Qdrant.

---

## Logging

Structured JSON to stdout, with a per-request `requestId` (honours an inbound
`X-Request-Id`). Records carry `documentId`, `organizationId`, `candidateId`,
`stage`, `durationMs`, `chunkCount`, `vectorCount` and `errorType` — never raw
document contents.

---

## Docker

```bash
docker build -t hrcopilot-ai-service .
docker run --rm -p 8000:8000 \
  -e INTERNAL_SERVICE_TOKEN=... \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  -v hrcopilot-models:/models \
  hrcopilot-ai-service
```

Multi-stage, non-root (uid 10001), CPU-only torch, no `.env` or secrets in the
image. Mount a volume at `/models` so weights are not re-downloaded per start.

---

## Grounded generation (RAG)

Built on top of retrieval, behind `GenerationClient` so the provider is
swappable by configuration alone.

### Providers

| Provider | Client | Default model | SDK |
|---|---|---|---|
| **`gemini`** (active) | `GeminiGenerationClient` | `gemini-3.6-flash` | `google-genai` |
| `anthropic` | `AnthropicGenerationClient` | `claude-opus-5` | `anthropic` |
| `none` / no key | `DisabledGenerationClient` | — | — |

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=...        # provider-specific secret
LLM_MODEL=                # blank = provider default
```

`LLM_API_KEY` is a generic override that wins over the provider-specific
variable; precedence is decided in one place (`Settings.resolved_api_key`) so
the two cannot conflict silently. Both SDKs are imported lazily inside their
provider module, so only the configured one is ever loaded.

**Model choice — `gemini-3.6-flash`:** it supports the JSON-schema structured
output this pipeline depends on, handles all four product locales, and is the
low-latency/low-cost tier — appropriate because the model is doing constrained
extraction over a handful of retrieved passages, not open-ended reasoning.
Nothing outside `app/generation/` knows the model name; change `LLM_MODEL` to
move. (Its predecessor `gemini-2.5-flash` is retired for newer Google accounts:
ListModels still shows it, but generateContent returns 404.)

**This service is the only component that talks to the LLM.** The browser and
the NestJS backend never see the key.

```
question → retrieval → rerank → scrub → LLM → citation validation → answer
```

Four properties make it *grounded* rather than merely LLM-assisted:

1. **Empty retrieval never reaches the model.** With no evidence there is
   nothing to ground an answer in, so the LLM is not called at all and the
   caller gets `INSUFFICIENT_EVIDENCE`. Sending an empty context and hoping the
   model declines is not a control.
2. **Citations are validated, not trusted.** Every `chunkId` the model returns
   is checked against the exact passages that were sent to it. An id that was
   not in the context is rejected; page numbers and file names come from the
   retrieved chunk, never from model output, so a hallucinated locator is
   overwritten with the true one.
3. **A confident answer with no valid citation is downgraded** to
   `NEEDS_HUMAN_REVIEW`. A model can report `GROUNDED` while citing nothing
   real; that answer is not verifiable and must not be presented as grounded.
4. **The prompt forbids inference across technologies** and forbids inventing
   employers, dates, durations, education, certifications or languages — and
   forbids evaluating the candidate at all.

`status` describes the ANSWER (`GROUNDED` / `INSUFFICIENT_EVIDENCE` /
`NEEDS_HUMAN_REVIEW`). It is never a statement about the candidate.

### Locales

`en`, `ko`, `ru`, `uz`. The answer is written in the requested locale; the
**citation text is never translated** — it stays verbatim so a human can check
it against the real file.

### When generation is unavailable

Two distinct, non-500 outcomes — an operator can tell them apart:

| Situation | Response |
|---|---|
| No key for the active provider | `503 generation_disabled` |
| Provider rejected / timed out / quota | `503 generation_failed` |

Provider messages are **never forwarded**. They can name internal project ids
and quote the request, so only a status code is mapped to a short, stable
reason (`provider access denied`, `provider rate limit or quota exceeded`, …).

In both cases retrieval, semantic search and JD evidence mapping keep working —
none of them needs an LLM.

### Structured output

Gemini is given the same Pydantic schema the rest of the pipeline validates
(`response_mime_type="application/json"` + `response_schema`), so an answer
either arrives with machine-checkable citation ids or it does not arrive. A
blocked or truncated response raises rather than looking like an empty answer —
reporting "no evidence" when the truth is "the model did not answer" would be a
lie about the candidate.

Temperature defaults to `0.0`: this is a reporting task, not a creative one.

## JD → evidence mapping

`POST /internal/evidence-map` maps each job requirement to the candidate's
evidence and returns `EVIDENCE_FOUND` / `NO_EVIDENCE_FOUND` /
`NEEDS_HUMAN_REVIEW` — never a fit percentage.

This is **retrieval + classification, no LLM**. The decision combines semantic
retrieval with lexical verification of the requirement's own terms, because a
reranker score alone provably cannot separate present from absent skills on
this data. The measurements, the overlap that ruled out a single threshold, and
the resulting policy are in [`docs/evidence-thresholding.md`](docs/evidence-thresholding.md).

## Reindexing

Collections are versioned (`resume_chunks_v1`). Changing the embedding model
means building a new version alongside the live one, verifying, then switching
config — never rewriting the serving index in place. See
[`docs/reindexing.md`](docs/reindexing.md).

## Observability

`GET /internal/metrics` returns counters and timings (`rag_requests_total`,
`llm_errors_total`, `jd_mapping_duration_seconds`, `citations_rejected_total`,
…) as JSON. Deliberately dependency-free: the call sites are named correctly so
swapping in a real metrics backend is a change to `app/common/metrics.py`
alone.

## Not implemented yet

- **Bulk reindex job.** The collection versioning, `targetCollection`
  parameter and verification endpoint exist and are tested; the BullMQ job that
  walks every document is designed but not built (see `docs/reindexing.md`).
- **Live grounding evaluation has not been run.** `tests/test_rag_live.py`
  exercises a real model, but it is skipped without `LLM_API_KEY`. The unit
  suite proves the guardrails around the model, not the model's own honesty.
