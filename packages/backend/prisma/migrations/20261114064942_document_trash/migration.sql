-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Document_workspaceId_deletedAt_idx" ON "Document"("workspaceId", "deletedAt");
