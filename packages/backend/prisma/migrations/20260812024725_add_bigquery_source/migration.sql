-- CreateTable
CREATE TABLE "BigQuerySource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dataset" TEXT,
    "location" TEXT,
    "credentials" TEXT NOT NULL,
    "maximumBytesBilled" BIGINT,
    "authorID" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "BigQuerySource_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BigQuerySource" ADD CONSTRAINT "BigQuerySource_authorID_fkey" FOREIGN KEY ("authorID") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BigQuerySource" ADD CONSTRAINT "BigQuerySource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
