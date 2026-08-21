-- CreateTable
CREATE TABLE "candidate_job_match_runs" (
    "id" TEXT NOT NULL,
    "candidateAccountId" TEXT NOT NULL,
    "evidenceRevision" INTEGER NOT NULL,
    "vacancyFingerprint" TEXT NOT NULL,
    "totalRanked" INTEGER NOT NULL,
    "totalEligible" INTEGER NOT NULL DEFAULT 0,
    "capability" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_job_match_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_job_match_entries" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "matchedSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportedRequirements" JSONB NOT NULL,
    "unsupportedRequirements" JSONB NOT NULL,
    "unclearRequirements" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "explanations" JSONB,

    CONSTRAINT "candidate_job_match_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "candidate_job_match_runs_candidateAccountId_key" ON "candidate_job_match_runs"("candidateAccountId");

-- CreateIndex
CREATE INDEX "candidate_job_match_entries_runId_rank_idx" ON "candidate_job_match_entries"("runId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_job_match_entries_runId_vacancyId_key" ON "candidate_job_match_entries"("runId", "vacancyId");

-- AddForeignKey
ALTER TABLE "candidate_job_match_runs" ADD CONSTRAINT "candidate_job_match_runs_candidateAccountId_fkey" FOREIGN KEY ("candidateAccountId") REFERENCES "candidate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_job_match_entries" ADD CONSTRAINT "candidate_job_match_entries_runId_fkey" FOREIGN KEY ("runId") REFERENCES "candidate_job_match_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
