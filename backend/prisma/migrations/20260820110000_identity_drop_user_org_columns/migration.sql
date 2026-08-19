-- Destructive step of the identity migration. Runs ONLY after the previous
-- migration backfilled organization_members and the counts were verified
-- (every org-linked user -> exactly one membership, role preserved, owners
-- intact, no duplicates, slugs unique).
--
-- Rollback path (conceptual): re-add users.role/users."organizationId" and
-- reverse-fill from organization_members — deterministic for pre-cutover data
-- because each user had exactly one membership at the moment of this drop.

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_organizationId_fkey";

-- DropIndex
DROP INDEX "users_organizationId_idx";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "organizationId",
DROP COLUMN "role";

-- AlterTable
ALTER TABLE "vacancies" ALTER COLUMN "publicSlug" SET NOT NULL;
