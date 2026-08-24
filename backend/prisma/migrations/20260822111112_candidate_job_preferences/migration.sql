-- Candidate Job Preferences: what job the candidate WANTS.
--
-- PURELY ADDITIVE. Every statement is CREATE TYPE, CREATE TABLE, CREATE INDEX
-- or ADD CONSTRAINT on the new tables. NO existing table is altered, no column
-- is dropped, no row is read or rewritten — users, candidate accounts,
-- candidates, applications, vacancies, documents and evidence are untouched.
--
-- Every existing candidate comes out of this migration with NO preference row,
-- and that is the correct and only honest state: none of them has ever stated
-- what they are looking for. Nothing is seeded or inferred from resumes,
-- applications, saved jobs, profile locations or past searches. "No row" reads
-- as "stated no preferences" everywhere, and Job Match keeps behaving exactly
-- as it did.
--
-- The employment-type enum is NEW vocabulary; `vacancies.employmentType` keeps
-- its original free text and is deliberately not migrated (see
-- normalizeEmploymentType in src/common/vacancy/job-vocabulary.ts).

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "PreferredLocationKind" AS ENUM ('PREFERRED', 'EXCLUDED');

-- CreateTable
CREATE TABLE "candidate_job_preferences" (
    "id" TEXT NOT NULL,
    "candidateAccountId" TEXT NOT NULL,
    "preferredJobTitles" TEXT[],
    "preferredWorkModes" "WorkMode"[],
    "preferredEmploymentTypes" "EmploymentType"[],
    "preferredSeniorityLevels" "SeniorityLevel"[],
    "desiredSalaryMin" INTEGER,
    "salaryCurrency" TEXT,
    "payPeriod" "PayPeriod",
    "willingToRelocate" BOOLEAN,
    "preferredIndustries" TEXT[],
    "preferredBenefits" "JobBenefit"[],
    "excludedCompanies" TEXT[],
    "excludedJobTitles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_job_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_preferred_locations" (
    "id" TEXT NOT NULL,
    "preferencesId" TEXT NOT NULL,
    "kind" "PreferredLocationKind" NOT NULL DEFAULT 'PREFERRED',
    "countryCode" TEXT NOT NULL,
    "region" TEXT,
    "city" TEXT,

    CONSTRAINT "candidate_preferred_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "candidate_job_preferences_candidateAccountId_key" ON "candidate_job_preferences"("candidateAccountId");

-- CreateIndex
CREATE INDEX "candidate_preferred_locations_preferencesId_idx" ON "candidate_preferred_locations"("preferencesId");

-- CreateIndex
CREATE INDEX "candidate_preferred_locations_preferencesId_kind_idx" ON "candidate_preferred_locations"("preferencesId", "kind");

-- AddForeignKey
ALTER TABLE "candidate_job_preferences" ADD CONSTRAINT "candidate_job_preferences_candidateAccountId_fkey" FOREIGN KEY ("candidateAccountId") REFERENCES "candidate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_preferred_locations" ADD CONSTRAINT "candidate_preferred_locations_preferencesId_fkey" FOREIGN KEY ("preferencesId") REFERENCES "candidate_job_preferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
