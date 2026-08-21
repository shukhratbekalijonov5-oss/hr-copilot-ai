-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('HR', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_APPLICATION', 'NEW_MESSAGE', 'INTERVIEW_INVITATION', 'VACANCY_DELETED', 'APPLICATION_REJECTED', 'DOCUMENT_PROCESSING_COMPLETED', 'DOCUMENT_PROCESSING_FAILED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "uploadedById" TEXT;

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "organizationId" TEXT,
    "vacancyId" TEXT,
    "candidateId" TEXT,
    "applicationId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "documentId" TEXT,
    "actorUserId" TEXT,
    "vacancyTitleSnapshot" TEXT,
    "candidateNameSnapshot" TEXT,
    "actorNameSnapshot" TEXT,
    "messagePreview" TEXT,
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipientUserId_isRead_createdAt_idx" ON "notifications"("recipientUserId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_recipientUserId_createdAt_idx" ON "notifications"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_vacancyId_idx" ON "notifications"("vacancyId");

-- CreateIndex
CREATE INDEX "notifications_documentId_idx" ON "notifications"("documentId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
