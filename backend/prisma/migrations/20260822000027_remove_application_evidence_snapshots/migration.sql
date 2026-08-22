-- GUARD: this migration only drops STRUCTURE. The snapshot DATA (rows,
-- storage objects, Qdrant vectors) must already have been removed by
-- scripts/remove-snapshot-evidence.ts, which coordinates the stores this
-- migration cannot reach. Refuse to destroy unexpectedly-live data.
DO $$
DECLARE live integer;
BEGIN
  SELECT (SELECT count(*) FROM application_link_sources)
       + (SELECT count(*) FROM documents WHERE "applicationId" IS NOT NULL
            OR "sourceCandidateDocumentId" IS NOT NULL)
       + (SELECT count(*) FROM candidate_evidence WHERE "linkSourceId" IS NOT NULL)
    INTO live;
  IF live > 0 THEN
    RAISE EXCEPTION 'Found % live snapshot row(s). Run scripts/remove-snapshot-evidence.ts before applying this migration.', live;
  END IF;
END $$;

/*
  Warnings:

  - You are about to drop the column `submittedDocumentId` on the `applications` table. All the data in the column will be lost.
  - You are about to drop the column `linkSourceId` on the `candidate_evidence` table. All the data in the column will be lost.
  - You are about to drop the column `applicationId` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the column `sourceCandidateDocumentId` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the `application_link_sources` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "application_link_sources" DROP CONSTRAINT "application_link_sources_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "application_link_sources" DROP CONSTRAINT "application_link_sources_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "application_link_sources" DROP CONSTRAINT "application_link_sources_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "applications" DROP CONSTRAINT "applications_submittedDocumentId_fkey";

-- DropForeignKey
ALTER TABLE "candidate_evidence" DROP CONSTRAINT "candidate_evidence_linkSourceId_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_applicationId_fkey";

-- DropIndex
DROP INDEX "candidate_evidence_linkSourceId_idx";

-- DropIndex
DROP INDEX "documents_applicationId_idx";

-- DropIndex
DROP INDEX "documents_sourceCandidateDocumentId_idx";

-- AlterTable
ALTER TABLE "applications" DROP COLUMN "submittedDocumentId";

-- AlterTable
ALTER TABLE "candidate_evidence" DROP COLUMN "linkSourceId",
ADD COLUMN     "candidateLinkId" TEXT;

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "applicationId",
DROP COLUMN "sourceCandidateDocumentId";

-- DropTable
DROP TABLE "application_link_sources";

-- CreateIndex
CREATE INDEX "candidate_evidence_candidateLinkId_idx" ON "candidate_evidence"("candidateLinkId");

-- AddForeignKey
ALTER TABLE "candidate_evidence" ADD CONSTRAINT "candidate_evidence_candidateLinkId_fkey" FOREIGN KEY ("candidateLinkId") REFERENCES "candidate_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
