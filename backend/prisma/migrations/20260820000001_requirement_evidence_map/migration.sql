-- CreateEnum
CREATE TYPE "EvidenceMappingStatus" AS ENUM ('EVIDENCE_FOUND', 'NO_EVIDENCE_FOUND', 'NEEDS_HUMAN_REVIEW');

-- AlterTable
-- `updatedAt` is NOT NULL. Prisma emits it without a default, which fails on a
-- table that already has rows, so backfill with CURRENT_TIMESTAMP and only then
-- drop the default (Prisma sets the value on every write from here on).
ALTER TABLE "candidate_evidence" ADD COLUMN     "requirementMapId" TEXT,
ADD COLUMN     "sourceChunkId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "candidate_evidence" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "requirement_evidence_maps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "status" "EvidenceMappingStatus" NOT NULL,
    "reason" TEXT,
    "matchedTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_evidence_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requirement_evidence_maps_organizationId_idx" ON "requirement_evidence_maps"("organizationId");

-- CreateIndex
CREATE INDEX "requirement_evidence_maps_organizationId_candidateId_idx" ON "requirement_evidence_maps"("organizationId", "candidateId");

-- CreateIndex
CREATE INDEX "requirement_evidence_maps_organizationId_vacancyId_idx" ON "requirement_evidence_maps"("organizationId", "vacancyId");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_evidence_maps_candidateId_vacancyId_requirement_key" ON "requirement_evidence_maps"("candidateId", "vacancyId", "requirementId");

-- CreateIndex
CREATE INDEX "candidate_evidence_requirementMapId_idx" ON "candidate_evidence"("requirementMapId");

-- CreateIndex
CREATE INDEX "candidate_evidence_sourceChunkId_idx" ON "candidate_evidence"("sourceChunkId");

-- AddForeignKey
ALTER TABLE "candidate_evidence" ADD CONSTRAINT "candidate_evidence_requirementMapId_fkey" FOREIGN KEY ("requirementMapId") REFERENCES "requirement_evidence_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_maps" ADD CONSTRAINT "requirement_evidence_maps_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_maps" ADD CONSTRAINT "requirement_evidence_maps_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_maps" ADD CONSTRAINT "requirement_evidence_maps_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_evidence_maps" ADD CONSTRAINT "requirement_evidence_maps_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "job_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
