import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { loadWebhookConfig } from './webhook-config';
import { WEBHOOK_CONFIG, WebhookEventService } from './webhook-event.service';

/**
 * Emission only, with no dependency beyond Prisma, so the domain modules that
 * emit (`WorkspaceModule`, `DocumentModule`, `FolderModule`, …) can import it
 * without a cycle: `WebhookModule` itself depends on `WorkspaceModule` for
 * owner checks.
 */
@Module({
  providers: [
    {
      provide: WEBHOOK_CONFIG,
      useFactory: () => loadWebhookConfig(process.env),
    },
    WebhookEventService,
    PrismaService,
  ],
  exports: [WEBHOOK_CONFIG, WebhookEventService],
})
export class WebhookEventModule {}
