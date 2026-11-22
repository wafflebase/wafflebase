import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, Subject } from 'rxjs';
import { PgBus, sharedPgBus } from '../common/pg-bus';
import { PrismaService } from '../database/prisma.service';
import { ChatBusEvent } from './chat.types';

/** The Postgres NOTIFY channel every replica listens on. */
export const CHAT_NOTIFY_CHANNEL = 'chat';
const CHANNEL = CHAT_NOTIFY_CHANNEL;
/** How long a self-sent probe may take before we suspect a pooler. */
const PROBE_TIMEOUT_MS = 5_000;

type MsgEvent = Extract<ChatBusEvent, { t: 'msg' }>;
type UpdEvent = Extract<ChatBusEvent, { t: 'upd' }>;

/**
 * Narrow an untrusted NOTIFY payload to a `ChatBusEvent`. Anybody with a
 * database session can `pg_notify('chat', …)`, so a malformed payload is
 * dropped rather than routed. Returns the probe id for a probe.
 */
export function parsePayload(
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
    (o.a === null || typeof o.a === 'number') &&
    typeof o.i === 'boolean'
  ) {
    return { t: 'msg', c: o.c, w: o.w, s: o.s, r: o.r, a: o.a, i: o.i };
  }
  if (
    o.t === 'upd' &&
    typeof o.w === 'string' &&
    typeof o.id === 'string' &&
    (o.r === null || typeof o.r === 'string')
  ) {
    return { t: 'upd', c: o.c, w: o.w, id: o.id, r: o.r };
  }
  return null;
}

/**
 * The `mem` payload: a channel's membership changed. Exported for modules
 * that announce one without depending on `ChatBus` (see
 * `WorkspaceService.removeMember`), so the wire shape has one author.
 */
export function memPayload(channelId: string): string {
  const event: ChatBusEvent = { t: 'mem', c: channelId };
  return JSON.stringify(event);
}

/**
 * Announces membership changes with a raw `pg_notify`, for the modules that
 * change membership without `ChatBus` (workspace removal, invite accept,
 * workspace claim). Runs after commit — a replica that reloaded before the
 * change was visible would cache the old set again — and is best-effort: the
 * change has committed either way, so a failure is logged, not thrown.
 */
export async function announceMembershipRaw(
  prisma: Pick<PrismaService, '$executeRaw'>,
  channelIds: string[],
  logger: { warn(message: string): void },
): Promise<void> {
  for (const channelId of channelIds) {
    try {
      await prisma.$executeRaw`SELECT pg_notify(${CHAT_NOTIFY_CHANNEL}, ${memPayload(channelId)})`;
    } catch (err) {
      logger.warn(
        `chat membership notify failed for ${channelId}: ${String(err)}`,
      );
    }
  }
}

/**
 * Cross-replica fan-out of chat events over Postgres `LISTEN/NOTIFY`.
 *
 * Every replica listens on `chat` through the process's shared `PgBus` (one
 * dedicated `pg.Client` for every channel, reconnecting with backoff); a
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
   * Fires on every successful (re)connection. Events NOTIFYed while the
   * listener was down are lost, `mem` included, so anything cached from them
   * must be dropped and open streams must catch up. The first connection
   * fires too: a listener that was down at boot may already have streams.
   */
  readonly resets$: Observable<void> = this.resets.asObservable();

  private readonly bus: PgBus;
  private unlisten: (() => Promise<void>) | null = null;
  private stopped = false;
  private readonly probes = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    /** Tests inject one; otherwise the process-wide bus is shared. */
    @Optional() bus?: PgBus,
  ) {
    this.bus = bus ?? sharedPgBus();
  }

  /**
   * Starts listening here, not in the constructor, so a unit test that
   * builds the provider without a database never touches the network. The
   * first attempt is awaited but never throws: a database that is down at
   * boot only delays chat delivery, it must not stop the server.
   */
  async onModuleInit(): Promise<void> {
    const unlisten = await this.bus.listen(CHANNEL, {
      onNotify: (payload) => this.receive(payload),
      onConnect: () => {
        if (this.stopped) return;
        this.resets.next();
        void this.probe();
      },
    });
    if (this.stopped) {
      await unlisten();
      return;
    }
    this.unlisten = unlisten;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const timer of this.probes.values()) clearTimeout(timer);
    this.probes.clear();
    const unlisten = this.unlisten;
    this.unlisten = null;
    if (unlisten) await unlisten();
    this.events.complete();
    this.resets.complete();
  }

  async notifyMessage(e: MsgEvent): Promise<void> {
    await this.send({
      t: 'msg',
      c: e.c,
      w: e.w,
      s: e.s,
      r: e.r,
      a: e.a,
      i: e.i,
    });
  }

  /** A message was edited or deleted. Ids only, like `notifyMessage`. */
  async notifyUpdate(e: UpdEvent): Promise<void> {
    await this.send({ t: 'upd', c: e.c, w: e.w, id: e.id, r: e.r });
  }

  async notifyMembership(channelId: string): Promise<void> {
    await this.sendRaw(memPayload(channelId));
  }

  /**
   * Called after the write has committed. A failed NOTIFY must not fail the
   * request that caused it — the write stands, and clients catch up on their
   * next reconnect — so it is logged and swallowed.
   */
  private async send(payload: object): Promise<void> {
    await this.sendRaw(JSON.stringify(payload));
  }

  private async sendRaw(json: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${json})`;
    } catch (err) {
      this.logger.warn(`chat NOTIFY failed: ${(err as Error).message}`);
    }
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
