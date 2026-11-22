import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma, WebhookDelivery } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { SafeOutboundError, assertSafeUrl } from '../common/safe-outbound';
import {
  DEFAULT_ROTATION_OVERLAP_HOURS,
  MAX_WEBHOOKS_PER_WORKSPACE,
  WEBHOOK_NOTIFY_CHANNEL,
  type WebhookConfig,
} from './webhook-config';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { WEBHOOK_CONFIG } from './webhook-event.service';
import {
  decryptSecret,
  encryptSecret,
  secretsKeyProblem,
} from './webhook-secret';
import { generateWebhookSecret } from './webhook-signer';
import {
  DELIVERY_PAGE_SIZE,
  type CreateWebhookDto,
  type DeliveryDetail,
  type DeliveryPage,
  type DeliverySummary,
  type ListDeliveriesQueryDto,
  type TestResult,
  type UpdateWebhookDto,
  type WebhookDetail,
  type WebhookListResponse,
  type WebhookWithCreator,
  toDeliveryDetail,
  toDeliverySummary,
  toDetail,
  toSummary,
} from './webhook.dto';

const WITH_CREATOR = {
  creator: { select: { id: true, username: true } },
} as const;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Owner-only management of a workspace's webhooks: CRUD, secret reveal and
 * rotation, enable/disable, the delivery log and redeliver.
 *
 * Every method takes the workspace id or slug as given in the path and
 * resolves it first, so an unknown workspace is a `404`. A webhook id that
 * belongs to another workspace is a `404` too, never a `403`: whether some
 * other workspace exports data somewhere is that workspace's business.
 *
 * With the feature off (`WAFFLEBASE_WEBHOOKS_ENABLED` unset), only the list
 * answers — `enabled: false`, so owners can see why the section is muted —
 * and every other route is a `404`, as if it did not exist.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
    private readonly worker: WebhookDeliveryWorker,
    @Inject(WEBHOOK_CONFIG) private readonly config: WebhookConfig,
  ) {}

  /**
   * Members read the list too, host only: where workspace data leaves to is
   * something they are entitled to know, but the full URL is often itself a
   * credential (a Zapier or Slack hook URL).
   */
  async list(workspace: string, userId: number): Promise<WebhookListResponse> {
    const workspaceId = await this.workspaceService.resolveId(workspace);
    const member = await this.workspaceService.assertMember(
      workspaceId,
      userId,
    );
    const canManage = member.role === 'owner';
    const rows = await this.prisma.webhook.findMany({
      where: { workspaceId },
      include: WITH_CREATOR,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      enabled: this.config.enabled,
      canManage,
      webhooks: rows.map((row) => toSummary(row, canManage)),
    };
  }

  async get(
    workspace: string,
    userId: number,
    webhookId: string,
  ): Promise<WebhookDetail> {
    const { webhook } = await this.ownedWebhook(workspace, userId, webhookId);
    return toDetail(webhook);
  }

  async create(
    workspace: string,
    userId: number,
    body: CreateWebhookDto,
  ): Promise<{ webhook: WebhookDetail; test: TestResult }> {
    const workspaceId = await this.ownerScope(workspace, userId);
    const keyProblem = secretsKeyProblem();
    if (keyProblem) {
      // An operator setting, not the owner's mistake: say which one.
      throw new ServiceUnavailableException({
        code: 'secrets_key_missing',
        message: `Webhooks cannot store a signing secret: ${keyProblem}`,
      });
    }
    await this.assertFolders(workspaceId, body.folderIds);
    await this.assertUrl(body.url);

    // Counted inside the insert's transaction so two concurrent creates at 9
    // cannot both see room for one more. Serializable would be the airtight
    // version; a workspace briefly holding 11 is not worth the retries.
    const created = await this.prisma.$transaction(async (tx) => {
      const count = await tx.webhook.count({ where: { workspaceId } });
      if (count >= MAX_WEBHOOKS_PER_WORKSPACE) {
        throw new ConflictException({
          code: 'limit_reached',
          message: `A workspace can have at most ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks`,
        });
      }
      return tx.webhook.create({
        data: {
          workspaceId,
          createdBy: userId,
          name: body.name,
          url: body.url,
          events: body.events,
          documentTypes: body.documentTypes,
          folderIds: body.folderIds,
          secretEnc: encryptSecret(generateWebhookSecret()),
        },
        include: WITH_CREATOR,
      });
    });

    const test = await this.runTest(created.id, userId);
    return { webhook: toDetail(await this.reload(created.id)), test };
  }

  async update(
    workspace: string,
    userId: number,
    webhookId: string,
    body: UpdateWebhookDto,
  ): Promise<{ webhook: WebhookDetail; test: TestResult | null }> {
    const { workspaceId, webhook } = await this.ownedWebhook(
      workspace,
      userId,
      webhookId,
    );
    if (body.folderIds !== undefined) {
      await this.assertFolders(workspaceId, body.folderIds);
    }
    const urlChanged = body.url !== undefined && body.url !== webhook.url;
    if (urlChanged) await this.assertUrl(body.url!);

    const data: Prisma.WebhookUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (urlChanged) data.url = body.url;
    if (body.events !== undefined) data.events = body.events;
    if (body.documentTypes !== undefined) {
      data.documentTypes = body.documentTypes;
    }
    if (body.folderIds !== undefined) data.folderIds = body.folderIds;

    if (Object.keys(data).length > 0) {
      await this.prisma.webhook.update({ where: { id: webhook.id }, data });
    }
    // A new URL is a new receiver: ping it the way a create does, so the
    // owner sees at once whether the move worked.
    const test = urlChanged ? await this.runTest(webhook.id, userId) : null;
    return { webhook: toDetail(await this.reload(webhook.id)), test };
  }

  async remove(
    workspace: string,
    userId: number,
    webhookId: string,
  ): Promise<void> {
    const { webhook } = await this.ownedWebhook(workspace, userId, webhookId);
    // Deliveries cascade. Nothing else references a webhook.
    await this.prisma.webhook.delete({ where: { id: webhook.id } });
  }

  async test(
    workspace: string,
    userId: number,
    webhookId: string,
  ): Promise<TestResult> {
    const { webhook } = await this.ownedWebhook(workspace, userId, webhookId);
    return this.runTest(webhook.id, userId);
  }

  /**
   * The secret is encrypted, not hashed, because it must be decryptable to
   * sign — so hiding it after creation would buy nothing and force a rotation
   * every time somebody loses it (Stripe and Svix reveal theirs too).
   */
  async revealSecret(
    workspace: string,
    userId: number,
    webhookId: string,
  ): Promise<{
    secret: string;
    previousSecret: string | null;
    previousExpiresAt: string | null;
  }> {
    const { webhook } = await this.ownedWebhook(workspace, userId, webhookId);
    const rotating = this.inOverlap(webhook, new Date());
    return {
      secret: decryptSecret(webhook.secretEnc),
      previousSecret: rotating ? decryptSecret(webhook.prevSecretEnc!) : null,
      previousExpiresAt: rotating
        ? webhook.prevSecretExpiresAt!.toISOString()
        : null,
    };
  }

  /**
   * Keep the outgoing secret signing alongside the new one for
   * `overlapHours`. A second rotation inside the overlap is refused: it would
   * drop a secret the receiver may still be verifying with.
   */
  async rotateSecret(
    workspace: string,
    userId: number,
    webhookId: string,
    overlapHours: number = DEFAULT_ROTATION_OVERLAP_HOURS,
  ): Promise<{ secret: string; previousExpiresAt: string }> {
    const { webhook } = await this.ownedWebhook(workspace, userId, webhookId);
    const now = new Date();
    const secret = generateWebhookSecret();
    const previousExpiresAt = new Date(now.getTime() + overlapHours * HOUR_MS);
    // Conditional on the row still not being in an overlap, so two rotations
    // racing past the check below cannot both win and drop a live secret.
    const { count } = await this.prisma.webhook.updateMany({
      where: {
        id: webhook.id,
        secretEnc: webhook.secretEnc,
        OR: [
          { prevSecretExpiresAt: null },
          { prevSecretExpiresAt: { lte: now } },
        ],
      },
      data: {
        secretEnc: encryptSecret(secret),
        prevSecretEnc: webhook.secretEnc,
        prevSecretExpiresAt: previousExpiresAt,
      },
    });
    if (count === 0) {
      throw new ConflictException({
        code: 'rotation_in_progress',
        message:
          'The previous secret is still being signed with; rotate again once it expires',
      });
    }
    return { secret, previousExpiresAt: previousExpiresAt.toISOString() };
  }

  /**
   * Turn a webhook back on. The caller becomes its `createdBy`: that is how a
   * remaining owner takes over a webhook whose creator was removed, and it
   * keeps "who answers for this export" pointing at somebody who chose it.
   *
   * `recoverSince` re-queues every failed delivery created at or after it,
   * from the first attempt, under the same delivery id.
   */
  async enable(
    workspace: string,
    userId: number,
    webhookId: string,
    recoverSince?: string | null,
  ): Promise<WebhookDetail> {
    const { workspaceId, webhook } = await this.ownedWebhook(
      workspace,
      userId,
      webhookId,
    );
    const since = recoverSince ? new Date(recoverSince) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.webhook.update({
        where: { id: webhook.id },
        data: {
          status: 'active',
          disabledAt: null,
          disabledReason: null,
          // A fresh start: the old streak must not auto-disable it again on
          // the first failure after re-enabling.
          failingSince: null,
          warnedAt: null,
          createdBy: userId,
        },
      });
      if (since) {
        await tx.webhookDelivery.updateMany({
          where: {
            webhookId: webhook.id,
            status: 'failed',
            createdAt: { gte: since },
          },
          data: {
            status: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(),
            leaseUntil: null,
          },
        });
      }
      // Delivered on commit; wakes the worker for anything re-queued.
      await tx.$executeRaw`SELECT pg_notify(${WEBHOOK_NOTIFY_CHANNEL}, ${workspaceId})`;
    });
    return toDetail(await this.reload(webhook.id));
  }

  async disable(
    workspace: string,
    userId: number,
    webhookId: string,
  ): Promise<WebhookDetail> {
    const { webhook } = await this.ownedWebhook(workspace, userId, webhookId);
    // Already off: keep the reason it went off for (`failing`, `gone`, …)
    // rather than overwriting the more informative one with `manual`.
    if (webhook.status !== 'disabled') {
      await this.prisma.$transaction(async (tx) => {
        await tx.webhook.update({
          where: { id: webhook.id },
          data: {
            status: 'disabled',
            disabledAt: new Date(),
            disabledReason: 'manual',
          },
        });
        // Queued rows end here, as on an automatic disable; re-enabling with
        // "recover since" is what sends them, so turning a webhook off and on
        // again never silently flushes what piled up while it was off.
        await tx.webhookDelivery.updateMany({
          where: { webhookId: webhook.id, status: 'pending' },
          data: { status: 'failed', lastError: 'Webhook turned off' },
        });
      });
    }
    return toDetail(await this.reload(webhook.id));
  }

  /**
   * Newest first, keyed on `(createdAt, id)` like the notifications list: a
   * timestamp alone would skip rows sharing the boundary instant, and one
   * emit inserts a delivery per webhook at a single instant.
   */
  async listDeliveries(
    workspace: string,
    userId: number,
    webhookId: string,
    query: ListDeliveriesQueryDto,
  ): Promise<DeliveryPage> {
    if (query.beforeId && !query.before) {
      throw new BadRequestException('beforeId requires before');
    }
    const { webhook } = await this.ownedWebhook(workspace, userId, webhookId);
    const limit = query.limit ?? DELIVERY_PAGE_SIZE;
    const before = query.before ? new Date(query.before) : null;

    const where: Prisma.WebhookDeliveryWhereInput = { webhookId: webhook.id };
    if (query.status === 'failed') where.status = 'failed';
    if (before) {
      where.OR = [
        { createdAt: { lt: before } },
        ...(query.beforeId
          ? [{ createdAt: before, id: { lt: query.beforeId } }]
          : []),
      ];
    }

    const rows = await this.prisma.webhookDelivery.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      deliveries: page.map(toDeliverySummary),
      nextCursor:
        rows.length > limit && last
          ? { before: last.createdAt.toISOString(), beforeId: last.id }
          : null,
    };
  }

  async getDelivery(
    workspace: string,
    userId: number,
    webhookId: string,
    deliveryId: string,
  ): Promise<DeliveryDetail> {
    const { webhook } = await this.ownedWebhook(workspace, userId, webhookId);
    return toDeliveryDetail(await this.findDelivery(webhook.id, deliveryId));
  }

  /**
   * Pull the delivery's next attempt to now — the same row and the same
   * `webhook-id`, so a receiver deduplicating on it sees a retry, not a new
   * event. A disabled webhook is refused: its deliveries are never claimed,
   * so the redeliver would sit in the queue looking like it had been sent.
   */
  async redeliver(
    workspace: string,
    userId: number,
    webhookId: string,
    deliveryId: string,
  ): Promise<DeliverySummary> {
    const { webhook } = await this.ownedWebhook(workspace, userId, webhookId);
    const delivery = await this.findDelivery(webhook.id, deliveryId);
    if (webhook.status !== 'active') {
      throw new ConflictException({
        code: 'webhook_disabled',
        message: 'Turn the webhook on before redelivering',
      });
    }
    await this.worker.deliverNow(delivery.id);
    return toDeliverySummary(await this.findDelivery(webhook.id, delivery.id));
  }

  /**
   * What removing `targetUserId` from the workspace would delete or turn
   * off, for the member-removal confirm dialog. Mirrors
   * `WorkspaceService.removeMember`: private channels the removal empties are
   * deleted with their messages, and the member's active webhooks go off with
   * `creator_removed`. Open to an owner, or to the member about themself
   * (the leave path).
   */
  async removalImpact(
    workspace: string,
    requesterId: number,
    targetUserId: number,
  ): Promise<{ privateChannelsDeleted: number; webhooksDisabled: number }> {
    const workspaceId = await this.workspaceService.resolveId(workspace);
    if (requesterId === targetUserId) {
      await this.workspaceService.assertMember(workspaceId, requesterId);
    } else {
      await this.workspaceService.assertOwner(workspaceId, requesterId);
    }
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { userId: true },
    });
    if (!member) throw new NotFoundException('Member not found');

    const [privateChannelsDeleted, webhooksDisabled] = await Promise.all([
      this.prisma.chatChannel.count({
        where: {
          workspaceId,
          kind: 'private',
          // A member, and the only one.
          members: {
            some: { userId: targetUserId },
            every: { userId: targetUserId },
          },
        },
      }),
      this.prisma.webhook.count({
        where: { workspaceId, createdBy: targetUserId, status: 'active' },
      }),
    ]);
    return { privateChannelsDeleted, webhooksDisabled };
  }

  // -------------------------------------------------------------------------

  /**
   * The resolved workspace id once the caller is known to be an owner and
   * the feature on. Feature-off is checked first so a disabled server answers
   * every management route the same way, whoever asks.
   */
  private async ownerScope(workspace: string, userId: number) {
    if (!this.config.enabled) throw new NotFoundException('Not found');
    const workspaceId = await this.workspaceService.resolveId(workspace);
    await this.workspaceService.assertOwner(workspaceId, userId);
    return workspaceId;
  }

  private async ownedWebhook(
    workspace: string,
    userId: number,
    webhookId: string,
  ): Promise<{ workspaceId: string; webhook: WebhookWithCreator }> {
    const workspaceId = await this.ownerScope(workspace, userId);
    const webhook = await this.prisma.webhook.findFirst({
      where: { id: webhookId, workspaceId },
      include: WITH_CREATOR,
    });
    if (!webhook) throw new NotFoundException('Webhook not found');
    return { workspaceId, webhook };
  }

  private async reload(id: string): Promise<WebhookWithCreator> {
    return this.prisma.webhook.findUniqueOrThrow({
      where: { id },
      include: WITH_CREATOR,
    });
  }

  private async findDelivery(
    webhookId: string,
    deliveryId: string,
  ): Promise<WebhookDelivery> {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookId },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    return delivery;
  }

  private inOverlap(
    webhook: { prevSecretEnc: string | null; prevSecretExpiresAt: Date | null },
    now: Date,
  ): boolean {
    return (
      webhook.prevSecretEnc !== null &&
      webhook.prevSecretExpiresAt !== null &&
      webhook.prevSecretExpiresAt > now
    );
  }

  /**
   * The SSRF check at registration. The same check runs again on every send
   * (DNS can change), so this is for the owner's benefit: refuse what can
   * never be delivered, with a code the UI can turn into the env var to set.
   */
  private async assertUrl(url: string): Promise<void> {
    try {
      await assertSafeUrl(url, {
        allowedCidrs: this.config.allowedCidrs,
        allowHttp: this.config.allowHttp,
      });
    } catch (error) {
      if (error instanceof SafeOutboundError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          ...(error.address ? { address: error.address } : {}),
        });
      }
      throw error;
    }
  }

  /** Every filtered folder must be one of this workspace's. */
  private async assertFolders(
    workspaceId: string,
    folderIds: string[],
  ): Promise<void> {
    if (folderIds.length === 0) return;
    const found = await this.prisma.folder.count({
      where: { id: { in: folderIds }, workspaceId },
    });
    if (found !== new Set(folderIds).size) {
      throw new BadRequestException('Unknown folder in folderIds');
    }
  }

  /**
   * A failed test never blocks saving — the endpoint may be registered before
   * its receiver exists — so even a worker fault becomes a result, not a 500
   * that would hide the webhook that was just created.
   */
  private async runTest(
    webhookId: string,
    userId: number,
  ): Promise<TestResult> {
    try {
      // The test carries who sent it, like every other event's `actor`.
      const actor = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true },
      });
      return await this.worker.sendTest(webhookId, actor);
    } catch (error) {
      this.logger.warn(
        `webhook test send failed for ${webhookId}: ${String(error)}`,
      );
      return {
        ok: false,
        status: null,
        durationMs: null,
        error: 'The test could not be sent',
        errorCode: null,
        responseExcerpt: null,
      };
    }
  }
}
