-- CreateTable
CREATE TABLE "TemplateReport" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedBy" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateReport_status_createdAt_idx" ON "TemplateReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateReport_listingId_reporterId_key" ON "TemplateReport"("listingId", "reporterId");

-- AddForeignKey
ALTER TABLE "TemplateReport" ADD CONSTRAINT "TemplateReport_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "TemplateListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateReport" ADD CONSTRAINT "TemplateReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
