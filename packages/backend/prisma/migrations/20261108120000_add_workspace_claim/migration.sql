-- CreateTable
CREATE TABLE "WorkspaceClaim" (
    "id" TEXT NOT NULL,
    "githubId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'codepair',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" INTEGER,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "WorkspaceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceClaim_workspaceId_key" ON "WorkspaceClaim"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceClaim_githubId_idx" ON "WorkspaceClaim"("githubId");

-- AddForeignKey
ALTER TABLE "WorkspaceClaim" ADD CONSTRAINT "WorkspaceClaim_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
