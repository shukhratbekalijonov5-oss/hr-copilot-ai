-- Structured vacancy profile: compensation, location/work mode, work
-- authorization, languages, seniority, education, benefits, hiring lifecycle.
--
-- PURELY ADDITIVE AND NON-DESTRUCTIVE. Every statement below is CREATE TYPE,
-- ADD COLUMN or CREATE TABLE: no column is dropped, no row is rewritten, and
-- the legacy free-text `location`/`employmentType`/`experienceLevel` columns
-- are untouched and still authoritative for vacancies that predate this.
--
-- No value is BACKFILLED, deliberately. Every existing vacancy comes out of
-- this migration with its structured fields unset, which is the truth: those
-- employers never stated a salary, a work mode or a visa policy. Deriving any
-- of them from description prose would manufacture employer commitments that
-- were never made, so unknown stays unknown.
--
-- The two NOT NULL columns carry defaults that mean "nothing was claimed":
-- visaSponsorship=UNKNOWN and citizenshipRequirement=NONE (no restriction).

-- CreateEnum
CREATE TYPE "PayPeriod" AS ENUM ('HOURLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE');

-- CreateEnum
CREATE TYPE "VisaSponsorship" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CitizenshipRequirement" AS ENUM ('NONE', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "SeniorityLevel" AS ENUM ('INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'STAFF', 'MANAGER');

-- CreateEnum
CREATE TYPE "LanguageProficiency" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('HIGH_SCHOOL', 'ASSOCIATE', 'BACHELOR', 'MASTER', 'DOCTORATE');

-- CreateEnum
CREATE TYPE "HiringUrgency" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "JobBenefit" AS ENUM ('HEALTH_INSURANCE', 'MEAL_ALLOWANCE', 'HOUSING_SUPPORT', 'RELOCATION_SUPPORT', 'EDUCATION_BUDGET', 'REMOTE_ALLOWANCE', 'FLEXIBLE_HOURS', 'STOCK_OPTIONS', 'BONUS', 'PAID_LEAVE', 'OTHER');

-- AlterTable
ALTER TABLE "vacancies" ADD COLUMN     "applicationDeadline" TIMESTAMP(3),
ADD COLUMN     "benefits" "JobBenefit"[],
ADD COLUMN     "benefitsOther" TEXT,
ADD COLUMN     "citizenshipRequirement" "CitizenshipRequirement" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contractDurationMonths" INTEGER,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "domainExperience" TEXT[],
ADD COLUMN     "eligibleNationalities" TEXT[],
ADD COLUMN     "eligibleVisaTypes" TEXT[],
ADD COLUMN     "existingWorkAuthorizationRequired" BOOLEAN,
ADD COLUMN     "expectedStartDate" TIMESTAMP(3),
ADD COLUMN     "foreignApplicantsAccepted" BOOLEAN,
ADD COLUMN     "hiringUrgency" "HiringUrgency",
ADD COLUMN     "minExperienceYears" INTEGER,
ADD COLUMN     "officeDaysPerWeek" INTEGER,
ADD COLUMN     "openingsCount" INTEGER,
ADD COLUMN     "payPeriod" "PayPeriod",
ADD COLUMN     "preferredCertifications" TEXT[],
ADD COLUMN     "preferredEducation" "EducationLevel",
ADD COLUMN     "preferredExperienceYears" INTEGER,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "remoteCountriesAllowed" TEXT[],
ADD COLUMN     "requiredCertifications" TEXT[],
ADD COLUMN     "requiredEducation" "EducationLevel",
ADD COLUMN     "salaryMax" INTEGER,
ADD COLUMN     "salaryMin" INTEGER,
ADD COLUMN     "salaryNegotiable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seniorityLevel" "SeniorityLevel",
ADD COLUMN     "visaSponsorship" "VisaSponsorship" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "workMode" "WorkMode";

-- CreateTable
CREATE TABLE "vacancy_language_requirements" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "level" "LanguageProficiency" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vacancy_language_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vacancy_language_requirements_vacancyId_idx" ON "vacancy_language_requirements"("vacancyId");

-- CreateIndex
CREATE UNIQUE INDEX "vacancy_language_requirements_vacancyId_languageCode_key" ON "vacancy_language_requirements"("vacancyId", "languageCode");

-- AddForeignKey
ALTER TABLE "vacancy_language_requirements" ADD CONSTRAINT "vacancy_language_requirements_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
