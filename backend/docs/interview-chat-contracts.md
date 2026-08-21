# Interview Chat — API contracts for the frontend

Written for the frontend session, same style as `identity-contracts.md`.
Everything below is live behaviour, covered by unit + e2e tests. Base path:
`/api`, bearer auth, same guard chain as the rest of the product.

## 0. The product rule

Chat is NOT a general messenger. A conversation exists only inside one hiring
relationship: **HR ↔ vacancy ↔ candidate**, and only after HR performed
"Invite to interview" for that candidate on that vacancy. One vacancy holds
many conversations (one per invited candidate), each fully isolated.

Lifecycle — chat lives exactly as long as the hiring relationship does. Every
trigger below hard-deletes conversations **and all their messages,
permanently, for both sides**, inside the same database transaction as the
change that caused it. **No orphan chat can outlive its pipeline record.**

| # | Trigger | What is deleted |
|---|---|---|
| 1 | Reject **before** interview | Nothing — no conversation ever existed |
| 2 | Application → REJECTED **after** interview | ONLY that candidate's conversation on that vacancy |
| 3 | `DELETE /applications/:id` | ONLY that candidate's conversation on that vacancy |
| 4 | Vacancy → CLOSED (also archived/deleted) | ALL remaining conversations of that vacancy |

In cases 2 and 3 the scope is exactly one (vacancy, candidate) pair: another
candidate on the same vacancy, the same candidate on another vacancy, and
every other organization keep their chats.

There is no archive, no read-only mode and no undo — design the UI
accordingly (the Yes/No close confirmation is UX only; the backend enforces
deletion regardless of how the transition is called).

## 1. Inviting / rejecting (organization side)

```
POST /applications/:id/invite-interview        (OWNER | HR_ADMIN | RECRUITER)
  -> 201 {
       application: { …status:"INTERVIEW"…, vacancy:{id,title}, candidate:{id,fullName} },
       conversation: { id, vacancyId, createdAt }
     }
```

- Idempotent: repeating it returns the SAME conversation — never a duplicate.
- `409` when the vacancy is CLOSED/ARCHIVED.
- `conversation` is always present. Every applicant owns the
  CandidateAccount they applied with — recruiter-created candidates without
  one were removed from the product — so the old `chatAvailable` /
  `chatUnavailableReason:"NO_CANDIDATE_ACCOUNT"` fields are gone.
- `PATCH /applications/:id/status {status:"INTERVIEW"}` routes through the
  same transition internally (same conversation guarantee), but the explicit
  endpoint above returns the conversation and should be preferred.
Reject stays the existing endpoint: `PATCH /applications/:id/status
{status:"REJECTED"}` → `200` with the updated application. Rejection never
creates a chat, and its effect on an existing one depends only on whether the
candidate had been invited:

- **Reject before interview** — no conversation existed; nothing is deleted.
- **Reject after interview** — that candidate's conversation on that vacancy
  and every message in it are **hard-deleted immediately**, for HR and for
  the candidate. Connected clients get `conversation.closed` with
  `reason:"CANDIDATE_REJECTED"`; any later REST or socket access is a normal
  `404`. Other candidates on the same vacancy, the same candidate on other
  vacancies, and other organizations are never affected.

Re-inviting a previously rejected candidate opens a **fresh, empty**
conversation — the deleted transcript never returns. Remove the chat entry
from the HR list and the candidate's inbox as soon as the reject succeeds.

`DELETE /applications/:id` (OWNER/HR_ADMIN) → `200 {id, deleted:true}` behaves
the same way for chat: deleting the application removes the hiring
relationship, so that candidate's conversation on that vacancy and all its
messages are **hard-deleted in the same transaction**. Connected clients get
`conversation.closed` with `reason:"APPLICATION_DELETED"`. Deleting an
application that never reached interview simply succeeds — no conversation
existed and no event fires.

## 2. Conversations — organization side (@OrgScoped, VACANCY CREATOR only)

