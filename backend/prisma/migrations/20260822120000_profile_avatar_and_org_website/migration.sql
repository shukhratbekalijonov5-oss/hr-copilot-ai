-- Profile editing: an optional account picture, and the organization's own
-- public web address.
--
-- All three columns are nullable with no default: "no picture" and "no website"
-- are ordinary states of a valid account, so existing rows need no backfill and
-- nothing about sign-in changes.
ALTER TABLE "users" ADD COLUMN "avatarStorageKey" TEXT;
ALTER TABLE "users" ADD COLUMN "avatarMimeType" TEXT;
ALTER TABLE "organizations" ADD COLUMN "websiteUrl" TEXT;
