-- Email notification preferences: OVERRIDE rows only. A user with no rows
-- has the code-side policy defaults, so existing users need no backfill and
-- this migration is purely additive — no existing table or row is touched.

-- CreateEnum
CREATE TYPE "NotificationEmailCategory" AS ENUM ('INTERVIEW_INVITATIONS', 'APPLICATION_DECISIONS', 'PAYMENT_BILLING', 'ACCOUNT_SECURITY', 'AI_JOB_MATCHES', 'PROCESSING_UPDATES');

-- CreateTable
CREATE TABLE "notification_email_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationEmailCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_email_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_email_preferences_userId_category_key" ON "notification_email_preferences"("userId", "category");

-- AddForeignKey
ALTER TABLE "notification_email_preferences" ADD CONSTRAINT "notification_email_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
