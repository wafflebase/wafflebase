import { Subject } from 'rxjs';
import { PrismaService } from '../database/prisma.service';
import { ChatBus } from './chat-bus';
import { ChatHub, MEMBER_CACHE_TTL_MS } from './chat-hub';
import { ChatBusEvent, ChatHubEvent } from './chat.types';

type MsgEvent = Extract<ChatBusEvent, { t: 'msg' }>;

function msg(c: string, s: number): MsgEvent {
  return { t: 'msg', c, w: 'w1', s, r: null, a: 1, i: false };
}

/**
 * A hub wired to a hand-fed bus and an in-memory membership table, so each
 * test controls exactly which users the next cache load sees.
 */
function harness() {
  const events = new Subject<ChatBusEvent>();
  const resets = new Subject<void>();
  const members = new Map<string, number[]>();
  // Workspaces each user belongs to; a user not listed belongs to `w1`, the
  // workspace every `msg()` event is in. Workspace-wide routing (a public
  // channel) considers users 1–5.
  const workspacesOf = new Map<number, string[]>();
  type Where = {
    channelId: string;
    user?: { workspaceMembers?: { some?: { workspaceId?: string } } };
  };
  // Honours both halves of the hub's `where`, so dropping the workspace
  // clause lets a user outside the workspace through and a test fails.
  const findMany = jest.fn(({ where }: { where: Where }) => {
    const workspaceId = where.user?.workspaceMembers?.some?.workspaceId;
    return Promise.resolve(
      (members.get(where.channelId) ?? [])
        .filter(
          (userId) =>
            workspaceId === undefined ||
            (workspacesOf.get(userId) ?? ['w1']).includes(workspaceId),
        )
        .map((userId) => ({ userId })),
    );
  });
  // Channel kinds; a channel not listed is private, so routing is by
  // channel membership unless a test makes it public.
  const kinds = new Map<string, 'public' | 'private' | 'dm'>();
  const findChannel = jest.fn(({ where }: { where: { id: string } }) =>
    Promise.resolve({
      kind: kinds.get(where.id) ?? 'private',
      workspaceId: 'w1',
    }),
  );
  // Every user listed in `workspacesOf`, or any user id below 100 by default,
  // is a member of `w1`; see `workspacesOf`.
  const workspaceUsers = new Set<number>([1, 2, 3, 4, 5]);
  const findWorkspaceMembers = jest.fn(
    ({ where }: { where: { workspaceId: string } }) =>
      Promise.resolve(
        [...workspaceUsers]
          .filter((userId) =>
            (workspacesOf.get(userId) ?? ['w1']).includes(where.workspaceId),
          )
          .map((userId) => ({ userId })),
      ),
  );
  const bus = { events$: events, resets$: resets } as unknown as ChatBus;
  const prisma = {
    chatChannelMember: { findMany },
    chatChannel: { findUnique: findChannel },
    workspaceMember: { findMany: findWorkspaceMembers },
  } as unknown as PrismaService;
  const hub = new ChatHub(bus, prisma);
  hub.onModuleInit();

  function collect(userId: number) {
    const seen: ChatHubEvent[] = [];
    const sub = hub.subscribe(userId).subscribe((e) => seen.push(e));
    return { seen, stop: () => sub.unsubscribe() };
  }

  return {
    events,
    resets,
    members,
    workspacesOf,
    kinds,
    workspaceUsers,
    findMany,
    findChannel,
    findWorkspaceMembers,
    hub,
    collect,
  };
}

