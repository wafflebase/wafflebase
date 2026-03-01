-- AlterTable: add slug column with a temporary default
ALTER TABLE "Workspace" ADD COLUMN "slug" TEXT;

-- Backfill existing rows: derive slug from id (first 8 chars)
UPDATE "Workspace" SET "slug" = LOWER(REPLACE(CAST("id" AS TEXT), '-', '')) WHERE "slug" IS NULL;
UPDATE "Workspace" SET "slug" = LEFT("slug", 8) WHERE LENGTH("slug") > 8;

-- Make slug non-nullable and unique
ALTER TABLE "Workspace" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
