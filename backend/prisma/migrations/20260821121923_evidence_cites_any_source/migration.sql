-- AlterTable
ALTER TABLE "candidate_evidence" ADD COLUMN     "linkSourceId" TEXT,
ALTER COLUMN "documentId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "candidate_evidence_linkSourceId_idx" ON "candidate_evidence"("linkSourceId");

-- AddForeignKey
ALTER TABLE "candidate_evidence" ADD CONSTRAINT "candidate_evidence_linkSourceId_fkey" FOREIGN KEY ("linkSourceId") REFERENCES "application_link_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
