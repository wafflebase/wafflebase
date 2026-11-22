import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, type Webhook } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PgBus, sharedPgBus } from '../common/pg-bus';
import { SafeOutboundError, safeFetch } from '../common/safe-outbound';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import type { TestResult } from './webhook.dto';
import {
  CLAIM_BATCH_SIZE,
  DELIVERY_RETENTION_MS,
  DELIVERY_TIMEOUT_MS,
  HOURLY_DELIVERY_CAP,
  LEASE_MS,
  MAX_ATTEMPTS,
  MAX_IN_FLIGHT_PER_WEBHOOK,
  POLL_INTERVAL_MS,
  RESPONSE_EXCERPT_BYTES,
  WEBHOOK_NOTIFY_CHANNEL,
  type WebhookConfig,
} from './webhook-config';
import { WEBHOOK_CONFIG, WebhookEventService } from './webhook-event.service';
import {
  classifyStatus,
  parseRetryAfterMs,
  planFailure,
  streakDecision,
} from './webhook-retry';
import { decryptSecret, secretsKeyProblem } from './webhook-secret';
import { signWebhook } from './webhook-signer';
import type {
  Actor,
  ApiWriter,
  WebhookDisabledReason,
  WebhookEnvelope,
} from './webhook.types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Sends one replica runs at once, across every webhook. */
const MAX_LOCAL_IN_FLIGHT = CLAIM_BATCH_SIZE;
/** Pending rows a claim considers before ranking them per webhook. */
const CLAIM_SCAN_SIZE = CLAIM_BATCH_SIZE * 10;
/** `WebhookContentPending` rows flushed per tick. */
const FLUSH_BATCH_SIZE = 50;
/** How often the hourly-cap overflow is looked for. */
const CAP_REPORT_INTERVAL_MS = 60_000;
/**
 * Serializes claims across replicas, so the per-webhook in-flight count a
 * claim reads is not raced by another replica's claim. Claims are one short
 * statement every few seconds per replica; the sends stay concurrent.
 * An arbitrary constant, unique in this codebase's advisory-lock space.
 */
const CLAIM_LOCK_KEY = 0x77686b31; // 'whk1'

/** This package's version, read off disk as `instrument.ts` explains. */
function packageVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, '../../package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const WEBHOOK_USER_AGENT = `Wafflebase-Webhooks/${packageVersion()}`;

/** The columns a claim returns. */
interface ClaimedRow {
  id: string;
  webhookId: string;
  eventType: string;
  payload: unknown;
  /** Including the attempt this claim starts. */
  attempts: number;
}

interface PendingRow {
  documentId: string;
  firstSeenAt: Date;
  lastIssuedAt: Date;
  apiWriters: unknown;
}

/** What one HTTP attempt came to. */
type AttemptResult =
  | {
      kind: 'response';
      status: number;
      headers: Record<string, string>;
      excerpt: string;
      durationMs: number;
    }
  | { kind: 'error'; code: string; message: string; durationMs: number | null };

