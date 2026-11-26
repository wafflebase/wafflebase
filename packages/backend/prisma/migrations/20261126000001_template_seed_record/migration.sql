-- CreateTable
CREATE TABLE "TemplateSeedRecord" (
    "documentId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "writtenHash" TEXT NOT NULL DEFAULT '',
    "cardHash" TEXT NOT NULL,
    "thumbnailHash" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateSeedRecord_pkey" PRIMARY KEY ("documentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSeedRecord_slug_key" ON "TemplateSeedRecord"("slug");

-- AddForeignKey
ALTER TABLE "TemplateSeedRecord" ADD CONSTRAINT "TemplateSeedRecord_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
