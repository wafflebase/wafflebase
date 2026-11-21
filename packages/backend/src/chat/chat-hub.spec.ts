import { Subject } from 'rxjs';
import { PrismaService } from '../database/prisma.service';
import { ChatBus } from './chat-bus';
import { ChatHub, MEMBER_CACHE_TTL_MS } from './chat-hub';
import { ChatBusEvent, ChatHubEvent } from './chat.types';

type MsgEvent = Extract<ChatBusEvent, { t: 'msg' }>;

function msg(c: string, s: number): MsgEvent {
  return { t: 'msg', c, w: 'w1', s, r: null, a: 1 };
}

/**
 * A hub wired to a hand-fed bus and an in-memory membership table, so each
 * test controls exactly which users the next cache load sees.
 */
function harness() {
  const events = new Subject<ChatBusEvent>();
  const resets = new Subject<void>();
  const members = new Map<string, number[]>();
  const findMany = jest.fn(({ where }: { where: { channelId: string } }) =>
    Promise.resolve(
      (members.get(where.channelId) ?? []).map((userId) => ({ userId })),
    ),
  );
  const bus = { events$: events, resets$: resets } as unknown as ChatBus;
  const prisma = {
    chatChannelMember: { findMany },
  } as unknown as PrismaService;
  const hub = new ChatHub(bus, prisma);
  hub.onModuleInit();

  function collect(userId: number) {
    const seen: ChatHubEvent[] = [];
    const sub = hub.subscribe(userId).subscribe((e) => seen.push(e));
    return { seen, stop: () => sub.unsubscribe() };
  }

  return { events, resets, members, findMany, hub, collect };
}

