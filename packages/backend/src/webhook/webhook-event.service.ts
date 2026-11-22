/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- stub; the implementation lands separately */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { WebhookConfig } from './webhook-config';
import type { Actor, EventVisibility, WebhookEventType } from './webhook.types';

export const WEBHOOK_CONFIG = Symbol('WEBHOOK_CONFIG');

export interface EmitInput {
  workspaceId: string;
  type: WebhookEventType;
  actor: Actor | null;
  /** Merged into `data` after `workspace_id` and `actor`. */
  data: Record<string, unknown>;
  /** Set for document events; filters on `Webhook.documentTypes`. */
  documentType?: string;
  /**
   * Set for document events; filters on `Webhook.folderIds`. `null` is the
   * workspace root, `undefined` skips the folder filter.
   */
  folderId?: string | null;
  /** `restricted` is never delivered to a workspace webhook. */
  visibility?: EventVisibility;
}

/**
 * The **only** emission entry point. Inserts one `WebhookDelivery` per
 * matching active webhook inside the caller's transaction (transactional
 * outbox), then `pg_notify('webhook', workspaceId)`, which Postgres delivers
 * on commit. Callers without a transaction wrap the call in
 * `prisma.$transaction(async (tx) => …)`.
 *
 * STUB — the contract is fixed; the implementation lands separately.
 */
@Injectable()
export class WebhookEventService {
  constructor(@Inject(WEBHOOK_CONFIG) private readonly config: WebhookConfig) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  async emit(_tx: Prisma.TransactionClient, _input: EmitInput): Promise<void> {
    if (!this.config.enabled) return;
    throw new Error('not implemented');
  }
}