> **BREAKING (vacancy-scoped workspace, 2026-08-21):** organization
> membership alone no longer grants access. Every route below — and the
> socket `conversation.join` / `message.send` — additionally requires
> `conversation.vacancy.createdById === caller`. A same-org colleague's
> conversation is a plain `404`, indistinguishable from non-existent
> (conversations were never org-browsable). The unfiltered list is
> creator-scoped too; an explicit `vacancyId` filter must name one of the
> CALLER'S OWN vacancies (else `403 VACANCY_NOT_OWNED` / `404`). Interview
> invites likewise require the vacancy's creator. See
> `vacancy-workspace-contracts.md` §8.

```
GET  /conversations?vacancyId=&page=&limit=    -> paginated rows (own vacancies only)
GET  /conversations/:id                        -> one row
GET  /conversations/:id/messages?page=&limit=  -> paginated, createdAt ASC
POST /conversations/:id/messages {content}     -> 201 message
```

Row shape: `{ id, vacancyId, createdAt, updatedAt,
vacancy:{id,title,status}, candidate:{id,fullName,email} }`, ordered by
`updatedAt` DESC (most recently active first). Cross-tenant/unknown ids —
and same-org non-creator ids — are `404` (never confirms existence). A
CANDIDATE account gets `403 AUTH_ACCOUNT_TYPE_MISMATCH` here.

## 3. Conversations — candidate side (@CandidateScoped)

```
GET  /candidate-account/me/conversations                       -> paginated rows
GET  /candidate-account/me/conversations/:id                   -> one row
GET  /candidate-account/me/conversations/:id/messages?page=&limit=
POST /candidate-account/me/conversations/:id/messages {content}
```

Row shape: `{ id, createdAt, updatedAt,
vacancy:{publicSlug,title,status,organization:{name}} }`. Only the caller's
own conversations are ever visible; foreign ids are `404`. An ORGANIZATION
account gets `403 AUTH_ACCOUNT_TYPE_MISMATCH`.

## 4. Messages

`{ id, conversationId, senderParty: "ORGANIZATION"|"CANDIDATE", senderName,
content, createdAt }` — plain text, 1..4000 chars (server trims; blank is
`400`). Render "mine vs theirs" by comparing `senderParty` with the viewer's
side, never by name. No attachments, editing, reactions or read receipts in
this MVP. Messages persist server-side until the vacancy closes; refresh and
logout change nothing.

Privacy guarantees the UI can rely on: messages are never AI-processed,
never indexed, never part of search/match evidence; a conversation never
exposes the candidate's private profile or resume.

## 5. Realtime — socket.io namespace `/chat`

Connect exactly like `/processing` (same origin/CORS, `auth: { token }` with
the access token). Both account types connect here; an invalid token is
disconnected.

Client → server (all acknowledge):

```
emit("conversation.join",  { conversationId }) -> { joined: boolean, error? }
emit("conversation.leave", { conversationId }) -> { left: true }
emit("message.send", { conversationId, content }) -> { message } | { error }
```

Server → client:

```
"message.new"          -> a message object (fires for REST sends too — a
                          joined client needs no polling)
"conversation.closed"  -> { conversationId,
                            reason: "VACANCY_CLOSED"
                                  | "CANDIDATE_REJECTED"
                                  | "APPLICATION_DELETED" }
                          (the room is force-emptied; drop local state and
                          navigate away — the conversation no longer exists.
                          The reason is for the message you show the user;
                          all three are equally permanent)
```

Every join/send is re-authorized against the live database server-side;
errors are opaque (`NOT_FOUND` / `INVALID`) by design. After a token refresh,
reconnect with the new token.

## 6. Error semantics (unchanged project-wide)

`401` bad token · `403` wrong account type / no membership / role too low ·
`404` foreign, cross-tenant or deleted resource (indistinguishable from
non-existent — this is also what a rejected/closed conversation returns) ·
`409` duplicate/invalid transition (e.g. inviting on a closed vacancy) ·
`400` DTO validation.
