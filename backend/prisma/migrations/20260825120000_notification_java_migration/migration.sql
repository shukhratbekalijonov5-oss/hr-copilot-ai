-- Notification system migration to the Java Notification Service.
--
-- 1. The email preference system is removed from the product: the table and
--    its enum go away. The feature never shipped beyond local/test data, so
--    this deliberate forward drop loses nothing that matters; runtime usage
--    was removed in the same change.
-- 2. The notification OUTBOX arrives: the reliability seam that carries
--    committed business events to Kafka for the Java service.
--
-- The legacy "notifications" table is intentionally NOT dropped here: it is
-- the read source for the one-time backfill into the Java database and
-- stays as an archived, no-longer-written copy until a later cleanup
-- migration.

-- DropTable (preference system removal)
DROP TABLE IF EXISTS "notification_email_preferences";

-- DropEnum
DROP TYPE IF EXISTS "NotificationEmailCategory";

-- CreateTable (outbox)
CREATE TABLE "notification_outbox_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "notification_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_outbox_events_publishedAt_createdAt_idx" ON "notification_outbox_events"("publishedAt", "createdAt");
