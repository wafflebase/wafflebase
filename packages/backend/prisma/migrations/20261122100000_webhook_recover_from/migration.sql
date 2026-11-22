-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN     "recoverFrom" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_status_nextAttemptAt_idx" ON "WebhookDelivery"("webhookId", "status", "nextAttemptAt");
