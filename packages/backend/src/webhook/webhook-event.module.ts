import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ApiWriterInterceptor } from './api-writer-context';
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
    // Carries the request's API key into async context for
    // `YorkieService.withDocument` (the `api_writers` loop guard). Registered
    // once: Nest instantiates an imported module a single time.
    { provide: APP_INTERCEPTOR, useClass: ApiWriterInterceptor },
  ],
  exports: [WEBHOOK_CONFIG, WebhookEventService],
})
export class WebhookEventModule {}
