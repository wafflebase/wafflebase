import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject, Subscription, concatMap } from 'rxjs';
import { PrismaService } from '../database/prisma.service';
import { ChatBus } from './chat-bus';
import {
  ChannelKind,
  ChatBusEvent,
  ChatHubEvent,
  ChatRoutedEvent,
} from './chat.types';

/**
 * How long a cached member set is trusted. Eviction is `mem`-driven, and a
 * `mem` NOTIFY is best effort (`ChatBus.send` logs and swallows a failure),
 * so a lost one must not keep routing a removed member's channel events to
 * them indefinitely. The age bounds that; the events are ids only, and every
 * fetch they prompt re-checks access. Since a public channel's readers are
 * its whole workspace, a lost `mem` after a workspace removal
 * (`WorkspaceService.removeMember` announces one) lets the removed member
 * hear every public channel's ids for up to this long, not only those of the
 * channels they had joined.
 */
export const MEMBER_CACHE_TTL_MS = 60_000;

/** Loads of one member set that a bus reset may interrupt before giving up. */
const MEMBER_LOAD_ATTEMPTS = 3;

/**
 * Channels whose kind and workspace are remembered. Nothing writes either
 * after creation today, but the kind decides how wide a channel's events fan
 * out, so an entry is not trusted on that alone: it expires with the member
 * sets, is dropped on the channel's own `chn` or `mem` and on a bus reset.
 * The bound only keeps a long-lived replica from holding every channel it
 * ever routed.
 */
export const CHANNEL_CACHE_MAX = 10_000;

type CachedSet = { set: Set<number>; loadedAt: number };
type CachedChannel = {
  kind: ChannelKind;
  workspaceId: string;
  loadedAt: number;
};

/**
 * Per-replica routing from the chat bus to the SSE handlers connected here.
 *
 * Each `msg`, `upd` and `chn` goes to the connected users who can read its
 * channel (`canRead`): for a private channel or a DM its members, for a
 * public channel every member of its workspace — joined or not, since any of
 * them may be previewing it, and its rename or archive changes the channel
 * list each of them sees. The events are ids only, so the wider audience
 * learns nothing a channel-list fetch would not tell it.
 *
 * Member sets are cached per channel, and workspace member sets per
 * workspace, loaded lazily on the first event that needs one while somebody
 * is connected. A channel's `mem` evicts its own set and every workspace
 * set — removing somebody from a workspace announces `mem` for each channel
 * they were in, #general at least, and does not say which workspace — so a
 * member removed while their stream is open stops receiving from the next
 * event on. An entry also expires after `MEMBER_CACHE_TTL_MS`, in case its
 * `mem` was never sent. A bus reconnect evicts everything, since a `mem`
 * sent during the outage never arrived, and tells every open stream `ready`
 * so its client catches up on what the outage swallowed.
 *
 * Events are routed one at a time, in arrival order: a `mem` must take
 * effect before the `msg` behind it, and a channel's messages must not
 * overtake each other while one of them waits on a cache load.
 */
