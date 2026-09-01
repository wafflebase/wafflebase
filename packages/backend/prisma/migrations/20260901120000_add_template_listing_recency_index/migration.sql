-- CreateIndex
CREATE INDEX "TemplateListing_visibility_status_publishedAt_idx" ON "TemplateListing"("visibility", "status", "publishedAt");
