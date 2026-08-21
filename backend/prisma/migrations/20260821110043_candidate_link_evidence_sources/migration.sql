-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('PENDING', 'FETCHING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LinkFailureCode" AS ENUM ('INVALID_URL', 'UNSUPPORTED_PROTOCOL', 'PRIVATE_NETWORK_URL', 'FETCH_TIMEOUT', 'TOO_MANY_REDIRECTS', 'CONTENT_TOO_LARGE', 'UNSUPPORTED_CONTENT_TYPE', 'ACCESS_DENIED', 'NO_MEANINGFUL_CONTENT', 'RENDER_FAILED', 'UPSTREAM_ERROR', 'INDEXING_FAILED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "applicationId" TEXT;

-- CreateTable
CREATE TABLE "candidate_links" (
    "id" TEXT NOT NULL,
    "candidateAccountId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "title" TEXT,
    "detectedType" TEXT,
    "status" "LinkStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" "LinkFailureCode",
    "failureMessage" TEXT,
    "contentHash" TEXT,
    "sections" JSONB,
    "charCount" INTEGER,
    "pagesFetched" INTEGER,
    "fetchMode" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_link_sources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "sourceLinkId" TEXT,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "title" TEXT,
    "detectedType" TEXT,
    "sections" JSONB NOT NULL,
    "contentHash" TEXT,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 1,
    "fetchMode" TEXT NOT NULL DEFAULT 'STATIC',
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_link_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_links_candidateAccountId_idx" ON "candidate_links"("candidateAccountId");

-- CreateIndex
CREATE INDEX "candidate_links_candidateAccountId_status_idx" ON "candidate_links"("candidateAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_links_candidateAccountId_normalizedUrl_key" ON "candidate_links"("candidateAccountId", "normalizedUrl");

-- CreateIndex
CREATE INDEX "application_link_sources_organizationId_idx" ON "application_link_sources"("organizationId");

-- CreateIndex
CREATE INDEX "application_link_sources_organizationId_candidateId_idx" ON "application_link_sources"("organizationId", "candidateId");

-- CreateIndex
CREATE INDEX "application_link_sources_applicationId_idx" ON "application_link_sources"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "application_link_sources_applicationId_normalizedUrl_key" ON "application_link_sources"("applicationId", "normalizedUrl");

-- CreateIndex
CREATE INDEX "documents_applicationId_idx" ON "documents"("applicationId");

-- AddForeignKey
ALTER TABLE "candidate_links" ADD CONSTRAINT "candidate_links_candidateAccountId_fkey" FOREIGN KEY ("candidateAccountId") REFERENCES "candidate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_link_sources" ADD CONSTRAINT "application_link_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_link_sources" ADD CONSTRAINT "application_link_sources_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_link_sources" ADD CONSTRAINT "application_link_sources_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
