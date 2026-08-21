# Notifications — API contracts for the frontend

Base path: `/api`. Everything below is live behaviour, covered by unit + e2e
tests. PostgreSQL is the source of truth; the websocket is delivery
optimization only — an offline recipient sees everything on next login.

## Model

One structured record per notification (never a pre-rendered sentence — the
frontend renders in the viewer's locale). Related entities are ids + display
SNAPSHOTS, so a card renders after the underlying rows are deleted:

```json
{
  "id": "…", "type": "NEW_MESSAGE", "audience": "HR" | "CANDIDATE",
  "isRead": false, "readAt": null, "createdAt": "…",
  "vacancy":   { "id": "…", "title": "Backend Engineer", "deleted": false } | null,
  "candidate": { "id": "…", "name": "John Kim" } | null,
  "actor":     { "name": "Alice Park" } | null,
  "applicationId": "…" | null, "conversationId": "…" | null,
  "messageId": "…" | null,
  "messagePreview": "first ≤120 chars, plain text" | null
}
```

Types: `NEW_APPLICATION`, `NEW_MESSAGE`, `INTERVIEW_INVITATION`,
`VACANCY_DELETED`, `APPLICATION_REJECTED`.
`NEW_MESSAGE` is ONE type rendered per audience/actor. For
`VACANCY_DELETED`, `vacancy.deleted` is true and `vacancy.title` is a
pre-deletion snapshot — never fetch the vacancy, never link to it.

## Who gets what (backend-resolved, never client-supplied)

| Event | Recipient | Notes |
|---|---|---|
| Candidate applies | vacancy **creator** HR | never the whole org. Applying is the only way an application exists, so there is no source to gate on. |
| Candidate → HR message | vacancy creator | follows the creator-scoped chat model; other same-org HRs get nothing. |
| HR → candidate message | conversation's CandidateAccount owner | sender never notified about own message (both directions). |
| Interview invite | the candidate | only on a genuine transition (re-invite silent). |
| Rejection | the candidate | only SOMETHING→REJECTED; REJECTED→REJECTED is silent. HR gets no "you rejected X" echo. |
| Vacancy delete (single/bulk) | every applicant with a platform account, one notification PER deleted vacancy | recipients + title captured BEFORE deletion; events fire only AFTER the (all-or-nothing) transaction commits — a failed delete produces nothing. |

Document-processing notifications were **removed** along with HR document
upload: they existed to tell an HR user about a file THEY uploaded, and no
such file can exist any more.

## REST

```
GET   /notifications?page&limit&unreadOnly&type   → paginated, createdAt DESC
GET   /notifications/unread-count                 → { unread }
PATCH /notifications/:id/read                     → the updated notification
POST  /notifications/read-all                     → { updated }
```

- Authenticated, BOTH account types; there is NO create endpoint anywhere.
- Hard wall: `recipientUserId === caller` — foreign ids are 404,
  indistinguishable from non-existent. HR rows are additionally scoped to
  the token's active workspace (presentation, not authorization); candidate
  rows carry no organization.

## Realtime

Same authenticated `/chat` Socket.IO namespace. On connection the verified
token subject joins `user:{userId}`; new notifications arrive as
`notification:new` with the exact REST shape, to every tab/device (one DB
row regardless). The frontend consumes it through the SSE bridge
`GET /api/notifications/stream` (`notification` events) and dedupes by `id`;
on disconnect/reconnect, refetch unread-count — the DB is authoritative.

## Frontend rendering (already implemented)

`components/notifications/NotificationBell.tsx` + `lib/notifications/*`:
HR panel ≈480px with candidate/vacancy/preview hierarchy, candidate panel
≈400px simplified; 99+ badge; localized in en/ko/ru/uz
(`d.notifications.*`); deep links — HR NEW_APPLICATION →
`/candidates/:id?vacancyId=…`, HR NEW_MESSAGE →
`/interview-chats?conversation=…&vacancyId=…`, candidate message/invite →
`/my-interview-chats?conversation=…`, deleted/rejected →
`/my-applications` (informational-safe, never a dead vacancy link).
