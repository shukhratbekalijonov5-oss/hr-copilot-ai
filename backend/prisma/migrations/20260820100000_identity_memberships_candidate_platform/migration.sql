-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'ko', 'ru', 'uz');

-- CreateEnum
CREATE TYPE "ApplicationSource" AS ENUM ('DIRECT', 'EMAIL', 'LINKEDIN', 'INDEED', 'SARAMIN', 'JOBKOREA', 'WANTED', 'JUMPIT', 'REFERRAL', 'MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "source" "ApplicationSource" NOT NULL DEFAULT 'MANUAL_UPLOAD',
ADD COLUMN     "submittedDocumentId" TEXT;

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "candidateAccountId" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "candidateAccountId" TEXT,
ALTER COLUMN "organizationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "preferredLocale" "Locale" NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "vacancies" ADD COLUMN     "publicSlug" TEXT;

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'RECRUITER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headline" TEXT,
    "location" TEXT,
    "phone" TEXT,
    "summary" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "experience" JSONB,
    "education" JSONB,
    "resumeDocumentId" TEXT,
    "profileVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_jobs" (
    "id" TEXT NOT NULL,
    "candidateAccountId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_members_organizationId_idx" ON "organization_members"("organizationId");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_userId_organizationId_key" ON "organization_members"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_accounts_userId_key" ON "candidate_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_accounts_resumeDocumentId_key" ON "candidate_accounts"("resumeDocumentId");

-- CreateIndex
CREATE INDEX "saved_jobs_vacancyId_idx" ON "saved_jobs"("vacancyId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_jobs_candidateAccountId_vacancyId_key" ON "saved_jobs"("candidateAccountId", "vacancyId");

-- CreateIndex
CREATE INDEX "applications_source_idx" ON "applications"("source");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_organizationId_candidateAccountId_key" ON "candidates"("organizationId", "candidateAccountId");

-- CreateIndex
CREATE INDEX "documents_candidateAccountId_idx" ON "documents"("candidateAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "vacancies_publicSlug_key" ON "vacancies"("publicSlug");

-- CreateIndex
CREATE INDEX "vacancies_status_idx" ON "vacancies"("status");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_accounts" ADD CONSTRAINT "candidate_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_accounts" ADD CONSTRAINT "candidate_accounts_resumeDocumentId_fkey" FOREIGN KEY ("resumeDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_candidateAccountId_fkey" FOREIGN KEY ("candidateAccountId") REFERENCES "candidate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_candidateAccountId_fkey" FOREIGN KEY ("candidateAccountId") REFERENCES "candidate_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_submittedDocumentId_fkey" FOREIGN KEY ("submittedDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_candidateAccountId_fkey" FOREIGN KEY ("candidateAccountId") REFERENCES "candidate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill (data migration). Additive only: legacy users.role/organizationId
-- stay in place until the follow-up migration, after the backfill is verified.
-- ---------------------------------------------------------------------------

-- Every org-linked user becomes exactly one membership, preserving the role.
-- Membership createdAt inherits the user's createdAt so "joined" stays honest.
INSERT INTO "organization_members" ("id", "userId", "organizationId", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", u."organizationId", u."role", u."createdAt", CURRENT_TIMESTAMP
FROM "users" u
WHERE u."organizationId" IS NOT NULL
ON CONFLICT ("userId", "organizationId") DO NOTHING;

-- Every existing vacancy gets a stable public slug: title + org slug + a
-- 6-char digest of the immutable id (collision-proof and never regenerated).
-- A title with no ASCII letters/digits falls back to 'job'.
UPDATE "vacancies" v
SET "publicSlug" =
  coalesce(nullif(trim(both '-' from lower(regexp_replace(v."title", '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'job')
  || '-' || o."slug" || '-' || left(md5(v."id"), 6)
FROM "organizations" o
WHERE o."id" = v."organizationId" AND v."publicSlug" IS NULL;

-- applications.source needs no statement: the column default MANUAL_UPLOAD is
-- the true origin of every pre-migration row (all were recruiter-created).
