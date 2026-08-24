-- CreateEnum
CREATE TYPE "ExternalProvider" AS ENUM ('GREENHOUSE', 'LEVER', 'ASHBY', 'NINEHIRE', 'COMPANY_CAREERS', 'WANTED', 'SARAMIN', 'JOBKOREA', 'OTHER');

-- CreateEnum
CREATE TYPE "ExternalAccessMethod" AS ENUM ('OFFICIAL_API', 'PUBLIC_FEED', 'PUBLIC_ENDPOINT', 'PARTNER_INTEGRATION');

-- CreateEnum
CREATE TYPE "ExternalJobStatus" AS ENUM ('ACTIVE', 'STALE', 'CLOSED', 'EXPIRED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ExternalSourceStatus" AS ENUM ('ACTIVE', 'CLOSED', 'GONE');

-- CreateEnum
CREATE TYPE "ExternalMergeConfidence" AS ENUM ('EXACT', 'HIGH', 'POSSIBLE');

-- CreateEnum
CREATE TYPE "ExternalIngestionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "external_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "domain" TEXT,
    "websiteUrl" TEXT,
    "countryCode" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_jobs" (
    "id" TEXT NOT NULL,
    "dedupeFingerprint" TEXT NOT NULL,
    "externalCompanyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "description" TEXT,
    "requirementsText" TEXT,
    "countryCode" TEXT,
    "region" TEXT,
    "city" TEXT,
    "workMode" "WorkMode",
    "remoteCountriesAllowed" TEXT[],
    "employmentType" "EmploymentType",
    "seniorityLevel" "SeniorityLevel",
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "currency" TEXT,
    "payPeriod" "PayPeriod",
    "skills" TEXT[],
    "industries" TEXT[],
    "benefits" "JobBenefit"[],
    "languageCodes" TEXT[],
    "visaSponsorship" "VisaSponsorship" NOT NULL DEFAULT 'UNKNOWN',
    "existingWorkAuthorizationRequired" BOOLEAN,
    "eligibleVisaTypes" TEXT[],
    "canonicalUrl" TEXT,
    "canonicalSourceId" TEXT,
    "status" "ExternalJobStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_job_sources" (
    "id" TEXT NOT NULL,
    "externalJobId" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL,
    "accessMethod" "ExternalAccessMethod" NOT NULL,
    "sourceJobId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "originalUrl" TEXT,
    "status" "ExternalSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "mergeConfidence" "ExternalMergeConfidence" NOT NULL DEFAULT 'EXACT',
    "mergeReason" TEXT,
    "payloadFingerprint" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_job_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_ingestion_runs" (
    "id" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL,
    "status" "ExternalIngestionStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "jobsFetched" INTEGER NOT NULL DEFAULT 0,
    "jobsCreated" INTEGER NOT NULL DEFAULT 0,
    "jobsUpdated" INTEGER NOT NULL DEFAULT 0,
    "jobsMerged" INTEGER NOT NULL DEFAULT 0,
    "jobsClosed" INTEGER NOT NULL DEFAULT 0,
    "jobsFailed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "external_ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_companies_domain_idx" ON "external_companies"("domain");

-- CreateIndex
CREATE INDEX "external_companies_normalizedName_idx" ON "external_companies"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "external_companies_normalizedName_domain_key" ON "external_companies"("normalizedName", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "external_jobs_dedupeFingerprint_key" ON "external_jobs"("dedupeFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "external_jobs_canonicalSourceId_key" ON "external_jobs"("canonicalSourceId");

-- CreateIndex
CREATE INDEX "external_jobs_status_lastSeenAt_idx" ON "external_jobs"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "external_jobs_status_countryCode_idx" ON "external_jobs"("status", "countryCode");

-- CreateIndex
CREATE INDEX "external_jobs_status_employmentType_idx" ON "external_jobs"("status", "employmentType");

-- CreateIndex
CREATE INDEX "external_jobs_status_seniorityLevel_idx" ON "external_jobs"("status", "seniorityLevel");

-- CreateIndex
CREATE INDEX "external_jobs_status_workMode_idx" ON "external_jobs"("status", "workMode");

-- CreateIndex
CREATE INDEX "external_jobs_externalCompanyId_idx" ON "external_jobs"("externalCompanyId");

-- CreateIndex
CREATE INDEX "external_jobs_normalizedTitle_idx" ON "external_jobs"("normalizedTitle");

-- CreateIndex
CREATE INDEX "external_jobs_status_lastVerifiedAt_idx" ON "external_jobs"("status", "lastVerifiedAt");

-- CreateIndex
CREATE INDEX "external_job_sources_externalJobId_idx" ON "external_job_sources"("externalJobId");

-- CreateIndex
CREATE INDEX "external_job_sources_provider_status_idx" ON "external_job_sources"("provider", "status");

-- CreateIndex
CREATE INDEX "external_job_sources_provider_lastSeenAt_idx" ON "external_job_sources"("provider", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_job_sources_provider_sourceKey_key" ON "external_job_sources"("provider", "sourceKey");

-- CreateIndex
CREATE INDEX "external_ingestion_runs_provider_startedAt_idx" ON "external_ingestion_runs"("provider", "startedAt");

-- AddForeignKey
ALTER TABLE "external_jobs" ADD CONSTRAINT "external_jobs_externalCompanyId_fkey" FOREIGN KEY ("externalCompanyId") REFERENCES "external_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_job_sources" ADD CONSTRAINT "external_job_sources_externalJobId_fkey" FOREIGN KEY ("externalJobId") REFERENCES "external_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
