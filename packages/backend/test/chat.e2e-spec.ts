import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { Client } from 'pg';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';
import { ChatBus } from 'src/chat/chat-bus';
import { ChatChannelService } from 'src/chat/chat-channel.service';
import { ChatMessageService } from 'src/chat/chat-message.service';
import { PrismaService } from 'src/database/prisma.service';
import { YorkieAdminService } from 'src/yorkie/yorkie-admin.service';
import { YorkieService } from 'src/yorkie/yorkie.service';
import {
  applyGlobalBootstrap,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  describeDb,
  setAuthEnvDefaults,
  setIntegrationEnvDefaults,
} from './helpers/integration-helpers';

type TestUser = {
  id: number;
  username: string;
  email: string;
  photo: string | null;
};

/**
 * Workspace chat against a real database. The schema cases prove the
 * cascades the design depends on: a workspace takes its whole chat with it,
 * while a deleted user's messages stay, attributed to nobody. The rest drive
 * the routes, and the services directly where a case needs more requests
 * than the post throttle allows (it is per IP as well as per user here).
 */
describeDb('Chat integration', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let channels: ChatChannelService;
  let messages: ChatMessageService;
  let bus: ChatBus;
  let createUser: ReturnType<typeof createUserFactory>;

  function authCookie(user: TestUser) {
    const token = jwtService.sign(
      {
        tokenType: 'access',
        sub: user.id,
        username: user.username,
        email: user.email,
        photo: user.photo,
      },
      { secret: process.env.JWT_SECRET!, expiresIn: '1h' },
    );
    return `wafflebase_session=${token}`;
  }

  /** A supertest wrapper that sends every request as `user`. */
  function as(user: TestUser) {
    const server = app.getHttpServer();
    const cookie = authCookie(user);
    return {
      get: (url: string) => request(server).get(url).set('Cookie', cookie),
      post: (url: string) => request(server).post(url).set('Cookie', cookie),
      patch: (url: string) => request(server).patch(url).set('Cookie', cookie),
      delete: (url: string) =>
        request(server).delete(url).set('Cookie', cookie),
    };
  }

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YorkieService)
      .useValue({
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => Promise.resolve(),
        withDocument: () => Promise.resolve(null),
      })
      .overrideProvider(YorkieAdminService)
      .useValue({
        getEditors: async () => new Map(),
        getSummaries: async () => new Map(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    applyGlobalBootstrap(app);
    await app.init();

    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);
    channels = moduleRef.get(ChatChannelService);
    messages = moduleRef.get(ChatMessageService);
    bus = moduleRef.get(ChatBus);
    createUser = createUserFactory(prisma, 'chat');
    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await clearDatabase(prisma);
    await app.close();
    await moduleRef.close();
  });

  /** An owner and `extra` members in one fresh workspace. */
  async function team(extra = 1) {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const members: TestUser[] = [];
    for (let i = 0; i < extra; i += 1) {
      const user = await createUser();
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: 'member' },
      });
      members.push(user);
    }
    return { owner, members, workspace };
  }

  const base = (workspaceId: string) => `/workspaces/${workspaceId}/chat`;

  /** A public channel with one member and one message by `author`. */
  async function channelWithMessage(workspaceId: string, authorId: number) {
    const channel = await prisma.chatChannel.create({
      data: {
        workspaceId,
        kind: 'public',
        name: 'general',
        createdBy: authorId,
        lastSeq: 1,
        members: { create: { userId: authorId } },
      },
    });
    const message = await prisma.chatMessage.create({
      data: { channelId: channel.id, seq: 1, authorId, body: 'hello' },
    });
    return { channel, message };
  }

  describe('schema', () => {
    it('cascades: deleting a workspace removes its channels, members and messages', async () => {
      const owner = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const { channel } = await channelWithMessage(workspace.id, owner.id);

      await prisma.workspace.delete({ where: { id: workspace.id } });

      expect(
        await prisma.chatChannel.count({ where: { id: channel.id } }),
      ).toBe(0);
      expect(
        await prisma.chatChannelMember.count({
          where: { channelId: channel.id },
        }),
      ).toBe(0);
      expect(
        await prisma.chatMessage.count({ where: { channelId: channel.id } }),
      ).toBe(0);
    });

    it('deleting a user keeps their messages with authorId null', async () => {
      const owner = await createUser();
      const author = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: author.id, role: 'member' },
      });
      const { channel, message } = await channelWithMessage(
        workspace.id,
        author.id,
      );

      await prisma.workspaceMember.deleteMany({ where: { userId: author.id } });
      await prisma.user.delete({ where: { id: author.id } });

      const kept = await prisma.chatMessage.findUnique({
        where: { id: message.id },
      });
      expect(kept).not.toBeNull();
      expect(kept!.authorId).toBeNull();
      expect(kept!.body).toBe('hello');
      // The membership goes with the user; the channel stays.
      expect(
        await prisma.chatChannelMember.count({
          where: { channelId: channel.id },
        }),
      ).toBe(0);
      expect(
        await prisma.chatChannel.count({ where: { id: channel.id } }),
      ).toBe(1);
    });
  });

  describe('channels', () => {
    it('lists public channels to every member and private ones only to members', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;

      await as(owner)
        .post(`${base(workspace.id)}/channels`)
        .send({ kind: 'public', name: 'General' })
        .expect(201);
      const secret = await as(owner)
        .post(`${base(workspace.id)}/channels`)
        .send({ kind: 'private', name: 'Leadership Team', topic: 'q4' })
        .expect(201);
      expect(secret.body).toMatchObject({
        kind: 'private',
        name: 'leadership-team',
        topic: 'q4',
        isMember: true,
      });

      const mine = await as(owner)
        .get(`${base(workspace.id)}/channels`)
        .expect(200);
      expect(mine.body.map((c: { name: string }) => c.name).sort()).toEqual([
        'general',
        'leadership-team',
      ]);

      const theirs = await as(peer)
        .get(`${base(workspace.id)}/channels`)
        .expect(200);
      expect(theirs.body).toHaveLength(1);
      expect(theirs.body[0]).toMatchObject({
        name: 'general',
        isMember: false,
        unreadCount: 0,
      });

      // Invited, the private channel appears for them too.
      await as(owner)
        .post(`${base(workspace.id)}/channels/${secret.body.id}/members`)
        .send({ userIds: [peer.id] })
        .expect(201);
      const after = await as(peer)
        .get(`${base(workspace.id)}/channels`)
        .expect(200);
      expect(after.body).toHaveLength(2);
    });

    it('non-member of the workspace gets 404', async () => {
      const { owner, workspace } = await team(0);
      const outsider = await createUser();
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });

      await as(outsider)
        .get(`${base(workspace.id)}/channels`)
        .expect(404);
      await as(outsider)
        .post(`${base(workspace.id)}/channels`)
        .send({ kind: 'public', name: 'mine' })
        .expect(404);
      await as(outsider)
        .get(`${base(workspace.id)}/channels/${channel.id}/messages`)
        .expect(404);
      await as(outsider)
        .post(`${base(workspace.id)}/channels/${channel.id}/members`)
        .send({})
        .expect(404);
    });

    it('a channel from another workspace is 404 under this one', async () => {
      const { owner, workspace } = await team(0);
      const other = await createWorkspace(prisma, owner.id, 'other');
      const channel = await channels.create(owner.id, other.id, {
        kind: 'public',
        name: 'general',
      });

      await as(owner)
        .get(`${base(workspace.id)}/channels/${channel.id}/messages`)
        .expect(404);
    });

    it('a private channel the caller is not in is 404', async () => {
      const { owner, members, workspace } = await team(1);
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'private',
        name: 'secret',
      });

      await as(members[0])
        .get(`${base(workspace.id)}/channels/${channel.id}/messages`)
        .expect(404);
      await as(members[0])
        .post(`${base(workspace.id)}/channels/${channel.id}/members`)
        .send({})
        .expect(404);
    });

    it('duplicate channel name is 409', async () => {
      const { owner, workspace } = await team(0);
      await as(owner)
        .post(`${base(workspace.id)}/channels`)
        .send({ kind: 'public', name: 'Q4 Planning' })
        .expect(201);
      // Normalization makes these the same name.
      await as(owner)
        .post(`${base(workspace.id)}/channels`)
        .send({ kind: 'private', name: '  q4 planning ' })
        .expect(409);
    });

    it('an invalid channel name is 400', async () => {
      const { owner, workspace } = await team(0);
      await as(owner)
        .post(`${base(workspace.id)}/channels`)
        .send({ kind: 'public', name: '-leading-dash' })
        .expect(400);
      await as(owner)
        .post(`${base(workspace.id)}/channels`)
        .send({ kind: 'public', name: 'a'.repeat(81) })
        .expect(400);
    });

    it('openDm rejects 1 or 9 people and non-members', async () => {
      const { owner, members, workspace } = await team(8);
      const outsider = await createUser();
      const url = `${base(workspace.id)}/channels`;

      // Just the caller.
      await as(owner).post(url).send({ kind: 'dm', userIds: [] }).expect(400);
      await as(owner)
        .post(url)
        .send({ kind: 'dm', userIds: [owner.id] })
        .expect(400);
      // Caller plus eight.
      await as(owner)
        .post(url)
        .send({ kind: 'dm', userIds: members.map((m) => m.id) })
        .expect(400);
      await as(owner)
        .post(url)
        .send({ kind: 'dm', userIds: [outsider.id] })
        .expect(400);

      // Caller plus seven is the largest allowed.
      const ok = await as(owner)
        .post(url)
        .send({ kind: 'dm', userIds: members.slice(0, 7).map((m) => m.id) })
        .expect(201);
      expect(ok.body).toMatchObject({ kind: 'dm', name: null, isMember: true });
      expect(ok.body.members).toHaveLength(8);
    });

    it('concurrent openDm calls return the same channel', async () => {
      const { owner, members, workspace } = await team(2);
      const [a, b] = members;

      // Different callers, different orders, the same set.
      const results = await Promise.all([
        channels.openDm(owner.id, workspace.id, [a.id, b.id]),
        channels.openDm(a.id, workspace.id, [owner.id, b.id]),
        channels.openDm(b.id, workspace.id, [a.id, owner.id]),
        channels.openDm(owner.id, workspace.id, [b.id, a.id, a.id]),
        channels.openDm(a.id, workspace.id, [b.id, owner.id]),
      ]);

      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(
        await prisma.chatChannel.count({
          where: { workspaceId: workspace.id, kind: 'dm' },
        }),
      ).toBe(1);
      expect(
        await prisma.chatChannelMember.count({
          where: { channelId: results[0].id },
        }),
      ).toBe(3);
    });

    it('reopening a DM restores a member whose row was removed', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;
      const dm = await channels.openDm(owner.id, workspace.id, [peer.id]);
      await messages.post(owner.id, dm.id, { body: 'before you left' });
      // What `WorkspaceService.removeMember` leaves behind; the person is
      // then invited back, so only their chat row is missing.
      await prisma.chatChannelMember.deleteMany({
        where: { channelId: dm.id, userId: peer.id },
      });
      const notify = jest.spyOn(bus, 'notifyMembership');

      const reopened = await channels.openDm(peer.id, workspace.id, [owner.id]);

      expect(reopened).toMatchObject({ id: dm.id, isMember: true });
      expect(reopened.members).toHaveLength(2);
      expect(notify).toHaveBeenCalledWith(dm.id);
      // Reopening is not a new arrival: the history reads as unread, since
      // it was addressed to them.
      expect(reopened.unreadCount).toBe(1);

      // The other side reopening it repairs it the same way.
      await prisma.chatChannelMember.deleteMany({
        where: { channelId: dm.id, userId: peer.id },
      });
      await channels.openDm(owner.id, workspace.id, [peer.id]);
      const [seen] = await channels.list(peer.id, workspace.id);
      expect(seen).toMatchObject({ id: dm.id, isMember: true });
    });

    it('joining or being invited starts the read position at the tail', async () => {
      const { owner, members, workspace } = await team(2);
      const [joiner, invitee] = members;
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });
      for (const user of [joiner, invitee]) {
        await messages.post(owner.id, channel.id, {
          body: `old @[${user.username}](${user.id})`,
        });
      }

      const joined = await channels.join(joiner.id, channel.id);
      expect(joined).toMatchObject({ unreadCount: 0, mentionCount: 0 });

      await channels.invite(owner.id, channel.id, [invitee.id]);
      const [invited] = await channels.list(invitee.id, workspace.id);
      expect(invited).toMatchObject({ unreadCount: 0, mentionCount: 0 });

      // Whatever arrives afterwards counts as usual.
      await messages.post(owner.id, channel.id, { body: 'new' });
      const [later] = await channels.list(joiner.id, workspace.id);
      expect(later.unreadCount).toBe(1);
    });

    it('join, leave and membership notifications', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;
      const notify = jest.spyOn(bus, 'notifyMembership');
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });

      await as(peer)
        .post(`${base(workspace.id)}/channels/${channel.id}/members`)
        .send({})
        .expect(201);
      expect(
        await prisma.chatChannelMember.count({
          where: { channelId: channel.id, userId: peer.id },
        }),
      ).toBe(1);

      await as(peer)
        .delete(`${base(workspace.id)}/channels/${channel.id}/members/me`)
        .expect(204);
      expect(
        await prisma.chatChannelMember.count({
          where: { channelId: channel.id, userId: peer.id },
        }),
      ).toBe(0);

      // create, join, leave.
      expect(notify).toHaveBeenCalledTimes(3);
      expect(notify).toHaveBeenCalledWith(channel.id);
    });

    it('a DM cannot be left, joined or renamed', async () => {
      const { owner, members, workspace } = await team(1);
      const dm = await channels.openDm(owner.id, workspace.id, [members[0].id]);

      await as(owner)
        .post(`${base(workspace.id)}/channels/${dm.id}/members`)
        .send({})
        .expect(400);
      await as(owner)
        .delete(`${base(workspace.id)}/channels/${dm.id}/members/me`)
        .expect(400);
      await as(owner)
        .patch(`${base(workspace.id)}/channels/${dm.id}`)
        .send({ name: 'renamed' })
        .expect(400);
    });

    it('only the creator or a workspace owner manages a channel', async () => {
      const { owner, members, workspace } = await team(2);
      const [creator, other] = members;
      const channel = await channels.create(creator.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });
      const url = `${base(workspace.id)}/channels/${channel.id}`;

      await as(other).patch(url).send({ topic: 'nope' }).expect(403);
      const renamed = await as(creator)
        .patch(url)
        .send({ name: 'Town Hall', topic: 'all hands' })
        .expect(200);
      expect(renamed.body).toMatchObject({
        name: 'town-hall',
        topic: 'all hands',
      });
      const archived = await as(owner)
        .patch(url)
        .send({ archived: true })
        .expect(200);
      expect(archived.body.archived).toBe(true);
    });

    it('removing a workspace member drops their channel memberships', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;
      const other = await createWorkspace(prisma, peer.id, 'other');
      const here = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });
      await channels.join(peer.id, here.id);
      const dm = await channels.openDm(owner.id, workspace.id, [peer.id]);
      const elsewhere = await channels.create(peer.id, other.id, {
        kind: 'public',
        name: 'general',
      });

      const listener = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await listener.connect();
      const notified: string[] = [];
      listener.on('notification', (n) => {
        if (n.channel === 'chat' && n.payload) notified.push(n.payload);
      });
      await listener.query('LISTEN chat');
      try {
        await as(owner)
          .delete(`/workspaces/${workspace.id}/members/${peer.id}`)
          .expect(200);

        expect(
          await prisma.chatChannelMember.count({
            where: { userId: peer.id, channel: { workspaceId: workspace.id } },
          }),
        ).toBe(0);
        // Their membership in another workspace's channel is untouched.
        expect(
          await prisma.chatChannelMember.count({
            where: { userId: peer.id, channelId: elsewhere.id },
          }),
        ).toBe(1);

        // Every affected channel is announced so cached member sets drop them.
        const deadline = Date.now() + 2_000;
        while (notified.length < 2 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(
          notified
            .map((p) => JSON.parse(p))
            .sort((x, y) => (x.c < y.c ? -1 : 1)),
        ).toEqual(
          [
            { t: 'mem', c: here.id },
            { t: 'mem', c: dm.id },
          ].sort((x, y) => (x.c < y.c ? -1 : 1)),
        );
      } finally {
        await listener.end();
      }
    });

    it('list counts unread top-level messages and mentions', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });
      await channels.join(peer.id, channel.id);

      const root = await messages.post(owner.id, channel.id, { body: 'one' });
      await messages.post(owner.id, channel.id, {
        body: `hey @[${peer.username}](${peer.id})`,
      });
      // A reply stays out of the count; an also-in-channel one does not.
      await messages.post(owner.id, channel.id, {
        body: 'in thread',
        threadRootId: root.id,
      });
      await messages.post(owner.id, channel.id, {
        body: 'broadcast',
        threadRootId: root.id,
        alsoInChannel: true,
      });
      // Own messages never count.
      await messages.post(peer.id, channel.id, { body: 'mine' });

      const [summary] = await channels.list(peer.id, workspace.id);
      // Posting moved peer's read position to their own message.
      expect(summary).toMatchObject({ unreadCount: 0, mentionCount: 0 });

      await messages.post(owner.id, channel.id, {
        body: `again @[${peer.username}](${peer.id})`,
      });
      const last = await messages.post(owner.id, channel.id, { body: 'two' });
      const [later] = await channels.list(peer.id, workspace.id);
      expect(later).toMatchObject({
        unreadCount: 2,
        mentionCount: 1,
        isMember: true,
      });
      // Stamped by the database in UTC, so it agrees with the message's own
      // timestamp whatever the server's time zone.
      expect(
        Math.abs(Date.parse(later.lastMessageAt!) - Date.parse(last.createdAt)),
      ).toBeLessThan(5_000);

      await prisma.chatChannelMember.update({
        where: { channelId_userId: { channelId: channel.id, userId: peer.id } },
        data: { lastReadSeq: 0 },
      });
      const fresh = await channels.list(peer.id, workspace.id);
      expect(fresh[0]).toMatchObject({ unreadCount: 5, mentionCount: 2 });
    });
  });

  describe('messages', () => {
    async function publicChannel() {
      const t = await team(1);
      const channel = await channels.create(t.owner.id, t.workspace.id, {
        kind: 'public',
        name: 'general',
      });
      return { ...t, channel };
    }

    /** Writes `n` top-level messages straight to the table, seqs 1..n. */
    async function seed(channelId: string, authorId: number, n: number) {
      await prisma.chatMessage.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          channelId,
          seq: i + 1,
          authorId,
          body: `m${i + 1}`,
        })),
      });
      await prisma.chatChannel.update({
        where: { id: channelId },
        data: { lastSeq: n },
      });
    }

    it('20 parallel posts get seqs 1..20 with no gaps', async () => {
      const { owner, members, channel } = await publicChannel();
      await channels.join(members[0].id, channel.id);

      const posted = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          messages.post(i % 2 ? owner.id : members[0].id, channel.id, {
            body: `n${i}`,
          }),
        ),
      );

      expect(posted.map((m) => m.seq).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      const row = await prisma.chatChannel.findUniqueOrThrow({
        where: { id: channel.id },
      });
      expect(Number(row.lastSeq)).toBe(20);
    });

    it('page before/after returns 50 in ascending order', async () => {
      const { owner, workspace, channel } = await publicChannel();
      await seed(channel.id, owner.id, 120);
      const url = `${base(workspace.id)}/channels/${channel.id}/messages`;

      const latest = await as(owner).get(url).expect(200);
      expect(latest.body.map((m: { seq: number }) => m.seq)).toEqual(
        Array.from({ length: 50 }, (_, i) => 71 + i),
      );
      expect(typeof latest.body[0].seq).toBe('number');

      const older = await as(owner).get(`${url}?before=71`).expect(200);
      expect(older.body.map((m: { seq: number }) => m.seq)).toEqual(
        Array.from({ length: 50 }, (_, i) => 21 + i),
      );

      const newer = await as(owner).get(`${url}?after=10`).expect(200);
      expect(newer.body.map((m: { seq: number }) => m.seq)).toEqual(
        Array.from({ length: 50 }, (_, i) => 11 + i),
      );

      await as(owner).get(`${url}?after=abc`).expect(400);
    });

    it('thread replies stay out of the channel page unless alsoInChannel', async () => {
      const { owner, workspace, channel } = await publicChannel();
      const root = await messages.post(owner.id, channel.id, { body: 'root' });
      await messages.post(owner.id, channel.id, {
        body: 'quiet',
        threadRootId: root.id,
      });
      await messages.post(owner.id, channel.id, {
        body: 'loud',
        threadRootId: root.id,
        alsoInChannel: true,
      });
      const url = `${base(workspace.id)}/channels/${channel.id}/messages`;

      const top = await as(owner).get(url).expect(200);
      expect(top.body.map((m: { body: string }) => m.body)).toEqual([
        'root',
        'loud',
      ]);

      const thread = await as(owner)
        .get(`${url}?thread=${root.id}`)
        .expect(200);
      expect(thread.body.map((m: { body: string }) => m.body)).toEqual([
        'root',
        'quiet',
        'loud',
      ]);
    });

    it('reply bumps root replyCount', async () => {
      const { owner, workspace, channel } = await publicChannel();
      const root = await messages.post(owner.id, channel.id, { body: 'root' });

      await as(owner)
        .post(`${base(workspace.id)}/channels/${channel.id}/messages`)
        .send({ body: 'first', threadRootId: root.id })
        .expect(201);
      await messages.post(owner.id, channel.id, {
        body: 'second',
        threadRootId: root.id,
      });

      const [top] = await messages.page(owner.id, channel.id, {});
      expect(top).toMatchObject({ id: root.id, replyCount: 2 });
      expect(top.lastReplyAt).not.toBeNull();
    });

    it('a reply to a reply or to another channel is 400', async () => {
      const { owner, workspace, channel } = await publicChannel();
      const other = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'other',
      });
      const root = await messages.post(owner.id, channel.id, { body: 'root' });
      const reply = await messages.post(owner.id, channel.id, {
        body: 'reply',
        threadRootId: root.id,
      });
      const url = `${base(workspace.id)}/channels`;

      await as(owner)
        .post(`${url}/${channel.id}/messages`)
        .send({ body: 'nested', threadRootId: reply.id })
        .expect(400);
      await as(owner)
        .post(`${url}/${other.id}/messages`)
        .send({ body: 'cross', threadRootId: root.id })
        .expect(400);
    });

    it('body over 4000 chars or blank is 400', async () => {
      const { owner, workspace, channel } = await publicChannel();
      const url = `${base(workspace.id)}/channels/${channel.id}/messages`;

      await as(owner)
        .post(url)
        .send({ body: 'x'.repeat(4001) })
        .expect(400);
      await as(owner).post(url).send({ body: '   \n ' }).expect(400);
      await as(owner).post(url).send({}).expect(400);
      const ok = await as(owner)
        .post(url)
        .send({ body: '  hi there \n' })
        .expect(201);
      expect(ok.body).toMatchObject({
        body: 'hi there',
        seq: 1,
        author: { id: owner.id, username: owner.username },
        deleted: false,
      });
    });

    it('a single message is readable only to those who can read its channel', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;
      const secret = await channels.create(owner.id, workspace.id, {
        kind: 'private',
        name: 'secret',
      });
      const root = await messages.post(owner.id, secret.id, { body: 'root' });
      const reply = await messages.post(owner.id, secret.id, {
        body: 'reply',
        threadRootId: root.id,
      });
      const url = `${base(workspace.id)}/messages/${reply.id}`;

      const res = await as(owner).get(url).expect(200);
      expect(res.body).toMatchObject({ id: reply.id, threadRootId: root.id });
      await as(peer).get(url).expect(404);
      await as(owner)
        .get(`${base(workspace.id)}/messages/nope`)
        .expect(404);
    });

    it("editing someone else's message is 404", async () => {
      const { owner, members, workspace, channel } = await publicChannel();
      const [peer] = members;
      const mine = await messages.post(owner.id, channel.id, { body: 'mine' });
      const url = `${base(workspace.id)}/messages/${mine.id}`;

      await as(peer).patch(url).send({ body: 'hijack' }).expect(404);
      await as(peer).delete(url).expect(404);

      const edited = await as(owner)
        .patch(url)
        .send({ body: 'mine, edited' })
        .expect(200);
      expect(edited.body.body).toBe('mine, edited');
      expect(edited.body.editedAt).not.toBeNull();
    });

    it('deleting a root keeps the thread and blanks the body', async () => {
      const { owner, members, workspace, channel } = await publicChannel();
      const root = await messages.post(owner.id, channel.id, { body: 'root' });
      await messages.post(members[0].id, channel.id, {
        body: 'reply',
        threadRootId: root.id,
      });

      await as(owner)
        .delete(`${base(workspace.id)}/messages/${root.id}`)
        .expect(204);

      const top = await messages.page(owner.id, channel.id, {});
      expect(top).toHaveLength(1);
      expect(top[0]).toMatchObject({
        id: root.id,
        deleted: true,
        body: '',
        replyCount: 1,
      });

      const thread = await messages.page(owner.id, channel.id, {
        thread: root.id,
      });
      expect(thread.map((m) => [m.body, m.deleted])).toEqual([
        ['', true],
        ['reply', false],
      ]);

      // A deleted message cannot be edited back to life.
      await as(owner)
        .patch(`${base(workspace.id)}/messages/${root.id}`)
        .send({ body: 'revived' })
        .expect(404);
    });

    it('archived channel refuses posts but serves reads', async () => {
      const { owner, workspace, channel } = await publicChannel();
      await messages.post(owner.id, channel.id, { body: 'before' });
      await channels.update(owner.id, channel.id, { archived: true });
      const url = `${base(workspace.id)}/channels/${channel.id}/messages`;

      await as(owner).post(url).send({ body: 'after' }).expect(409);
      const read = await as(owner).get(url).expect(200);
      expect(read.body.map((m: { body: string }) => m.body)).toEqual([
        'before',
      ]);
    });

    it('markRead never moves backwards', async () => {
      const { owner, members, workspace, channel } = await publicChannel();
      const [peer] = members;
      await channels.join(peer.id, channel.id);
      await seed(channel.id, owner.id, 10);
      const url = `${base(workspace.id)}/channels/${channel.id}/read`;
      const lastRead = async () =>
        Number(
          (
            await prisma.chatChannelMember.findUniqueOrThrow({
              where: {
                channelId_userId: { channelId: channel.id, userId: peer.id },
              },
            })
          ).lastReadSeq,
        );

      await as(peer).post(url).send({ seq: 7 }).expect(204);
      expect(await lastRead()).toBe(7);
      await as(peer).post(url).send({ seq: 3 }).expect(204);
      expect(await lastRead()).toBe(7);
      // Never past the last allocated seq either.
      await as(peer).post(url).send({ seq: 999 }).expect(204);
      expect(await lastRead()).toBe(10);
      await as(peer).post(url).send({ seq: -1 }).expect(400);
    });

    it('posting in a public channel joins it', async () => {
      const { members, workspace, channel } = await publicChannel();
      const [peer] = members;
      const membership = jest.spyOn(bus, 'notifyMembership');
      const message = jest.spyOn(bus, 'notifyMessage');

      const res = await as(peer)
        .post(`${base(workspace.id)}/channels/${channel.id}/messages`)
        .send({ body: 'hello' })
        .expect(201);

      const row = await prisma.chatChannelMember.findUniqueOrThrow({
        where: { channelId_userId: { channelId: channel.id, userId: peer.id } },
      });
      expect(Number(row.lastReadSeq)).toBe(res.body.seq);
      expect(membership).toHaveBeenCalledWith(channel.id);
      expect(message).toHaveBeenCalledWith({
        t: 'msg',
        c: channel.id,
        w: workspace.id,
        s: res.body.seq,
        r: null,
        a: peer.id,
      });

      const [summary] = await channels.list(peer.id, workspace.id);
      expect(summary.isMember).toBe(true);
    });
  });
  describe('notifications', () => {
    const mention = (u: TestUser) => `@[${u.username}](${u.id})`;
    const rowsFor = (recipientId: number, type: string) =>
      prisma.notification.findMany({ where: { recipientId, type } });

    it('a mention notifies channel members and public non-members', async () => {
      const { owner, members, workspace } = await team(2);
      const [peer, outsider] = members;
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });
      await channels.join(peer.id, channel.id);

      const posted = await messages.post(owner.id, channel.id, {
        body: `hi ${mention(peer)} ${mention(outsider)} ${mention(owner)}`,
      });

      const [row] = await rowsFor(peer.id, 'chat_mention');
      expect(row).toMatchObject({
        threadId: channel.id,
        commentId: posted.id,
        dedupeKey: posted.id,
        documentId: null,
      });
      // A public non-member is notified too: the preview is their way in.
      expect(await rowsFor(outsider.id, 'chat_mention')).toHaveLength(1);
      // Mentioning yourself is not news.
      expect(await rowsFor(owner.id, 'chat_mention')).toHaveLength(0);
    });

    it('a mention never reaches someone who cannot read the channel', async () => {
      const { owner, members, workspace } = await team(1);
      const [outsider] = members;
      const stranger = await createUser();
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'private',
        name: 'secret',
      });

      await messages.post(owner.id, channel.id, {
        body: `${mention(outsider)} ${mention(stranger)}`,
      });

      expect(await rowsFor(outsider.id, 'chat_mention')).toHaveLength(0);
      expect(await rowsFor(stranger.id, 'chat_mention')).toHaveLength(0);
    });

    it('a group-DM mention notifies; a DM without one does not', async () => {
      const { owner, members, workspace } = await team(2);
      const [a, b] = members;
      const group = await channels.openDm(owner.id, workspace.id, [a.id, b.id]);
      const dm = await channels.openDm(owner.id, workspace.id, [a.id]);

      await messages.post(owner.id, group.id, { body: `ping ${mention(a)}` });
      await messages.post(owner.id, dm.id, { body: 'no mention here' });

      expect(await rowsFor(a.id, 'chat_mention')).toHaveLength(1);
      expect(await rowsFor(b.id, 'chat_mention')).toHaveLength(0);
    });

    it('thread replies notify participants once per hour', async () => {
      const { owner, members, workspace } = await team(2);
      const [peer, third] = members;
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });
      const root = await messages.post(owner.id, channel.id, { body: 'root' });
      await messages.post(peer.id, channel.id, {
        body: 'first',
        threadRootId: root.id,
      });
      await messages.post(peer.id, channel.id, {
        body: 'second',
        threadRootId: root.id,
      });
      // Mentioned in a reply: one chat_mention, not also a thread-reply row.
      await messages.post(third.id, channel.id, {
        body: `${mention(owner)} look`,
        threadRootId: root.id,
      });

      expect(await rowsFor(owner.id, 'chat_thread_reply')).toHaveLength(1);
      expect(await rowsFor(owner.id, 'chat_mention')).toHaveLength(1);
      expect(await rowsFor(peer.id, 'chat_thread_reply')).toHaveLength(1);
      expect(await rowsFor(third.id, 'chat_thread_reply')).toHaveLength(0);
    });

    it('a failed notification does not fail the post', async () => {
      const { owner, members, workspace } = await team(1);
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });
      jest
        .spyOn(prisma.workspaceMember, 'findMany')
        .mockRejectedValueOnce(new Error('boom'));

      const posted = await messages.post(owner.id, channel.id, {
        body: `hi ${mention(members[0])}`,
      });
      expect(posted.seq).toBe(1);
    });
  });
});
