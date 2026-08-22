-- CreateEnum
CREATE TYPE "CatalogMode" AS ENUM ('direct_metadata', 'rest_catalog', 's3_tables', 'unity');

-- CreateTable
CREATE TABLE "LakehouseSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storage" TEXT NOT NULL,
    "endpoint" TEXT,
    "region" TEXT,
    "bucket" TEXT,
    "basePath" TEXT,
    "catalogMode" "CatalogMode" NOT NULL DEFAULT 'direct_metadata',
    "catalogUri" TEXT,
    "credentials" TEXT,
    "authorID" INTEGER NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LakehouseSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LakehouseSource_workspaceId_name_key" ON "LakehouseSource"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "LakehouseSource" ADD CONSTRAINT "LakehouseSource_authorID_fkey" FOREIGN KEY ("authorID") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LakehouseSource" ADD CONSTRAINT "LakehouseSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
