-- AlterTable
ALTER TABLE "Document" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing rows to their creation time so list ordering is stable
-- before any Yorkie edit webhook has been received. New rows keep the
-- CURRENT_TIMESTAMP default (≈ createdAt) until their first edit.
UPDATE "Document" SET "updatedAt" = "createdAt";
