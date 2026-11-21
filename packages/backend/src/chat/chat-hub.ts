import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject, Subscription, concatMap } from 'rxjs';
import { PrismaService } from '../database/prisma.service';
import { ChatBus } from './chat-bus';
import { ChatBusEvent } from './chat.types';

type MsgEvent = Extract<ChatBusEvent, { t: 'msg' }>;

/**
 * Per-replica routing from the chat bus to the SSE handlers connected here.
 *
 * Each `msg` goes to the connected users who are members of its channel.
 * Member sets are cached per channel, loaded lazily on the first event a
 * channel sends while somebody is connected, and evicted by that channel's
 * `mem` event — so a member removed while their stream is open stops
 * receiving it from the next event on. A bus reconnect evicts everything,
 * since a `mem` sent during the outage never arrived.
 *
 * Events are routed one at a time, in arrival order: a `mem` must take
 * effect before the `msg` behind it, and a channel's messages must not
 * overtake each other while one of them waits on a cache load.
 */
@Injectable()
export class ChatHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatHub.name);
  private readonly subscribers = new Map<number, Set<Subject<MsgEvent>>>();
  private readonly members = new Map<string, Set<number>>();
  private subscription: Subscription | null = null;

  constructor(
    private readonly bus: ChatBus,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.subscription = this.bus.events$
      .pipe(concatMap((event) => this.route(event)))
      .subscribe();
    this.subscription.add(
      this.bus.resets$.subscribe(() => this.members.clear()),
    );
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /**
   * Message events for one user, across every workspace they belong to.
   * Registration happens on subscribe, with a subject per subscription, for
   * the same reasons as `NotificationHub.subscribe`.
   */
  subscribe(userId: number): Observable<MsgEvent> {
    return new Observable<MsgEvent>((observer) => {
      const subject = new Subject<MsgEvent>();
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
  private async membersOf(event: MsgEvent): Promise<Set<number>> {
    const cached = this.members.get(event.c);
    if (cached) return cached;
    const rows = await this.prisma.chatChannelMember.findMany({
      where: {
        channelId: event.c,
        user: { workspaceMembers: { some: { workspaceId: event.w } } },
      },
      select: { userId: true },
    });
    const set = new Set(rows.map((row) => row.userId));
    this.members.set(event.c, set);
    return set;
  }
}
