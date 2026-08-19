# Evidence thresholding

How the system decides between `EVIDENCE_FOUND`, `NEEDS_HUMAN_REVIEW` and
`NO_EVIDENCE_FOUND` for a job requirement — and why it is not a single
similarity threshold.

**None of these numbers is a candidate score.** They describe how well
retrieved text matches a requirement string. They are never exposed to a user
as a rating, a fit percentage, or a ranking.

---

## The measurement

Reranker scores for the top passage, measured against the fixture resume
(`tests/fixtures/resumes.py`, fictional candidate "Ji-woo Han"), using
`BAAI/bge-reranker-base` on CPU.

| Requirement | Present in CV? | Top rerank score |
|---|---|---|
| Redis Pub/Sub | yes | 0.9284 |
| NestJS | yes | 0.9060 |
| Professional working English | yes | 0.8727 |
| TypeScript | yes | 0.5745 |
| Production Kubernetes experience | yes | **0.1191** |
| Go programming | yes | **0.0549** |
| PostgreSQL schema design | yes | **0.0105** |
| AWS production experience | **no** | **0.0377** |
| Terraform infrastructure as code | no | 0.0134 |
| iOS Swift development | no | 0.0109 |
| Kafka Streams stateful processing | partial | 0.0055 |
| Machine learning model training | no | 0.0051 |
| Salesforce administration | no | 0.0053 |

### The ranges overlap

Lowest **present**: 0.0105 (PostgreSQL schema design)
Highest **absent**: 0.0377 (AWS production experience)

A requirement the candidate *does* meet scored **below** one they do *not*.
No single cutoff separates these sets. A cross-encoder scores how well a
passage answers a query — it is not a calibrated "does this person have this
skill" probability, and treating it as one produces confident wrong answers.

### Query reformulation did not help

Rewriting the requirement before retrieval made separation worse, not better:

| Template | Lowest present | Highest absent | Separable? |
|---|---|---|---|
| raw requirement text | 0.0105 | 0.0377 | no |
| `Does the candidate have {r}?` | 0.0033 | 0.0123 | no |
| `experience with {r}` | 0.0029 | 0.0345 | no |
| `{r} used in professional work experience` | 0.0096 | 0.0666 | no |

Raw text separates best and is what the code uses.

---

## What the system does instead

Two independent signals:

1. **Semantic retrieval** finds passages that plausibly address the
   requirement. This handles paraphrase and cross-language matching.
2. **Lexical verification** checks that the requirement's distinctive terms
   actually appear in those passages.

Measured lexical coverage on the same fixture:

| Requirement | Present? | Lexical coverage |
|---|---|---|
| NestJS / Redis Pub/Sub / Kubernetes / TypeScript / Go | yes | 1.00 |
| PostgreSQL schema design | yes | 0.50 |
| Kafka Streams stateful processing | partial | 0.50 |
| AWS / Machine learning / Salesforce / iOS Swift | **no** | **0.00** |

Genuinely-absent requirements score exactly **0.00**. That is the separation
the score alone could not give.

> During this measurement two requirements initially labelled "absent" —
> Terraform and Kafka — turned out to be listed in the fixture's own skills
> line. Lexical matching found them correctly; the *labels* were wrong. The
> fixture has since been aligned with the spec (Terraform removed).

---

## The decision rule

```
coverage >= MAPPING_LEXICAL_FOUND (0.6)          -> EVIDENCE_FOUND
0 < coverage < MAPPING_LEXICAL_FOUND             -> NEEDS_HUMAN_REVIEW
coverage == 0 and top score >= 0.30              -> NEEDS_HUMAN_REVIEW
coverage == 0 and top score <  0.30              -> NO_EVIDENCE_FOUND
```

All four constants are configurable:

| Variable | Default | Purpose |
|---|---|---|
| `MAPPING_LEXICAL_FOUND` | `0.6` | Coverage required for an automatic "found" |
| `MAPPING_SEMANTIC_REVIEW` | `0.30` | Zero-coverage escape hatch for synonyms / other languages |
| `MAPPING_MAX_EVIDENCE` | `3` | Passages returned per requirement |
| `MAPPING_CANDIDATE_POOL` | `8` | Passages retrieved before classification |

`MAPPING_SEMANTIC_REVIEW` is set at 0.30 — comfortably above every observed
absent score (max 0.0377) and below the strong present ones. It exists so a
requirement expressed as a synonym, or in another language, escalates to a
human instead of being denied outright.

### The middle band is the point

"Kafka Streams stateful processing" against a CV that lists *Kafka* but never
describes stream processing is genuinely uncertain. `NEEDS_HUMAN_REVIEW` says
so. That is more useful — and more honest — than a confident answer in either
direction.

---

## Known limitations

- **Lexical matching is script-sensitive.** Technology names usually survive in
  Latin script across languages, but a requirement written in Korean against a
  Korean CV that uses a translated term will not match lexically. The
  `MAPPING_SEMANTIC_REVIEW` path is the safety net, and it escalates rather
  than denies.
- **Thresholds are measured on one fixture resume.** They are a defensible
  starting point, not a calibrated model. Re-measure against a larger fictional
  corpus before relying on them at scale.
- **Coverage is unweighted.** Every requirement term counts equally, so a
  two-term requirement moves in 50% steps.

## Reproducing

`tests/test_requirement_mapping.py::TestRealJdMapping` runs the whole thing
against live Qdrant and the real models.
