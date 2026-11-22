import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { WorkspaceService } from '../workspace/workspace.service';
import type { WebhookConfig } from './webhook-config';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { WEBHOOK_CONFIG } from './webhook-event.service';

/**
 * Owner-only management of a workspace's webhooks: CRUD, secret reveal and
 * rotation, enable/disable, the delivery log and redeliver.
 *
 * STUB — the implementation lands separately.
 */
@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
    private readonly notifications: NotificationService,
    private readonly worker: WebhookDeliveryWorker,
    @Inject(WEBHOOK_CONFIG) private readonly config: WebhookConfig,
  ) {
    void this.prisma;
    void this.workspaceService;
    void this.notifications;
    void this.worker;
    void this.config;
  }
}
