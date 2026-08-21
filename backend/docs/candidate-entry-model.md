# How candidates enter the product

**HR cannot create candidates and cannot upload candidate files.**
Recruiter-visible candidates originate from candidate applications to
HR-owned vacancies — there is no second path, and no hidden one.

```
HR creates a Vacancy
        ↓
CandidateAccount discovers it (public job board)
        ↓
Candidate uploads their OWN resume and applies
        ↓
Application (source = DIRECT) + org-scoped snapshot of that resume
        ↓
The vacancy's CREATOR gets NEW_APPLICATION
        ↓
Review → JD Evidence / AI Summary / Compare / Ask
        ↓
Interview invitation (unlocks the chat) or rejection
```

## What was removed

| Was | Now |
|---|---|
| `POST /candidates` — recruiter creates a candidate into a vacancy | **404**, route gone |
| `POST /applications` — recruiter attaches an existing candidate to a vacancy | **404**, route gone |
| `POST /documents` — recruiter uploads a CV for a candidate | **404**, route gone |
| `Document.uploadedById` (uploading HR, for processing notifications) | column dropped |
| `DOCUMENT_PROCESSING_COMPLETED` / `_FAILED` notifications | types dropped — no trigger can exist |
| `chatAvailable` / `NO_CANDIDATE_ACCOUNT` on invite | gone — every applicant has an account |
| `CANDIDATE_ALREADY_IN_VACANCY` (409) | gone with the association endpoint; applying twice is a plain 409 |

Removal is architectural. None of these is a hidden route, a permanent 403,
or a UI-level omission: the endpoints, DTOs and service methods do not exist.

## Who counts as a candidate now

One predicate, defined once in
`src/common/vacancy-access/applicant-scope.ts` and applied everywhere:

```ts
application.source === DIRECT           // the association came from an apply
candidate.candidateAccountId != null    // a real person owns this record
```

It gates the vacancy applicant list, the org candidate list and detail, every
application read/transition, Compare / JD Evidence / AI Summary / Ask /
Interview Questions (through `assertCandidateInVacancy`), AI Search results,
applicant counts, and vacancy-deletion recipients.

## Historical data

Records left behind by the removed features — recruiter-created candidates,
their documents, and `MANUAL_UPLOAD` applications — are **not deleted**. They
keep their rows and their truthful `source`; the predicate above simply
excludes them from the active workflow, so they surface nowhere and reach no
AI path. `MANUAL_UPLOAD` stays in the `ApplicationSource` enum for exactly
that reason. No CandidateAccount is ever fabricated for them.

## Document security (unchanged and unweakened)

Two disjoint stores, and removing HR upload does not merge them:

- **PERSONAL** (`candidateAccountId`): the candidate's own files, max 3,
  indexed into the candidate-only Qdrant collection which is queried
  **exclusively** by `candidateAccountId`. No recruiter path can reach it —
  removing HR upload did NOT give HR access to private CV chunks.
- **ORGANIZATION** (`organizationId`): the apply-time snapshot copy, indexed
  into the tenant collection. This is the only evidence recruiter AI sees,
  and it exists because the candidate submitted it to that vacancy.

Replacing or deleting a personal document never rewrites an application's
history: the snapshot is a separate object under the organization's
namespace.
