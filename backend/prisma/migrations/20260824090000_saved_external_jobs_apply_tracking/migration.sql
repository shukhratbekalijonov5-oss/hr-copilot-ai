-- CreateEnum
CREATE TYPE "ExternalApplicationStatus" AS ENUM ('APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "candidate_saved_external_jobs" (
    "id" TEXT NOT NULL,
    "candidateAccountId" TEXT NOT NULL,
    "externalJobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_saved_external_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_external_job_applications" (
    "id" TEXT NOT NULL,
    "candidateAccountId" TEXT NOT NULL,
    "externalJobId" TEXT NOT NULL,
    "status" "ExternalApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_external_job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_saved_external_jobs_candidateAccountId_createdAt_idx" ON "candidate_saved_external_jobs"("candidateAccountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "candidate_saved_external_jobs_externalJobId_idx" ON "candidate_saved_external_jobs"("externalJobId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_saved_external_jobs_candidateAccountId_externalJo_key" ON "candidate_saved_external_jobs"("candidateAccountId", "externalJobId");

-- CreateIndex
CREATE INDEX "candidate_external_job_applications_candidateAccountId_appl_idx" ON "candidate_external_job_applications"("candidateAccountId", "appliedAt" DESC);

-- CreateIndex
CREATE INDEX "candidate_external_job_applications_candidateAccountId_stat_idx" ON "candidate_external_job_applications"("candidateAccountId", "status", "appliedAt" DESC);

-- CreateIndex
CREATE INDEX "candidate_external_job_applications_externalJobId_idx" ON "candidate_external_job_applications"("externalJobId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_external_job_applications_candidateAccountId_exte_key" ON "candidate_external_job_applications"("candidateAccountId", "externalJobId");

-- AddForeignKey
ALTER TABLE "candidate_saved_external_jobs" ADD CONSTRAINT "candidate_saved_external_jobs_candidateAccountId_fkey" FOREIGN KEY ("candidateAccountId") REFERENCES "candidate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_saved_external_jobs" ADD CONSTRAINT "candidate_saved_external_jobs_externalJobId_fkey" FOREIGN KEY ("externalJobId") REFERENCES "external_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_external_job_applications" ADD CONSTRAINT "candidate_external_job_applications_candidateAccountId_fkey" FOREIGN KEY ("candidateAccountId") REFERENCES "candidate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_external_job_applications" ADD CONSTRAINT "candidate_external_job_applications_externalJobId_fkey" FOREIGN KEY ("externalJobId") REFERENCES "external_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

