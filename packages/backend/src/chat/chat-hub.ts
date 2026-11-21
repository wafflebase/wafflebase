import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject, Subscription, concatMap } from 'rxjs';
import { PrismaService } from '../database/prisma.service';
import { ChatBus } from './chat-bus';
import { ChatBusEvent, ChatHubEvent, ChatRoutedEvent } from './chat.types';

/**
 * How long a cached member set is trusted. Eviction is `mem`-driven, and a
 * `mem` NOTIFY is best effort (`ChatBus.send` logs and swallows a failure),
 * so a lost one must not keep routing a removed member's channel events to
 * them indefinitely. The age bounds that; the events are ids only, and every
 * fetch they prompt re-checks access.
 */
export const MEMBER_CACHE_TTL_MS = 60_000;

/** Loads of one member set that a bus reset may interrupt before giving up. */
const MEMBER_LOAD_ATTEMPTS = 3;

/**
 * Per-replica routing from the chat bus to the SSE handlers connected here.
 *
 * Each `msg` and `upd` goes to the connected users who are members of its channel.
 * Member sets are cached per channel, loaded lazily on the first event a
 * channel sends while somebody is connected, and evicted by that channel's
 * `mem` event — so a member removed while their stream is open stops
 * receiving it from the next event on. An entry also expires after
 * `MEMBER_CACHE_TTL_MS`, in case its `mem` was never sent. A bus reconnect
 * evicts everything, since a `mem` sent during the outage never arrived, and
 * tells every open stream `ready` so its client catches up on what the
 * outage swallowed.
 *
 * Events are routed one at a time, in arrival order: a `mem` must take
 * effect before the `msg` behind it, and a channel's messages must not
 * overtake each other while one of them waits on a cache load.
 */
@Injectable()
export class ChatHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatHub.name);
  private readonly subscribers = new Map<number, Set<Subject<ChatHubEvent>>>();
  private readonly members = new Map<
    string,
    { set: Set<number>; loadedAt: number }
  >();
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
   * Message and update events for one user, across every workspace they belong to.
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
    for (const set of this.subscribers.values()) {
      for (const subject of set) subject.next({ t: 'ready' });
    }
  }

  private async route(event: ChatBusEvent): Promise<void> {
    if (event.t === 'mem') {
      this.members.delete(event.c);
      return;
    }
    // An idle replica has nobody to deliver to; skip the database.
    if (this.subscribers.size === 0) return;

    let members: Set<number>;
    try {
      members = await this.membersOf(event);
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
   * The channel's members who still belong to its workspace. The second
   * condition is the policy's "workspace membership first": a channel row
   * that outlives the workspace membership grants nothing, here as in
   * `canRead`.
   */
  private async membersOf(event: ChatRoutedEvent): Promise<Set<number>> {
    const cached = this.members.get(event.c);
    if (cached && Date.now() - cached.loadedAt < MEMBER_CACHE_TTL_MS) {
      return cached.set;
    }
    // A reset while the query is in flight means a `mem` may have been lost
    // after the query read its rows, so its answer is reloaded, not used. A
    // flapping listener could interrupt every attempt, so they are bounded;
    // giving up drops this event, and the channel's next one loads again.
    for (let attempt = 0; attempt < MEMBER_LOAD_ATTEMPTS; attempt += 1) {
      const generation = this.generation;
      const rows = await this.prisma.chatChannelMember.findMany({
        where: {
          channelId: event.c,
          user: { workspaceMembers: { some: { workspaceId: event.w } } },
        },
        select: { userId: true },
      });
      if (generation !== this.generation) continue;
      const set = new Set(rows.map((row) => row.userId));
      this.members.set(event.c, { set, loadedAt: Date.now() });
      return set;
    }
    throw new Error(
      `membership load interrupted by ${MEMBER_LOAD_ATTEMPTS} resets`,
    );
  }
}
