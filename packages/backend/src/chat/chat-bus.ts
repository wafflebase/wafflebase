import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { Observable, Subject } from 'rxjs';
import { PrismaService } from '../database/prisma.service';
import { ChatBusEvent } from './chat.types';

/** The Postgres NOTIFY channel every replica listens on. */
const CHANNEL = 'chat';
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** How long a self-sent probe may take before we suspect a pooler. */
const PROBE_TIMEOUT_MS = 5_000;

type MsgEvent = Extract<ChatBusEvent, { t: 'msg' }>;

/**
 * Narrow an untrusted NOTIFY payload to a `ChatBusEvent`. Anybody with a
 * database session can `pg_notify('chat', …)`, so a malformed payload is
 * dropped rather than routed. Returns the probe id for a probe.
 */
function parsePayload(
  raw: string | undefined,
): ChatBusEvent | { probe: string } | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.t === 'probe' && typeof o.id === 'string') return { probe: o.id };
  if (typeof o.c !== 'string') return null;
  if (o.t === 'mem') return { t: 'mem', c: o.c };
  if (
    o.t === 'msg' &&
    typeof o.w === 'string' &&
    typeof o.s === 'number' &&
    (o.r === null || typeof o.r === 'string') &&
    (o.a === null || typeof o.a === 'number')
  ) {
    return { t: 'msg', c: o.c, w: o.w, s: o.s, r: o.r, a: o.a };
  }
  return null;
}

/**
 * Cross-replica fan-out of chat events over Postgres `LISTEN/NOTIFY`.
 *
 * Every replica holds one dedicated `pg.Client` listening on `chat`; a
 * NOTIFY is sent through Prisma, so it rides the same path as the write it
 * announces. The payload carries ids only (see `ChatBusEvent`) — a missed
 * event costs a client a refetch on reconnect, never content.
 *
 * The listener must reach Postgres directly: a transaction-mode pooler
 * (PgBouncer) silently drops `LISTEN`. `CHAT_LISTEN_DATABASE_URL` points it
 * past one, and a probe on every connect warns when it does not round-trip.
 * See `docs/design/chat.md` § Delivery.
 */
@Injectable()
export class ChatBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatBus.name);
  private readonly events = new Subject<ChatBusEvent>();
  private readonly resets = new Subject<void>();
  readonly events$: Observable<ChatBusEvent> = this.events.asObservable();
  /**
   * Fires on every reconnect after the first connection. Events NOTIFYed
   * while the listener was down are lost, `mem` included, so anything cached
   * from them must be dropped.
   */
  readonly resets$: Observable<void> = this.resets.asObservable();

  private client: Client | null = null;
  private stopped = false;
  private connectedOnce = false;
  private backoffMs = BACKOFF_MIN_MS;
  private retryTimer: NodeJS.Timeout | null = null;
  private readonly probes = new Map<string, NodeJS.Timeout>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Opens the listener here, not in the constructor, so a unit test that
   * builds the provider without a database never touches the network. The
   * first attempt is awaited but never throws: a database that is down at
   * boot only delays chat delivery, it must not stop the server.
   */
  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const timer of this.probes.values()) clearTimeout(timer);
    this.probes.clear();
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
    this.events.complete();
    this.resets.complete();
  }

  async notifyMessage(e: MsgEvent): Promise<void> {
    await this.send({ t: 'msg', c: e.c, w: e.w, s: e.s, r: e.r, a: e.a });
  }

  async notifyMembership(channelId: string): Promise<void> {
    await this.send({ t: 'mem', c: channelId });
  }

  /**
   * Called after the write has committed. A failed NOTIFY must not fail the
   * request that caused it — the write stands, and clients catch up on their
   * next reconnect — so it is logged and swallowed.
   */
  private async send(payload: object): Promise<void> {
    try {
      const json = JSON.stringify(payload);
      await this.prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${json})`;
    } catch (err) {
      this.logger.warn(`chat NOTIFY failed: ${(err as Error).message}`);
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({
      connectionString:
        process.env.CHAT_LISTEN_DATABASE_URL || process.env.DATABASE_URL,
    });
    // Without a listener an `error` event would crash the process.
    client.on('error', (err) => this.drop(client, err));
    client.on('end', () => this.drop(client));
    client.on('notification', (n) => {
      if (n.channel === CHANNEL) this.receive(n.payload);
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (err) {
      client.removeAllListeners('end');
      await client.end().catch(() => undefined);
      this.scheduleReconnect(err as Error);
      return;
    }
    if (this.stopped) {
      await client.end().catch(() => undefined);
      return;
    }

    this.client = client;
    this.backoffMs = BACKOFF_MIN_MS;
    if (this.connectedOnce) {
      this.logger.log('chat LISTEN reconnected');
      this.resets.next();
    }
    this.connectedOnce = true;
    void this.probe();
  }

  /** Tear down a broken listener once, then try again with backoff. */
  private drop(client: Client, err?: Error): void {
    if (this.client !== client) return;
    this.client = null;
    client.removeAllListeners();
    // A late `error` after teardown must still have a handler.
    client.on('error', () => undefined);
    void client.end().catch(() => undefined);
    this.scheduleReconnect(err);
  }

  private scheduleReconnect(err?: Error): void {
    if (this.stopped || this.retryTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.logger.warn(
      `chat LISTEN unavailable${err ? ` (${err.message})` : ''}; retrying in ${delay}ms`,
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  /**
   * Send a NOTIFY through the same path real events take and wait for it to
   * come back on the listener. Silence means the two ends do not share a
   * server session's notification queue — almost always a pooler in front of
   * the listener — and chat would otherwise fail without a trace.
   */
  private async probe(): Promise<void> {
    const id = randomUUID();
    const timer = setTimeout(() => {
      this.probes.delete(id);
      this.logger.warn(
        `chat LISTEN probe did not round-trip within ${PROBE_TIMEOUT_MS}ms; ` +
          'is CHAT_LISTEN_DATABASE_URL behind a transaction-mode pooler?',
      );
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    this.probes.set(id, timer);
    await this.send({ t: 'probe', id });
  }

  private receive(raw: string | undefined): void {
    const parsed = parsePayload(raw);
    if (!parsed) return;
    if ('probe' in parsed) {
      const timer = this.probes.get(parsed.probe);
      if (timer) clearTimeout(timer);
      this.probes.delete(parsed.probe);
      return;
    }
    this.events.next(parsed);
  }
}
