-- CreateTable
CREATE TABLE "ChatDocumentRef" (
    "messageId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "anchor" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatDocumentRef_pkey" PRIMARY KEY ("messageId","documentId")
);

-- CreateIndex
CREATE INDEX "ChatDocumentRef_documentId_createdAt_idx" ON "ChatDocumentRef"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatDocumentRef_channelId_createdAt_idx" ON "ChatDocumentRef"("channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatDocumentRef" ADD CONSTRAINT "ChatDocumentRef_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatDocumentRef" ADD CONSTRAINT "ChatDocumentRef_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
