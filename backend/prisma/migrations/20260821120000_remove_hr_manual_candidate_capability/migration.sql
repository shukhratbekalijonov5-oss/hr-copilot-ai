-- HR-side manual candidate creation and candidate file upload were removed
-- from the product. This migration retires ONLY what those features owned.
--
-- Historical data is deliberately preserved: candidates a recruiter created,
-- their documents and their MANUAL_UPLOAD applications keep their rows and
-- their truthful `source`. They are simply no longer surfaced by the active
-- recruiter workflow (enforced in application code, not by deletion), and the
-- MANUAL_UPLOAD enum member is kept for exactly that reason.

-- 1. Processing notifications existed only to tell an HR user about a file
--    THEY uploaded. With no HR upload path there is no trigger left, so the
--    two types are retired. Any historical row describes a removed feature.
DELETE FROM "notifications"
WHERE "type" IN ('DOCUMENT_PROCESSING_COMPLETED', 'DOCUMENT_PROCESSING_FAILED');

-- 2. PostgreSQL cannot drop an enum member in place: swap the type.
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
CREATE TYPE "NotificationType" AS ENUM (
  'NEW_APPLICATION',
  'NEW_MESSAGE',
  'INTERVIEW_INVITATION',
  'VACANCY_DELETED',
  'APPLICATION_REJECTED'
);
ALTER TABLE "notifications"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING ("type"::text::"NotificationType");
DROP TYPE "NotificationType_old";

-- 3. Upload provenance for HR-uploaded documents: no producer and no consumer
--    remain (its only reader was the processing notification above).
ALTER TABLE "documents" DROP COLUMN "uploadedById";

--    ...and with the processing types gone, nothing writes a document
--    reference onto a notification any more.
DROP INDEX "notifications_documentId_idx";
ALTER TABLE "notifications" DROP COLUMN "documentId";

-- 4. A candidate applying is now the only way an application can be created,
--    so DIRECT — not MANUAL_UPLOAD — is the safe column default.
ALTER TABLE "applications" ALTER COLUMN "source" SET DEFAULT 'DIRECT';
