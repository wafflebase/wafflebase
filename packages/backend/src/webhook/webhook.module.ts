import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationModule } from '../notification/notification.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { WebhookController } from './webhook.controller';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { WebhookEventModule } from './webhook-event.module';
import { WebhookService } from './webhook.service';

/**
 * Workspace webhooks: management routes, the delivery worker, and (through
 * `WebhookEventModule`, re-exported) the emission service. Domain modules
 * import `WebhookEventModule` directly to avoid the cycle through
 * `WorkspaceModule`. See `docs/design/webhooks.md`.
 */
@Module({
  imports: [WebhookEventModule, WorkspaceModule, NotificationModule],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookDeliveryWorker, PrismaService],
  exports: [WebhookEventModule, WebhookService],
})
export class WebhookModule {}
