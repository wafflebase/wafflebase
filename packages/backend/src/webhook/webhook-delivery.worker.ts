/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- stub; the implementation lands separately */
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { TestResult } from './webhook.dto';
import type { WebhookConfig } from './webhook-config';
import { WEBHOOK_CONFIG, WebhookEventService } from './webhook-event.service';

/**
 * One delivery loop per replica (the `DemoResetService` shape: re-armed
 * `setTimeout`, `unref()`, re-entrancy flag). Woken on the `webhook` NOTIFY
 * channel, polled every 5 s as a fallback; claims with `FOR UPDATE SKIP
 * LOCKED` and sends outside the transaction. Also flushes
 * `WebhookContentPending` into `document.content_updated` and purges
 * deliveries past 30 days.
 *
 * STUB — the contract is fixed; the implementation lands separately.
 */
@Injectable()
export class WebhookDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: WebhookEventService,
    @Inject(WEBHOOK_CONFIG) private readonly config: WebhookConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
  }

  onModuleDestroy(): void {}

  /** Pull a delivery's next attempt to now and wake the loop (redeliver). */
  async deliverNow(_deliveryId: string): Promise<void> {
    void this.prisma;
    void this.events;
    throw new Error('not implemented');
  }

  /** Send a signed `webhook.test` to one webhook, synchronously. */
  async sendTest(_webhookId: string): Promise<TestResult> {
    throw new Error('not implemented');
  }
}
