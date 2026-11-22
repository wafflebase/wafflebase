import { Logger } from '@nestjs/common';
import { Client } from 'pg';

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/**
 * Deadline for the listener's handshake and its `LISTEN`. `pg` waits forever
 * on either by default, so a server that accepts TCP and then stalls would
 * hold boot open and never reach the retry path.
 */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Channel names are interpolated into `LISTEN`, which takes an identifier and
 * no bind parameter, so only plain lower-case identifiers are accepted.
 */
const CHANNEL_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export interface PgBusHandlers {
  /** A NOTIFY arrived on the channel. The payload is untrusted. */
  onNotify(payload: string | undefined): void;
  /**
   * The channel is being listened on — on the first connection and on every
   * reconnection. NOTIFYs sent while the listener was down are lost, so a
   * subscriber that caches anything derived from them catches up here.
   */
  onConnect?(): void;
}

interface Subscription {
  channel: string;
  handlers: PgBusHandlers;
  /** The connection generation `onConnect` last fired for. */
  readyGen: number;
}

/**
 * One dedicated `pg.Client` per process listening on every channel any
 * subscriber asked for, with per-channel handlers. Chat (`chat`) and the
 * webhook worker (`webhook`) share it rather than each holding a connection.
 *
 * The listener must reach Postgres directly: a transaction-mode pooler
 * (PgBouncer) silently drops `LISTEN`. `CHAT_LISTEN_DATABASE_URL` (the name
 * predates the second subscriber) points it past one, defaulting to
 * `DATABASE_URL`. The connection opens on the first `listen()` and closes
 * after the last unsubscribe, so a unit test that builds a provider without a
 * database never touches the network. A broken connection is torn down once
 * and retried with exponential backoff (1 s → 30 s).
 *
 * NOTIFYs are *sent* through Prisma by each subscriber, on the same path as
 * the write they announce; this class only listens.
 */
export class PgBus {
  private readonly logger = new Logger(PgBus.name);
  private readonly subs = new Map<string, Set<Subscription>>();
  private client: Client | null = null;
  /** Channels `LISTEN`ed on the current client. */
  private listened = new Set<string>();
  private connecting: Promise<void> | null = null;
  private generation = 0;
  private stopped = true;
  private connectedOnce = false;
  private backoffMs = BACKOFF_MIN_MS;
  private retryTimer: NodeJS.Timeout | null = null;

  /**
   * Subscribe to `channel`. Resolves once the first connection attempt has
   * finished — never rejects: a database that is down at boot only delays
   * delivery, it must not stop the server. Returns the unsubscribe function.
   */
  async listen(
    channel: string,
    handlers: PgBusHandlers,
  ): Promise<() => Promise<void>> {
    if (!CHANNEL_NAME.test(channel)) {
      throw new Error(`invalid LISTEN channel name: ${channel}`);
    }
    const sub: Subscription = { channel, handlers, readyGen: -1 };
    let set = this.subs.get(channel);
    if (!set) {
      set = new Set();
      this.subs.set(channel, set);
    }
    set.add(sub);

    if (this.stopped) {
      this.stopped = false;
      await this.connect();
    } else if (this.connecting) {
      await this.connecting;
    }
    await this.ready(sub);
    return () => this.unlisten(sub);
  }

  /** Subscriptions still registered, for tests. */
  get size(): number {
    let n = 0;
    for (const set of this.subs.values()) n += set.size;
    return n;
  }

  /**
   * A subscription added to a live connection (or during its handshake, past
   * the point where `connect` listened) still needs its `LISTEN` and its
   * `onConnect`.
   */
  private async ready(sub: Subscription): Promise<void> {
    const client = this.client;
    if (!client || sub.readyGen === this.generation) return;
    if (!this.subs.get(sub.channel)?.has(sub)) return;
    if (!this.listened.has(sub.channel)) {
      try {
        await client.query(`LISTEN ${sub.channel}`);
        this.listened.add(sub.channel);
      } catch (err) {
        // The connection broke under us; `drop` reconnects and the next
        // connection listens on every registered channel.
        this.drop(client, err as Error);
        return;
      }
    }
    if (this.client !== client) return;
    sub.readyGen = this.generation;
    sub.handlers.onConnect?.();
  }

  private async unlisten(sub: Subscription): Promise<void> {
    const set = this.subs.get(sub.channel);
    if (!set?.delete(sub)) return;
    if (set.size > 0) return;
    this.subs.delete(sub.channel);
    if (this.subs.size === 0) {
      await this.stop();
      return;
    }
    const client = this.client;
    if (client && this.listened.delete(sub.channel)) {
      await client.query(`UNLISTEN ${sub.channel}`).catch(() => undefined);
    }
  }

  private async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.backoffMs = BACKOFF_MIN_MS;
    this.connectedOnce = false;
    const client = this.client;
    this.client = null;
    this.listened = new Set();
    if (client) await client.end().catch(() => undefined);
  }

  private connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({
      connectionString:
        process.env.CHAT_LISTEN_DATABASE_URL || process.env.DATABASE_URL,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      // The listener runs no query but `LISTEN`, so this bounds only that.
      query_timeout: CONNECT_TIMEOUT_MS,
    });
    // Without a listener an `error` event would crash the process.
    client.on('error', (err) => this.drop(client, err));
    client.on('end', () => this.drop(client));
    client.on('notification', (n) => this.dispatch(n.channel, n.payload));

    const channels = [...this.subs.keys()];
    try {
      await client.connect();
      for (const channel of channels) {
        await client.query(`LISTEN ${channel}`);
      }
    } catch (err) {
      client.removeAllListeners('end');
      await client.end().catch(() => undefined);
      this.scheduleReconnect(err as Error);
      return;
    }
    if (this.stopped) {
      client.removeAllListeners('end');
      await client.end().catch(() => undefined);
      return;
    }

    this.client = client;
    this.listened = new Set(channels);
    this.generation += 1;
    this.backoffMs = BACKOFF_MIN_MS;
    if (this.connectedOnce) {
      this.logger.log(`LISTEN reconnected (${channels.join(', ')})`);
    }
    this.connectedOnce = true;
    for (const set of [...this.subs.values()]) {
      for (const sub of [...set]) {
        if (this.listened.has(sub.channel)) {
          sub.readyGen = this.generation;
          sub.handlers.onConnect?.();
        }
      }
    }
  }

  private dispatch(channel: string, payload: string | undefined): void {
    const set = this.subs.get(channel);
    if (!set) return;
    for (const sub of [...set]) {
      try {
        sub.handlers.onNotify(payload);
      } catch (err) {
        this.logger.warn(
          `LISTEN handler for ${channel} threw: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Tear down a broken listener once, then try again with backoff. */
  private drop(client: Client, err?: Error): void {
    if (this.client !== client) return;
    this.client = null;
    this.listened = new Set();
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
      `LISTEN unavailable${err ? ` (${err.message})` : ''}; retrying in ${delay}ms`,
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
    // Waiting to reconnect is no reason to keep a process alive.
    this.retryTimer.unref?.();
  }
}

let shared: PgBus | null = null;

/**
 * The process-wide bus. Subscribers take it from here (or an injected one in
 * tests) rather than through a Nest provider, so every module that listens
 * shares the one connection without having to import a common module.
 */
export function sharedPgBus(): PgBus {
  shared ??= new PgBus();
  return shared;
}