/** A UTC instant as the `timestamp(3)` the columns hold. */
function utc(at: Date): Prisma.Sql {
  return Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/**
 * The secrets to sign with: the current one, plus the previous one while a
 * rotation overlap lasts, so a receiver verifying with either keeps working.
 */
export function signingSecrets(
  webhook: Pick<Webhook, 'secretEnc' | 'prevSecretEnc' | 'prevSecretExpiresAt'>,
  now: Date,
  decrypt: (enc: string) => string = decryptSecret,
): string[] {
  const secrets = [decrypt(webhook.secretEnc)];
  if (
    webhook.prevSecretEnc &&
    webhook.prevSecretExpiresAt &&
    webhook.prevSecretExpiresAt > now
  ) {
    secrets.push(decrypt(webhook.prevSecretEnc));
  }
  return secrets;
}

/**
 * `apiWriters` as stored, narrowed to well-formed entries in time order. The
 * column is only ever written by this backend, but it is JSON, so a stray
 * shape is dropped rather than sent.
 */
export function apiWritersOf(raw: unknown): ApiWriter[] {
  if (!Array.isArray(raw)) return [];
  const out: ApiWriter[] = [];
  for (const entry of raw as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    if (
      typeof o.api_key_id === 'string' &&
      typeof o.user_id === 'number' &&
      typeof o.at === 'string'
    ) {
      out.push({ api_key_id: o.api_key_id, user_id: o.user_id, at: o.at });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

function headerValue(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/**
 * One delivery loop per replica (the `DemoResetService` shape: re-armed
 * `setTimeout`, `unref()`, re-entrancy flag). Woken on the `webhook` NOTIFY
 * channel through the shared `PgBus`, polled every 5 s as a fallback. Each
 * tick:
 *
 * 1. returns rows whose lease expired (a replica died mid-send) to `pending`;
 * 2. flushes `WebhookContentPending` windows that are quiet or past their max
 *    wait into `document.content_updated`;
 * 3. claims due rows with one `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
 *    LOCKED)`, at most {@link MAX_IN_FLIGHT_PER_WEBHOOK} in flight per webhook
 *    and none for a webhook past its hourly cap, and sends them **outside**
 *    any transaction;
 * 4. once a day, purges delivery rows past 30 days.
 *
 * A finished send wakes the loop, so a webhook's queue drains at the pace
 * its endpoint answers rather than the poll's. See `docs/design/webhooks.md`
 * § Delivery engine and § Retries and disable.
 */
@Injectable()
export class WebhookDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);
  private readonly bus: PgBus;
  private timer?: ReturnType<typeof setTimeout>;
  private unlisten: (() => Promise<void>) | null = null;
  private started = false;
  private destroyed = false;
  private running = false;
  /** A wake-up arrived mid-tick; run again as soon as it ends. */
  private rerun = false;
  private readonly inFlight = new Set<Promise<void>>();
  private lastPurgeAt = 0;
  private lastCapReportAt = 0;
  /** Webhook id → when its cap overflow was last logged. */
  private readonly capLogged = new Map<string, number>();

  /** Overridable in tests. */
  now: () => Date = () => new Date();
  random: () => number = Math.random;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: WebhookEventService,
    private readonly notifications: NotificationService,
    @Inject(WEBHOOK_CONFIG) private readonly config: WebhookConfig,
    /** Tests inject one; otherwise the process-wide bus is shared. */
    @Optional() bus?: PgBus,
  ) {
    this.bus = bus ?? sharedPgBus();
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) return;
    const keyProblem = secretsKeyProblem();
    if (keyProblem) {
      // Not fatal: the rest of the app works, and a create answers 503 with
      // the same words. Without a key no webhook can be created or signed.
      this.logger.error(`webhooks are enabled but unusable: ${keyProblem}`);
    }
    this.started = true;
    const unlisten = await this.bus.listen(WEBHOOK_NOTIFY_CHANNEL, {
      onNotify: () => this.wake(),
      // NOTIFYs sent while the listener was down are lost; look now.
      onConnect: () => this.wake(),
    });
    if (this.destroyed) {
      await unlisten();
      return;
    }
    this.unlisten = unlisten;
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    const unlisten = this.unlisten;
    this.unlisten = null;
    if (unlisten) await unlisten();
    // Sends are bounded by their timeout; an unfinished one's lease expires
    // and another replica retries it.
    await this.drain();
  }

  /** Run a tick now, or right after the one in progress. */
  wake(): void {
    if (!this.started || this.destroyed) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.schedule(0);
  }

  private schedule(delay: number): void {
    // A tick still in flight at shutdown must not re-arm after the clear.
    if (this.destroyed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runOnce().finally(() => {
        const again = this.rerun;
        this.rerun = false;
        this.schedule(again ? 0 : POLL_INTERVAL_MS);
      });
    }, delay);
    // The timer must not keep a shutting-down process alive.
    this.timer.unref?.();
  }

  /**
   * One tick. Returns once rows are claimed and their sends started; await
   * {@link drain} for the sends themselves. A failing step is logged and
   * does not stop the others.
   */
  async runOnce(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      const now = this.now();
      await this.step('lease recovery', () => this.recoverLeases(now));
      await this.step('content flush', () => this.flushContent(now));
      await this.step('claim', () => this.claimAndSend(now));
      if (now.getTime() - this.lastCapReportAt >= CAP_REPORT_INTERVAL_MS) {
        this.lastCapReportAt = now.getTime();
        await this.step('cap report', () => this.reportCapped(now));
      }
      if (now.getTime() - this.lastPurgeAt >= DAY_MS) {
        this.lastPurgeAt = now.getTime();
        await this.step('purge', () => this.purge(now));
      }
    } finally {
      this.running = false;
    }
  }

  /** Wait for every send this replica has started. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private async step(name: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`webhook worker ${name} failed: ${String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Claim and send
  // -------------------------------------------------------------------------

  /**
   * An `in_flight` row whose lease expired belongs to a replica that died
   * mid-send. It goes back to `pending` — or to `failed` if that was its last
   * attempt, or a one-shot test.
   */
  private async recoverLeases(now: Date): Promise<void> {
    const expired = { status: 'in_flight', leaseUntil: { lt: now } } as const;
    await this.prisma.webhookDelivery.updateMany({
      where: {
        ...expired,
        OR: [
          { attempts: { gte: MAX_ATTEMPTS } },
          { eventType: 'webhook.test' },
        ],
      },
      data: { status: 'failed', leaseUntil: null, lastError: 'Lease expired' },
    });
    await this.prisma.webhookDelivery.updateMany({
      where: expired,
      data: { status: 'pending', leaseUntil: null, nextAttemptAt: now },
    });
  }

  private async claimAndSend(now: Date): Promise<void> {
    const room = Math.min(
      CLAIM_BATCH_SIZE,
      MAX_LOCAL_IN_FLIGHT - this.inFlight.size,
    );
    if (room <= 0) return;
    const rows = await this.claim(now, room);
    if (rows.length === 0) return;
    const webhooks = await this.prisma.webhook.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.webhookId))] } },
    });
    const byId = new Map(webhooks.map((w) => [w.id, w]));
    for (const row of rows) {
      const task = this.deliver(row, byId.get(row.webhookId))
        .catch((err) => {
          this.logger.error(
            `webhook delivery ${row.id} failed unexpectedly: ${String(err)}`,
          );
        })
        .finally(() => {
          this.inFlight.delete(task);
          this.wake();
        });
      this.inFlight.add(task);
    }
  }

  /**
   * Claim up to `limit` due rows in one statement. The innermost select locks
   * candidates with `SKIP LOCKED`; ranking them per webhook against the rows
   * already in flight keeps each endpoint at {@link MAX_IN_FLIGHT_PER_WEBHOOK}
   * concurrent requests, and a webhook that has sent
   * {@link HOURLY_DELIVERY_CAP} rows created in the last hour waits.
   */
  private async claim(now: Date, limit: number): Promise<ClaimedRow[]> {
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK_KEY})`;
      return tx.$queryRaw<ClaimedRow[]>`
        UPDATE "WebhookDelivery"
        SET "status" = 'in_flight',
            "leaseUntil" = ${utc(leaseUntil)},
            "attempts" = "attempts" + 1
        WHERE "id" IN (
          SELECT ranked."id"
          FROM (
            SELECT c."id", c."webhookId", c."nextAttemptAt",
                   row_number() OVER (
                     PARTITION BY c."webhookId"
                     ORDER BY c."nextAttemptAt", c."createdAt"
                   ) AS rn
            FROM (
              SELECT d."id", d."webhookId", d."nextAttemptAt", d."createdAt"
              FROM "WebhookDelivery" d
              JOIN "Webhook" w ON w."id" = d."webhookId"
              WHERE d."status" = 'pending'
                AND d."nextAttemptAt" <= ${utc(now)}
                AND w."status" = 'active'
              ORDER BY d."nextAttemptAt"
              LIMIT ${CLAIM_SCAN_SIZE}
              FOR UPDATE OF d SKIP LOCKED
            ) c
          ) ranked
          WHERE ranked.rn <= ${MAX_IN_FLIGHT_PER_WEBHOOK} - (
              SELECT count(*) FROM "WebhookDelivery" f
              WHERE f."webhookId" = ranked."webhookId"
                AND f."status" = 'in_flight'
            )
            AND (
              SELECT count(*) FROM "WebhookDelivery" h
              WHERE h."webhookId" = ranked."webhookId"
                AND h."createdAt" >= ${utc(hourAgo)}
                AND h."attempts" > 0
            ) < ${HOURLY_DELIVERY_CAP}
          ORDER BY ranked."nextAttemptAt"
          LIMIT ${limit}
        )
        RETURNING "id", "webhookId", "eventType", "payload", "attempts"`;
    });
  }

  /** Send one claimed row and record what happened. */
  private async deliver(
    row: ClaimedRow,
    webhook: Webhook | undefined,
  ): Promise<void> {
    // Deleted (its rows cascade) or disabled since the claim: hand the row
    // back unspent, so a re-enable sends it.
    if (!webhook || webhook.status !== 'active') {
      await this.prisma.webhookDelivery.updateMany({
        where: { id: row.id, status: 'in_flight' },
        data: {
          status: 'pending',
          leaseUntil: null,
          attempts: { decrement: 1 },
        },
      });
      return;
    }

    const result = await this.attempt(webhook, row);
    const now = this.now();
    const where = { id: row.id, status: 'in_flight' } as const;

    if (result.kind === 'response') {
      const outcome = classifyStatus(result.status);
      const recorded = {
        leaseUntil: null,
        lastStatus: result.status,
        lastDurationMs: result.durationMs,
        responseExcerpt: result.excerpt || null,
      };
      if (outcome === 'success') {
        await this.prisma.webhookDelivery.updateMany({
          where,
          data: {
            ...recorded,
            status: 'delivered',
            deliveredAt: now,
            lastError: null,
          },
        });
        await this.prisma.webhook.updateMany({
          where: { id: webhook.id },
          data: {
            lastDeliveryAt: now,
            lastDeliveryStatus: result.status,
            failingSince: null,
            warnedAt: null,
          },
        });
        return;
      }
      if (outcome === 'gone') {
        await this.prisma.webhookDelivery.updateMany({
          where,
          data: { ...recorded, status: 'failed', lastError: 'HTTP 410 Gone' },
        });
        // Not through `recordFailure`: this disables for `gone` whatever the
        // streak says, and must not race it into `failing`.
        await this.prisma.webhook.updateMany({
          where: { id: webhook.id },
          data: { lastDeliveryAt: now, lastDeliveryStatus: result.status },
        });
        await this.disable(
          webhook,
          'gone',
          'Turned off: the endpoint answered 410 Gone.',
          now,
          now,
        );
        return;
      }
      const retryAfterMs =
        outcome === 'rate_limited'
          ? parseRetryAfterMs(headerValue(result.headers, 'retry-after'), now)
          : null;
      const plan = planFailure({
        attemptsMade: row.attempts,
        now,
        retryAfterMs,
        random: this.random,
      });
      await this.prisma.webhookDelivery.updateMany({
        where,
        data: {
          ...recorded,
          ...plan,
          lastError:
            result.status >= 300 && result.status < 400
              ? `HTTP ${result.status}: redirects are not followed`
              : `HTTP ${result.status}`,
        },
      });
      await this.recordFailure(webhook, result.status, now);
      return;
    }

    const plan = planFailure({
      attemptsMade: row.attempts,
      now,
      random: this.random,
    });
    await this.prisma.webhookDelivery.updateMany({
      where,
      data: {
        ...plan,
        leaseUntil: null,
        lastStatus: null,
        lastError: result.message,
        lastDurationMs: result.durationMs,
        responseExcerpt: null,
      },
    });
    await this.recordFailure(webhook, null, now);
  }

  /**
   * Sign and POST. Never throws: a refusal by the SSRF guard, a timeout or a
   * secret that no longer decrypts is a failed attempt like any other.
   */
  private async attempt(
    webhook: Webhook,
    delivery: { id: string; eventType: string; payload: unknown },
  ): Promise<AttemptResult> {
    const body = JSON.stringify(delivery.payload);
    const now = this.now();
    let headers: Record<string, string>;
    try {
      headers = {
        ...signWebhook({
          id: delivery.id,
          timestamp: Math.floor(now.getTime() / 1000),
          body,
          secrets: signingSecrets(webhook, now),
        }),
        'content-type': 'application/json',
        'user-agent': WEBHOOK_USER_AGENT,
        'x-wafflebase-event': delivery.eventType,
      };
    } catch (err) {
      // The encryption key changed under the stored secret; the owner rotates.
      this.logger.error(
        `webhook ${webhook.id}: cannot sign (${(err as Error).message})`,
      );
      return {
        kind: 'error',
        code: 'secret_unavailable',
        message: 'The signing secret cannot be read; rotate it',
        durationMs: null,
      };
    }

    try {
      const res = await safeFetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        timeoutMs: DELIVERY_TIMEOUT_MS,
        maxResponseBytes: RESPONSE_EXCERPT_BYTES,
        allowedCidrs: this.config.allowedCidrs,
        allowHttp: this.config.allowHttp,
      });
      return {
        kind: 'response',
        status: res.status,
        headers: res.headers,
        excerpt: res.bodyExcerpt,
        durationMs: res.durationMs,
      };
    } catch (err) {
      if (err instanceof SafeOutboundError) {
        return {
          kind: 'error',
          code: err.code,
          message: err.message,
          durationMs: null,
        };
      }
      return {
        kind: 'error',
        code: 'network',
        message: 'The request failed',
        durationMs: null,
      };
    }
  }

  /**
   * Note a failed attempt on the webhook: open the failure streak if this is
   * its first failure, then warn once or disable as the streak's age calls
   * for. Each transition is a conditional update, so two replicas failing
   * the same webhook at once send one notification.
   */
  private async recordFailure(
    webhook: Webhook,
    status: number | null,
    now: Date,
  ): Promise<void> {
    await this.prisma.webhook.updateMany({
      where: { id: webhook.id },
      data: { lastDeliveryAt: now, lastDeliveryStatus: status },
    });
    await this.prisma.webhook.updateMany({
      where: { id: webhook.id, failingSince: null },
      data: { failingSince: now },
    });
    const current = await this.prisma.webhook.findUnique({
      where: { id: webhook.id },
    });
    if (!current || current.status !== 'active' || !current.failingSince) {
      return;
    }
    const decision = streakDecision({
      failingSince: current.failingSince,
      warnedAt: current.warnedAt,
      now,
    });
    if (decision === 'disable') {
      await this.disable(
        current,
        'failing',
        `Turned off automatically after 3 days of failed deliveries.${
          status !== null ? ` Last response: ${status}.` : ''
        }`,
        current.failingSince,
        now,
      );
      return;
    }
    if (decision === 'warn') {
      const { count } = await this.prisma.webhook.updateMany({
        where: { id: webhook.id, warnedAt: null },
        data: { warnedAt: now },
      });
      if (count === 0) return;
      await this.notify(
        current,
        'webhook_failing',
        'Deliveries have failed for 2 days. It turns off automatically after 3 days of failures.',
        current.failingSince,
      );
    }
  }

  /**
   * Turn the webhook off and fail what it still has queued, so a re-enable
   * sends only what its "recover since" asks for. Owners hear about it once.
   */
  private async disable(
    webhook: Webhook,
    reason: Extract<WebhookDisabledReason, 'failing' | 'gone'>,
    words: string,
    since: Date,
    now: Date,
  ): Promise<void> {
    const { count } = await this.prisma.webhook.updateMany({
      where: { id: webhook.id, status: 'active' },
      data: { status: 'disabled', disabledAt: now, disabledReason: reason },
    });
    if (count === 0) return;
    await this.prisma.webhookDelivery.updateMany({
      where: { webhookId: webhook.id, status: 'pending' },
      data: { status: 'failed', lastError: 'Webhook turned off' },
    });
    this.logger.warn(`webhook ${webhook.id} disabled: ${reason}`);
    await this.notify(webhook, 'webhook_disabled', words, since);
  }

  private async notify(
    webhook: Webhook,
    type: 'webhook_failing' | 'webhook_disabled',
    reason: string,
    since: Date,
  ): Promise<void> {
    try {
      await this.notifications.createWebhookAlert({
        workspaceId: webhook.workspaceId,
        webhook: { id: webhook.id, name: webhook.name },
        type,
        reason,
        since,
      });
    } catch (err) {
      this.logger.warn(
        `webhook ${webhook.id}: ${type} notification failed: ${String(err)}`,
      );
    }
  }

  /**
   * Log, once an hour per webhook, each webhook that has due rows held back
   * by its hourly cap. The rows stay `pending` and go out as the hour rolls
   * over — reported, never silently dropped.
   */
  private async reportCapped(now: Date): Promise<void> {
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const capped = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT h."webhookId" AS id
      FROM "WebhookDelivery" h
      JOIN "Webhook" w ON w."id" = h."webhookId"
      WHERE w."status" = 'active'
        AND h."createdAt" >= ${utc(hourAgo)}
        AND h."attempts" > 0
      GROUP BY h."webhookId"
      HAVING count(*) >= ${HOURLY_DELIVERY_CAP}
        AND bool_or(h."status" = 'pending')`;
    for (const [id, at] of this.capLogged) {
      if (now.getTime() - at >= HOUR_MS) this.capLogged.delete(id);
    }
    for (const { id } of capped) {
      if (this.capLogged.has(id)) continue;
      this.capLogged.set(id, now.getTime());
      this.logger.warn(
        `webhook ${id} reached ${HOURLY_DELIVERY_CAP} deliveries in an hour; ` +
          'further events wait in the queue',
      );
    }
  }

  private async purge(now: Date): Promise<void> {
    const { count } = await this.prisma.webhookDelivery.deleteMany({
      where: {
        createdAt: { lt: new Date(now.getTime() - DELIVERY_RETENTION_MS) },
        status: { not: 'in_flight' },
      },
    });
    if (count > 0) this.logger.log(`purged ${count} webhook deliveries`);
  }

  // -------------------------------------------------------------------------
  // document.content_updated coalescing (the flush half)
  // -------------------------------------------------------------------------

  /**
   * Turn every coalescing window that has been quiet for `quietMs`, or open
   * for `maxWaitMs`, into one `document.content_updated`.
   */
  private async flushContent(now: Date): Promise<void> {
    const quietCut = new Date(now.getTime() - this.config.quietMs);
    const maxCut = new Date(now.getTime() - this.config.maxWaitMs);
    const due = await this.prisma.webhookContentPending.findMany({
      where: {
        OR: [
          { lastIssuedAt: { lte: quietCut } },
          { firstSeenAt: { lte: maxCut } },
        ],
      },
      select: { documentId: true },
      orderBy: { firstSeenAt: 'asc' },
      take: FLUSH_BATCH_SIZE,
    });
    for (const { documentId } of due) {
      await this.step(`flush ${documentId}`, () =>
        this.flushOne(documentId, quietCut, maxCut),
      );
    }
  }

  /**
   * Delete the window and emit its event in one transaction, so a crash
   * loses neither nor sends both. The delete re-checks the window and
   * returns what it removed: an edit that landed after the read either
   * extended the window (no longer due — nothing deleted) or is in the row
   * returned, `api_writers` included. A second replica's delete finds
   * nothing. A trashed document's window is dropped without an event.
   */
  private async flushOne(
    documentId: string,
    quietCut: Date,
    maxCut: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.$queryRaw<PendingRow[]>`
        DELETE FROM "WebhookContentPending"
        WHERE "documentId" = ${documentId}
          AND ("lastIssuedAt" <= ${utc(quietCut)} OR "firstSeenAt" <= ${utc(maxCut)})
        RETURNING "documentId", "firstSeenAt", "lastIssuedAt", "apiWriters"`;
      const row = removed[0];
      if (!row) return;
      const document = await tx.document.findFirst({
        where: { id: documentId, deletedAt: null },
        select: {
          id: true,
          type: true,
          title: true,
          workspaceId: true,
          folderId: true,
        },
      });
      if (!document) return;
      await this.events.emitDocumentEvent(tx, {
        type: 'document.content_updated',
        actor: null,
        document,
        extra: {
          window_start: row.firstSeenAt.toISOString(),
          updated_at: row.lastIssuedAt.toISOString(),
          api_writers: apiWritersOf(row.apiWriters),
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Management API hooks
  // -------------------------------------------------------------------------

  /**
   * Pull a delivery's next attempt to now and wake the loop (redeliver). The
   * row keeps its id — the `webhook-id` a receiver deduplicates on — and its
   * attempt count, so this is one more attempt of the same delivery rather
   * than a parallel one. A row already in flight is left alone. Waits for the
   * webhook to be enabled if it is not.
   */
  async deliverNow(deliveryId: string): Promise<void> {
    await this.prisma.webhookDelivery.updateMany({
      where: {
        id: deliveryId,
        status: { in: ['pending', 'failed', 'delivered'] },
      },
      data: { status: 'pending', nextAttemptAt: this.now(), leaseUntil: null },
    });
    this.wake();
  }

  /**
   * Send a signed `webhook.test` to one webhook, synchronously, whatever its
   * status. It is stored as a delivery so it shows in the log, but it is one
   * shot: no retries, and its outcome never moves the failure streak — a
   * test of an endpoint not built yet must not count toward disabling it.
   */
  async sendTest(
    webhookId: string,
    actor: Actor | null = null,
  ): Promise<TestResult> {
    const webhook = await this.prisma.webhook.findUnique({
      where: { id: webhookId },
    });
    if (!webhook) throw new NotFoundException('Webhook not found');
    const now = this.now();
    const envelope: WebhookEnvelope = {
      type: 'webhook.test',
      timestamp: now.toISOString(),
      data: {
        workspace_id: webhook.workspaceId,
        actor,
        webhook: { id: webhook.id, name: webhook.name },
      },
    };
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventType: 'webhook.test',
        payload: envelope as unknown as Prisma.InputJsonValue,
        status: 'in_flight',
        attempts: 1,
        nextAttemptAt: now,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      },
    });

    const result = await this.attempt(webhook, {
      id: delivery.id,
      eventType: 'webhook.test',
      payload: envelope,
    });
    const done = this.now();
    if (result.kind === 'response') {
      const ok = classifyStatus(result.status) === 'success';
      await this.prisma.webhookDelivery.updateMany({
        where: { id: delivery.id, status: 'in_flight' },
        data: {
          status: ok ? 'delivered' : 'failed',
          deliveredAt: ok ? done : null,
          leaseUntil: null,
          lastStatus: result.status,
          lastError: ok ? null : `HTTP ${result.status}`,
          lastDurationMs: result.durationMs,
          responseExcerpt: result.excerpt || null,
        },
      });
      return {
        ok,
        status: result.status,
        durationMs: result.durationMs,
        error: ok ? null : `HTTP ${result.status}`,
        errorCode: null,
        responseExcerpt: result.excerpt || null,
      };
    }
    await this.prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: 'in_flight' },
      data: {
        status: 'failed',
        leaseUntil: null,
        lastStatus: null,
        lastError: result.message,
        lastDurationMs: result.durationMs,
      },
    });
    return {
      ok: false,
      status: null,
      durationMs: result.durationMs,
      error: result.message,
      errorCode: result.code,
      responseExcerpt: null,
    };
  }
}
