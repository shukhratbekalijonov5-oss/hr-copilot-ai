-- Allow a candidate to apply again after their previous attempt was REJECTED.
--
-- Before: `applications_vacancyId_candidateId_key` made (vacancyId, candidateId)
-- unique unconditionally, so a rejection permanently banned the candidate from
-- that vacancy — the row could never be joined by a second attempt.
--
-- After: duplicate protection is narrowed rather than removed. A PARTIAL unique
-- index enforces at most one NON-REJECTED application per (vacancy, candidate),
-- which still makes concurrent double-submits impossible at the database level,
-- while REJECTED rows drop out of the index and can accumulate as history.
--
-- Deliberately `<> 'REJECTED'` and not a broader "non-terminal" predicate:
-- WITHDRAWN and HIRED keep their current blocking behaviour untouched.

DROP INDEX IF EXISTS "applications_vacancyId_candidateId_key";

-- Fast lookups for the pair, now that the unique index no longer provides them.
CREATE INDEX IF NOT EXISTS "applications_vacancyId_candidateId_idx"
  ON "applications" ("vacancyId", "candidateId");

-- At most one live attempt per candidate per vacancy.
CREATE UNIQUE INDEX IF NOT EXISTS "applications_active_attempt_key"
  ON "applications" ("vacancyId", "candidateId")
  WHERE "status" <> 'REJECTED';