/** Let the hub's sequential routing drain its pending cache loads. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('ChatHub', () => {
  it("scopes channel members to the event's workspace", async () => {
    const h = harness();
    h.members.set('c1', [1, 2]);
    // User 2's channel row outlived their workspace membership.
    h.workspacesOf.set(2, ['other']);
    const a = h.collect(1);
    const removed = h.collect(2);

    h.events.next(msg('c1', 1));
    await flush();

    expect(h.findMany.mock.calls[0][0].where).toEqual({
      channelId: 'c1',
      user: { workspaceMembers: { some: { workspaceId: 'w1' } } },
    });
    expect(a.seen).toEqual([msg('c1', 1)]);
    expect(removed.seen).toEqual([]);
  });

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
  it('keeps routing after an event fails to route', async () => {
    const h = harness();
    h.members.set('c1', [1]);
    const a = h.collect(1);
    const route = jest
      .spyOn(h.hub as unknown as { route: () => Promise<void> }, 'route')
      .mockRejectedValueOnce(new Error('boom'));

    h.events.next(msg('c1', 1));
    h.events.next(msg('c1', 2));
    await flush();

    expect(route).toHaveBeenCalledTimes(2);
    expect(a.seen).toEqual([msg('c1', 2)]);
  });

  it('gives up a membership load that every reset interrupts', async () => {
    const h = harness();
    h.members.set('c1', [1]);
    const a = h.collect(1);
    h.findMany.mockImplementation(() => {
      // Every attempt straddles a reconnect.
      h.resets.next();
      return Promise.resolve([{ userId: 1 }]);
    });

    h.events.next(msg('c1', 1));
    await flush();

    expect(h.findMany).toHaveBeenCalledTimes(3);
    expect(a.seen.filter((e) => e.t === 'msg')).toEqual([]);
  });
  it('delivers a public channel event to every workspace member, joined or not', async () => {
    const h = harness();
    h.kinds.set('pub', 'public');
    h.members.set('pub', [1]);
    // User 2 previews the channel without having joined it.
    const member = h.collect(1);
    const previewer = h.collect(2);
    // User 9 belongs to another workspace only.
    h.workspaceUsers.add(9);
    h.workspacesOf.set(9, ['other']);
    const outsider = h.collect(9);

    h.events.next(msg('pub', 1));
    await flush();

    expect(member.seen).toEqual([msg('pub', 1)]);
    expect(previewer.seen).toEqual([msg('pub', 1)]);
    expect(outsider.seen).toEqual([]);
    expect(h.findWorkspaceMembers.mock.calls[0][0].where).toEqual({
      workspaceId: 'w1',
    });
  });

  it('never routes a private channel or a DM to non-members', async () => {
    const h = harness();
    h.kinds.set('priv', 'private');
    h.kinds.set('dm', 'dm');
    h.members.set('priv', [1]);
    h.members.set('dm', [1]);
    h.collect(1);
    const outsider = h.collect(2);

    h.events.next(msg('priv', 1));
    h.events.next(msg('dm', 1));
    h.events.next({ t: 'chn', c: 'priv', w: 'w1' });
    await flush();

    expect(outsider.seen).toEqual([]);
    expect(h.findWorkspaceMembers).not.toHaveBeenCalled();
  });

  it('routes a channel metadata event like a message', async () => {
    const h = harness();
    h.kinds.set('pub', 'public');
    h.members.set('priv', [1]);
    const a = h.collect(1);
    const b = h.collect(2);

    h.events.next({ t: 'chn', c: 'pub', w: 'w1' });
    h.events.next({ t: 'chn', c: 'priv', w: 'w1' });
    await flush();

    expect(a.seen).toEqual([
      { t: 'chn', c: 'pub', w: 'w1' },
      { t: 'chn', c: 'priv', w: 'w1' },
    ]);
    expect(b.seen).toEqual([{ t: 'chn', c: 'pub', w: 'w1' }]);
  });

  it("uses the channel's own workspace, not the one an event names", async () => {
    const h = harness();
    h.kinds.set('pub', 'public');
    h.workspaceUsers.add(9);
    h.workspacesOf.set(9, ['other']);
    const outsider = h.collect(9);

    h.events.next({ ...msg('pub', 1), w: 'other' });
    await flush();

    expect(outsider.seen).toEqual([]);
  });

  it('caches workspace readers until any membership changes', async () => {
    const h = harness();
    h.kinds.set('pub', 'public');
    const removed = h.collect(2);

    h.events.next(msg('pub', 1));
    h.events.next(msg('pub', 2));
    await flush();
    expect(h.findWorkspaceMembers).toHaveBeenCalledTimes(1);
    expect(h.findChannel).toHaveBeenCalledTimes(1);

    // Removing someone from the workspace announces `mem` for their
    // channels (#general at least), which is not this channel.
    h.workspacesOf.set(2, ['other']);
    h.events.next({ t: 'mem', c: 'general' });
    h.events.next(msg('pub', 3));
    await flush();

    expect(h.findWorkspaceMembers).toHaveBeenCalledTimes(2);
    expect(removed.seen).toEqual([msg('pub', 1), msg('pub', 2)]);
  });

  it('expires cached workspace readers', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const h = harness();
      h.kinds.set('pub', 'public');
      const removed = h.collect(2);
      h.events.next(msg('pub', 1));
      await flush();

      h.workspacesOf.set(2, ['other']);
      now.mockReturnValue(1_000_000 + MEMBER_CACHE_TTL_MS + 1);
      h.events.next(msg('pub', 2));
      await flush();

      expect(removed.seen).toEqual([msg('pub', 1)]);
    } finally {
      now.mockRestore();
    }
  });

  it('drops an event for a channel that no longer exists', async () => {
    const h = harness();
    const a = h.collect(1);
    h.findChannel.mockResolvedValueOnce(null as never);

    h.events.next(msg('gone', 1));
    await flush();

    expect(a.seen).toEqual([]);
    expect(h.findMany).not.toHaveBeenCalled();
  });
});
