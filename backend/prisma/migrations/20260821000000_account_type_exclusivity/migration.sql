-- Account-type exclusivity: every User becomes exactly one of
-- CANDIDATE | ORGANIZATION. Dual identities (CandidateAccount AND
-- OrganizationMember rows on one user) are no longer valid.
--
-- The backfill below classifies existing rows from the data they already
-- have. It deliberately REFUSES to run while any dual-identity user exists:
-- deciding which side of a person's data survives is not a guess a migration
-- may make. Resolve each such user explicitly first —
-- see backend/scripts/resolve-dual-identity.ts — then re-run.

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CANDIDATE', 'ORGANIZATION');

-- Added nullable first: existing rows must be classified before the NOT NULL
-- contract can hold.
ALTER TABLE "users" ADD COLUMN "accountType" "AccountType";

-- Refuse to guess for dual-identity users.
DO $$
DECLARE
  dual_emails text;
BEGIN
  SELECT string_agg(u.email, ', ' ORDER BY u.email)
    INTO dual_emails
    FROM "users" u
   WHERE EXISTS (SELECT 1 FROM "candidate_accounts" ca WHERE ca."userId" = u.id)
     AND EXISTS (SELECT 1 FROM "organization_members" om WHERE om."userId" = u.id);

  IF dual_emails IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot backfill users.accountType: dual-identity users exist: '
                || dual_emails,
      HINT = 'Resolve each user explicitly with scripts/resolve-dual-identity.ts '
             || '(--email <email> --keep CANDIDATE|ORGANIZATION --apply), then '
             || 're-run this migration. No data was changed.';
  END IF;
END $$;

-- Backfill. Membership => ORGANIZATION. Everyone else — users with a
-- CandidateAccount and bare users (the old job-seeker registration created
-- the account in a separate later request) — is a CANDIDATE.
UPDATE "users" u
   SET "accountType" = 'ORGANIZATION'
 WHERE EXISTS (SELECT 1 FROM "organization_members" om WHERE om."userId" = u.id);

UPDATE "users" SET "accountType" = 'CANDIDATE' WHERE "accountType" IS NULL;

ALTER TABLE "users" ALTER COLUMN "accountType" SET NOT NULL;
