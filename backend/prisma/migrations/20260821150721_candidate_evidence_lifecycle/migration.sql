-- AlterTable
ALTER TABLE "candidate_accounts" ADD COLUMN     "evidenceRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "sourceCandidateDocumentId" TEXT;

-- CreateIndex
CREATE INDEX "application_link_sources_sourceLinkId_idx" ON "application_link_sources"("sourceLinkId");

-- CreateIndex
CREATE INDEX "documents_sourceCandidateDocumentId_idx" ON "documents"("sourceCandidateDocumentId");
