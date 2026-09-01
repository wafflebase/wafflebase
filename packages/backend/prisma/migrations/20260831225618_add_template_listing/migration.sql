-- CreateTable
CREATE TABLE "TemplateListing" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "shareLinkId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "tags" TEXT[],
    "thumbnailId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'unlisted',
    "status" TEXT NOT NULL DEFAULT 'listed',
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "licensedAt" TIMESTAMP(3),
    "originId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateListing_documentId_key" ON "TemplateListing"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateListing_shareLinkId_key" ON "TemplateListing"("shareLinkId");

-- CreateIndex
CREATE INDEX "TemplateListing_visibility_status_useCount_idx" ON "TemplateListing"("visibility", "status", "useCount");

-- CreateIndex
CREATE INDEX "TemplateListing_workspaceId_visibility_idx" ON "TemplateListing"("workspaceId", "visibility");

-- AddForeignKey
ALTER TABLE "TemplateListing" ADD CONSTRAINT "TemplateListing_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateListing" ADD CONSTRAINT "TemplateListing_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateListing" ADD CONSTRAINT "TemplateListing_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateListing" ADD CONSTRAINT "TemplateListing_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
