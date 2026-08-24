-- AlterTable
ALTER TABLE "external_job_sources" ADD COLUMN     "urlKeys" TEXT[];

-- CreateIndex
CREATE INDEX "external_job_sources_urlKeys_idx" ON "external_job_sources" USING GIN ("urlKeys");