/** Let the hub's sequential routing drain its pending cache loads. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('ChatHub', () => {
  it('delivers a message only to channel members', async () => {
    const h = harness();
    h.members.set('c1', [1, 2]);
    const a = h.collect(1);
    const b = h.collect(2);
    const outsider = h.collect(3);

    h.events.next(msg('c1', 1));
    await flush();

    expect(a.seen).toEqual([msg('c1', 1)]);
    expect(b.seen).toEqual([msg('c1', 1)]);
    expect(outsider.seen).toEqual([]);
  });

  it('delivers an update only to channel members', async () => {
    const h = harness();
    h.members.set('c1', [1]);
    const a = h.collect(1);
    const outsider = h.collect(3);
    const upd: ChatHubEvent = {
      t: 'upd',
      c: 'c1',
      w: 'w1',
      id: 'm1',
      r: null,
    };

    h.events.next(upd);
    await flush();

    expect(a.seen).toEqual([upd]);
    expect(outsider.seen).toEqual([]);
  });

  it('drops events for a channel after membership is revoked', async () => {
    const h = harness();
    h.members.set('c1', [1, 2]);
    const removed = h.collect(2);

    h.events.next(msg('c1', 1));
    await flush();
    expect(removed.seen).toHaveLength(1);

    // The member is removed in the database, and the change is announced.
    h.members.set('c1', [1]);
    h.events.next({ t: 'mem', c: 'c1' });
    h.events.next(msg('c1', 2));
    await flush();

    expect(removed.seen).toEqual([msg('c1', 1)]);
  });

  it('caches membership until the channel changes', async () => {
    const h = harness();
    h.members.set('c1', [1]);
    h.collect(1);

    h.events.next(msg('c1', 1));
    h.events.next(msg('c1', 2));
    await flush();
    expect(h.findMany).toHaveBeenCalledTimes(1);

    h.events.next({ t: 'mem', c: 'c1' });
    h.events.next(msg('c1', 3));
    await flush();
    expect(h.findMany).toHaveBeenCalledTimes(2);
  });

  it('forgets every cached channel when the bus reconnects', async () => {
    const h = harness();
    h.members.set('c1', [1, 2]);
    const removed = h.collect(2);
    h.events.next(msg('c1', 1));
    await flush();

    // A `mem` sent while the LISTEN connection was down never arrives.
    h.members.set('c1', [1]);
    h.resets.next();
    h.events.next(msg('c1', 2));
    await flush();

    expect(removed.seen).toEqual([msg('c1', 1), { t: 'ready' }]);
  });

  it('tells every open stream to catch up when the bus reconnects', () => {
    const h = harness();
    const a = h.collect(1);
    const b = h.collect(2);

    h.resets.next();

    expect(a.seen).toEqual([{ t: 'ready' }]);
    expect(b.seen).toEqual([{ t: 'ready' }]);
  });

  it('expires a cached member set, so a lost `mem` cannot grant access forever', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const h = harness();
      h.members.set('c1', [1, 2]);
      const removed = h.collect(2);
      h.events.next(msg('c1', 1));
      await flush();

      // Removed in the database, but its `mem` NOTIFY failed: no event, no
      // reconnect. Only the cache's own age can evict the entry.
      h.members.set('c1', [1]);
      h.events.next(msg('c1', 2));
      await flush();
      expect(removed.seen).toEqual([msg('c1', 1), msg('c1', 2)]);

      now.mockReturnValue(1_000_000 + MEMBER_CACHE_TTL_MS + 1);
      h.events.next(msg('c1', 3));
      await flush();
      expect(removed.seen).toEqual([msg('c1', 1), msg('c1', 2)]);
    } finally {
      now.mockRestore();
    }
  });

  it('does not cache or deliver a member set loaded across a reconnect', async () => {
    const h = harness();
    h.members.set('c1', [1, 2]);
    const removed = h.collect(2);
    let release: () => void = () => undefined;
    h.findMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          // The query saw [1, 2]; it answers only after the reset below.
          release = () => resolve([{ userId: 1 }, { userId: 2 }]);
        }),
    );

    h.events.next(msg('c1', 1));
    await flush();
    // User 2 is removed while the listener is down; that `mem` is lost.
    h.members.set('c1', [1]);
    h.resets.next();
    release();
    await flush();
    h.events.next(msg('c1', 2));
    await flush();

    expect(removed.seen).toEqual([{ t: 'ready' }]);
    expect(h.findMany).toHaveBeenCalledTimes(2);
  });

  it('keeps per-channel order across a cache load', async () => {
    const h = harness();
    h.members.set('c1', [1]);
    const a = h.collect(1);

    h.events.next(msg('c1', 1));
    h.events.next(msg('c1', 2));
    h.events.next(msg('c1', 3));
    await flush();

    expect(a.seen.map((e) => (e.t === 'msg' ? e.s : null))).toEqual([1, 2, 3]);
  });

  it('does not query membership while nobody is connected', async () => {
    const h = harness();
    h.members.set('c1', [1]);

    h.events.next(msg('c1', 1));
    await flush();

    expect(h.findMany).not.toHaveBeenCalled();
  });

  it('survives a failed membership load', async () => {
    const h = harness();
    h.members.set('c1', [1]);
    const a = h.collect(1);
    h.findMany.mockRejectedValueOnce(new Error('db down'));

    h.events.next(msg('c1', 1));
    h.events.next(msg('c1', 2));
    await flush();

    // The failed load is not cached; the next event retries it.
    expect(a.seen).toEqual([msg('c1', 2)]);
  });

  it('delivers to every open connection of the same user', async () => {
    const h = harness();
    h.members.set('c1', [1]);
    const tab1 = h.collect(1);
    const tab2 = h.collect(1);

    h.events.next(msg('c1', 1));
    await flush();

    expect(tab1.seen).toHaveLength(1);
    expect(tab2.seen).toHaveLength(1);
  });

  it('unsubscribing the last connection removes the user', () => {
    const h = harness();
    const tab1 = h.collect(1);
    const tab2 = h.collect(1);

    expect(h.hub.subscriberCount(1)).toBe(2);
    tab1.stop();
    expect(h.hub.subscriberCount(1)).toBe(1);
    tab2.stop();
    expect(h.hub.subscriberCount(1)).toBe(0);
  });
});