@Injectable()
export class ChatHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatHub.name);
  private readonly subscribers = new Map<number, Set<Subject<ChatHubEvent>>>();
  private readonly members = new Map<string, CachedSet>();
  private readonly workspaceMembers = new Map<string, CachedSet>();
  private readonly channels = new Map<string, CachedChannel>();
  /** Bumped by every reset, so a load that straddles one is not trusted. */
  private generation = 0;
  private subscription: Subscription | null = null;

  constructor(
    private readonly bus: ChatBus,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // A rejection escaping `route` would error this process-lifetime
    // subscription and silently end delivery on the replica, so each event
    // fails alone.
    this.subscription = this.bus.events$
      .pipe(
        concatMap((event) =>
          this.route(event).catch((err: unknown) => {
            this.logger.warn(
              `chat event routing failed for ${event.c}: ${String(err)}`,
            );
          }),
        ),
      )
      .subscribe();
    this.subscription.add(this.bus.resets$.subscribe(() => this.reset()));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /**
   * Message, update and channel events for one user, across every workspace
   * they belong to.
   * Registration happens on subscribe, with a subject per subscription, for
   * the same reasons as `NotificationHub.subscribe`.
   */
  subscribe(userId: number): Observable<ChatHubEvent> {
    return new Observable<ChatHubEvent>((observer) => {
      const subject = new Subject<ChatHubEvent>();
      const existing = this.subscribers.get(userId);
      if (existing) {
        existing.add(subject);
      } else {
        this.subscribers.set(userId, new Set([subject]));
      }

      const sub = subject.subscribe(observer);
      return () => {
        sub.unsubscribe();
        const set = this.subscribers.get(userId);
        if (!set) return;
        set.delete(subject);
        if (set.size === 0) this.subscribers.delete(userId);
      };
    });
  }

  /** Open connections for a user on this replica. Exposed for tests. */
  subscriberCount(userId: number): number {
    return this.subscribers.get(userId)?.size ?? 0;
  }

  private reset(): void {
    this.generation += 1;
    this.members.clear();
    this.workspaceMembers.clear();
    this.channels.clear();
    for (const set of this.subscribers.values()) {
      for (const subject of set) subject.next({ t: 'ready' });
    }
  }

  private async route(event: ChatBusEvent): Promise<void> {
    if (event.t === 'mem') {
      this.members.delete(event.c);
      this.channels.delete(event.c);
      this.workspaceMembers.clear();
      return;
    }
    // A channel's metadata changed: route this event, and those after it, by
    // what the channel is now.
    if (event.t === 'chn') this.channels.delete(event.c);
    // An idle replica has nobody to deliver to; skip the database.
    if (this.subscribers.size === 0) return;

    let members: Set<number>;
    try {
      members = await this.readersOf(event);
    } catch (err) {
      // Nothing is cached, so the channel's next event retries the load.
      this.logger.warn(
        `chat membership load failed for ${event.c}: ${(err as Error).message}`,
      );
      return;
    }

    for (const userId of members) {
      const set = this.subscribers.get(userId);
      if (!set) continue;
      for (const subject of set) subject.next(event);
    }
  }

  /**
   * Who may read the event's channel. The channel's own workspace is used,
   * not the one the event names, so a malformed event cannot widen a public
   * channel's audience to another workspace. A channel that no longer exists
   * has nobody.
   */
  private async readersOf(event: ChatRoutedEvent): Promise<Set<number>> {
    const channel = await this.channelOf(event.c);
    if (!channel) return new Set();
    if (channel.kind === 'public') {
      return this.cachedLoad(
        this.workspaceMembers,
        channel.workspaceId,
        async () =>
          (
            await this.prisma.workspaceMember.findMany({
              where: { workspaceId: channel.workspaceId },
              select: { userId: true },
            })
          ).map((row) => row.userId),
      );
    }
    return this.membersOf(event.c, channel.workspaceId);
  }

  /**
   * The channel's kind and workspace, cached. Guarded against a reset like
   * `cachedLoad`: a row read before a reset may predate a `chn` or `mem` the
   * outage swallowed, so it is re-read rather than cached over the reset's
   * `clear()`.
   */
  private async channelOf(channelId: string): Promise<CachedChannel | null> {
    const cached = this.channels.get(channelId);
    if (cached && Date.now() - cached.loadedAt < MEMBER_CACHE_TTL_MS) {
      return cached;
    }
    for (let attempt = 0; attempt < MEMBER_LOAD_ATTEMPTS; attempt += 1) {
      const generation = this.generation;
      const row = await this.prisma.chatChannel.findUnique({
        where: { id: channelId },
        select: { kind: true, workspaceId: true },
      });
      if (generation !== this.generation) continue;
      if (!row) return null;
      const channel: CachedChannel = {
        kind: row.kind as ChannelKind,
        workspaceId: row.workspaceId,
        loadedAt: Date.now(),
      };
      if (this.channels.size >= CHANNEL_CACHE_MAX) this.channels.clear();
      this.channels.set(channelId, channel);
      return channel;
    }
    throw new Error(
      `channel load interrupted by ${MEMBER_LOAD_ATTEMPTS} resets`,
    );
  }

  /**
   * The channel's members who still belong to its workspace. The second
   * condition is the policy's "workspace membership first": a channel row
   * that outlives the workspace membership grants nothing, here as in
   * `canRead`.
   */
  private membersOf(channelId: string, workspaceId: string) {
    return this.cachedLoad(this.members, channelId, async () =>
      (
        await this.prisma.chatChannelMember.findMany({
          where: {
            channelId,
            user: { workspaceMembers: { some: { workspaceId } } },
          },
          select: { userId: true },
        })
      ).map((row) => row.userId),
    );
  }

  private async cachedLoad(
    cache: Map<string, CachedSet>,
    key: string,
    load: () => Promise<number[]>,
  ): Promise<Set<number>> {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.loadedAt < MEMBER_CACHE_TTL_MS) {
      return cached.set;
    }
    // A reset while the query is in flight means a `mem` may have been lost
    // after the query read its rows, so its answer is reloaded, not used. A
    // flapping listener could interrupt every attempt, so they are bounded;
    // giving up drops this event, and the channel's next one loads again.
    for (let attempt = 0; attempt < MEMBER_LOAD_ATTEMPTS; attempt += 1) {
      const generation = this.generation;
      const ids = await load();
      if (generation !== this.generation) continue;
      const set = new Set(ids);
      cache.set(key, { set, loadedAt: Date.now() });
      return set;
    }
    throw new Error(
      `membership load interrupted by ${MEMBER_LOAD_ATTEMPTS} resets`,
    );
  }
}
