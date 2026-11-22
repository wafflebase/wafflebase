import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { Client } from 'pg';
import * as request from 'supertest';
import { extractMentionedUserIds, parseMentionBody } from '@wafflebase/sheets';
import { AppModule } from 'src/app.module';
import { ChatBus } from 'src/chat/chat-bus';
import { ChatChannelService } from 'src/chat/chat-channel.service';
import { ChatMessageService } from 'src/chat/chat-message.service';
import { createDefaultChannel } from 'src/chat/default-channel';
import { PrismaService } from 'src/database/prisma.service';
import { WorkspaceService } from 'src/workspace/workspace.service';
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
  let workspaces: WorkspaceService;
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
    workspaces = moduleRef.get(WorkspaceService);
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
        .send({ kind: 'public', name: 'Water Cooler' })
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
      // `general` is the default channel, repaired into this workspace
      // (made by a helper, not `WorkspaceService.create`) on first read.
      expect(mine.body.map((c: { name: string }) => c.name).sort()).toEqual([
        'general',
        'leadership-team',
        'water-cooler',
      ]);

      const theirs = await as(peer)
        .get(`${base(workspace.id)}/channels`)
        .expect(200);
      expect(theirs.body.map((c: { name: string }) => c.name).sort()).toEqual([
        'general',
        'water-cooler',
      ]);
      expect(
        theirs.body.find((c: { name: string }) => c.name === 'water-cooler'),
      ).toMatchObject({ isMember: false, unreadCount: 0 });

      // Invited, the private channel appears for them too.
      await as(owner)
        .post(`${base(workspace.id)}/channels/${secret.body.id}/members`)
        .send({ userIds: [peer.id] })
        .expect(201);
      const after = await as(peer)
        .get(`${base(workspace.id)}/channels`)
        .expect(200);
      expect(after.body).toHaveLength(3);
    });

    it('summaries say who may manage each channel', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;
      const ownersPublic = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'announcements',
      });
      const peersPublic = await channels.create(peer.id, workspace.id, {
        kind: 'public',
        name: 'random',
      });
      const priv = await channels.create(owner.id, workspace.id, {
        kind: 'private',
        name: 'leads',
      });
      await channels.invite(owner.id, priv.id, [peer.id]);
      const dm = await channels.openDm(owner.id, workspace.id, [peer.id]);

      const manage = async (userId: number) => {
        const res = await as(userId === owner.id ? owner : peer)
          .get(`${base(workspace.id)}/channels`)
          .expect(200);
        return Object.fromEntries(
          (res.body as { id: string; canManage: boolean }[]).map((c) => [
            c.id,
            c.canManage,
          ]),
        );
      };
      // Public: its creator or a workspace owner. Private: any member.
      // DM: nobody. (The repaired #general is also listed; not asserted.)
      expect(await manage(owner.id)).toMatchObject({
        [ownersPublic.id]: true,
        [peersPublic.id]: true,
        [priv.id]: true,
        [dm.id]: false,
      });
      expect(await manage(peer.id)).toMatchObject({
        [ownersPublic.id]: false,
        [peersPublic.id]: true,
        [priv.id]: true,
        [dm.id]: false,
      });
      // The flag is the policy `update` enforces.
      await as(peer)
        .patch(`${base(workspace.id)}/channels/${ownersPublic.id}`)
        .send({ topic: 'nope' })
        .expect(403);
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
      const taken = await as(owner)
        .post(`${base(workspace.id)}/channels`)
        .send({ kind: 'private', name: '  q4 planning ' })
        .expect(409);
      // Names are reserved across kinds; the refusal does not echo the name.
      expect(taken.body.message).toBe('That channel name is taken');
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
      const { owner, members, workspace } = await team(3);
      const [joiner, invitee, stranger] = members;
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
      expect(joined).toMatchObject({
        unreadCount: 0,
        mentionCount: 0,
        lastSeq: 2,
        lastReadSeq: 2,
      });
      // Somebody outside a public channel has no read position. (`summaryOf`,
      // not `list`, which would adopt this "general" as the default channel.)
      const outside = await channels.summaryOf(stranger.id, channel.id);
      expect(outside).toMatchObject({ isMember: false, lastReadSeq: null });

      await channels.invite(owner.id, channel.id, [invitee.id]);
      const [invited] = await channels.list(invitee.id, workspace.id);
      expect(invited).toMatchObject({ unreadCount: 0, mentionCount: 0 });

      // Whatever arrives afterwards counts as usual.
      await messages.post(owner.id, channel.id, { body: 'new' });
      const [later] = await channels.list(joiner.id, workspace.id);
      expect(later).toMatchObject({
        unreadCount: 1,
        lastSeq: 3,
        lastReadSeq: 2,
      });
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

    it('removing someone else: who may, and what is refused', async () => {
      const { owner, members, workspace } = await team(3);
      const [creator, peer, other] = members;
      const notify = jest.spyOn(bus, 'notifyMembership');
      const channel = await channels.create(creator.id, workspace.id, {
        kind: 'private',
        name: 'squad',
      });
      await channels.invite(creator.id, channel.id, [
        peer.id,
        other.id,
        owner.id,
      ]);
      const url = `${base(workspace.id)}/channels/${channel.id}/members`;
      const inChannel = (u: TestUser) =>
        prisma.chatChannelMember.count({
          where: { channelId: channel.id, userId: u.id },
        });

      // `me` still means leave, and is not parsed as a user id.
      await as(other).delete(`${url}/me`).expect(204);
      await as(creator).delete(`${url}/abc`).expect(400);
      await channels.invite(creator.id, channel.id, [other.id]);

      // A plain member of a private channel may archive it, not evict people.
      await as(peer).delete(`${url}/${other.id}`).expect(403);
      // A creator who is not an owner cannot evict an owner.
      await as(creator).delete(`${url}/${owner.id}`).expect(403);
      expect(await inChannel(owner)).toBe(1);

      // The member list marks exactly the rows the caller may remove.
      const listed = await as(creator).get(url).expect(200);
      const removable = Object.fromEntries(
        (listed.body as { id: number; canRemove: boolean }[]).map((m) => [
          m.id,
          m.canRemove,
        ]),
      );
      expect(removable).toEqual({
        [owner.id]: false,
        [creator.id]: false,
        [peer.id]: true,
        [other.id]: true,
      });

      notify.mockClear();
      await as(creator).delete(`${url}/${peer.id}`).expect(204);
      expect(await inChannel(peer)).toBe(0);
      expect(notify).toHaveBeenCalledWith(channel.id);
      // Removed, the channel is now unreadable to them.
      await as(peer).get(url).expect(404);
      // Twice is a 404, and so is yourself through this route a 400.
      await as(creator).delete(`${url}/${peer.id}`).expect(404);
      await as(creator).delete(`${url}/${creator.id}`).expect(400);
      // An owner may remove anyone, the creator included.
      await as(owner).delete(`${url}/${creator.id}`).expect(204);

      // Never from a DM, nor from the default channel, even as an owner.
      const dm = await channels.openDm(owner.id, workspace.id, [other.id]);
      await as(owner)
        .delete(`${base(workspace.id)}/channels/${dm.id}/members/${other.id}`)
        .expect(400);
      await prisma.$transaction((tx) =>
        createDefaultChannel(tx, workspace.id, owner.id),
      );
      const general = await prisma.chatChannel.findUniqueOrThrow({
        where: { defaultKey: workspace.id },
      });
      await as(owner)
        .delete(
          `${base(workspace.id)}/channels/${general.id}/members/${other.id}`,
        )
        .expect(400);
    });

    it('the last member cannot leave a private channel', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'private',
        name: 'secret',
      });
      const leave = (u: TestUser) =>
        as(u).delete(`${base(workspace.id)}/channels/${channel.id}/members/me`);

      const refused = await leave(owner).expect(409);
      expect(refused.body.message).toMatch(/last member/i);
      expect(
        await prisma.chatChannelMember.count({
          where: { channelId: channel.id },
        }),
      ).toBe(1);

      // With somebody else still in it, leaving is fine; then they are last.
      await channels.invite(owner.id, channel.id, [peer.id]);
      await leave(owner).expect(204);
      await leave(peer).expect(409);

      // A public channel is reachable empty, so its last member may leave.
      const open = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'open',
      });
      await as(owner)
        .delete(`${base(workspace.id)}/channels/${open.id}/members/me`)
        .expect(204);
    });

    it('the last member of a private channel can archive it even if they did not create it', async () => {
      const { members, workspace } = await team(2);
      const [creator, peer] = members;
      const channel = await channels.create(creator.id, workspace.id, {
        kind: 'private',
        name: 'secret',
      });
      await channels.invite(creator.id, channel.id, [peer.id]);
      const url = `${base(workspace.id)}/channels/${channel.id}`;

      await as(creator).delete(`${url}/members/me`).expect(204);
      await as(peer).delete(`${url}/members/me`).expect(409);
      const archived = await as(peer)
        .patch(url)
        .send({ archived: true })
        .expect(200);
      expect(archived.body.archived).toBe(true);
    });

    it('two last members leaving at once leave one behind', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'private',
        name: 'secret',
      });
      await channels.invite(owner.id, channel.id, [peer.id]);

      const results = await Promise.allSettled([
        channels.leave(owner.id, channel.id),
        channels.leave(peer.id, channel.id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await prisma.chatChannelMember.count({
          where: { channelId: channel.id },
        }),
      ).toBe(1);
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

    it('removing the last member of a private channel deletes the channel', async () => {
      const { owner, members, workspace } = await team(2);
      const [peer, third] = members;
      const solo = await channels.create(peer.id, workspace.id, {
        kind: 'private',
        name: 'secret',
      });
      await messages.post(peer.id, solo.id, { body: 'only I can read this' });
      const shared = await channels.create(peer.id, workspace.id, {
        kind: 'private',
        name: 'shared',
      });
      await channels.invite(peer.id, shared.id, [third.id]);
      const dm = await channels.openDm(peer.id, workspace.id, [owner.id]);

      await as(owner)
        .delete(`/workspaces/${workspace.id}/members/${peer.id}`)
        .expect(200);

      // Nobody could ever read it again, so it goes, messages and all, and
      // its name is free once more.
      expect(
        await prisma.chatChannel.findUnique({ where: { id: solo.id } }),
      ).toBeNull();
      expect(
        await prisma.chatMessage.count({ where: { channelId: solo.id } }),
      ).toBe(0);
      await channels.create(owner.id, workspace.id, {
        kind: 'private',
        name: 'secret',
      });
      // A private channel with somebody left in it, and a DM, both stay.
      expect(
        await prisma.chatChannel.findUnique({ where: { id: shared.id } }),
      ).not.toBeNull();
      expect(
        await prisma.chatChannel.findUnique({ where: { id: dm.id } }),
      ).not.toBeNull();
    });

    it('a thread-only reply leaves the channel unread; alsoInChannel marks it read', async () => {
      const { owner, members, workspace } = await team(1);
      const [peer] = members;
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'general',
      });
      await channels.join(peer.id, channel.id);
      const root = await messages.post(owner.id, channel.id, { body: 'root' });
      await messages.post(owner.id, channel.id, { body: 'unseen' });
      const before = await channels.list(peer.id, workspace.id);
      expect(before[0].unreadCount).toBe(2);

      // Replying in a thread is not reading the channel.
      await messages.post(peer.id, channel.id, {
        body: 'reply',
        threadRootId: root.id,
      });
      const [afterReply] = await channels.list(peer.id, workspace.id);
      expect(afterReply.unreadCount).toBe(2);

      // Sending the reply to the channel too is posting there.
      await messages.post(peer.id, channel.id, {
        body: 'reply, also here',
        threadRootId: root.id,
        alsoInChannel: true,
      });
      const [afterBroadcast] = await channels.list(peer.id, workspace.id);
      expect(afterBroadcast.unreadCount).toBe(0);
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

    it('a mention cannot be forged by nesting a token in an unknown one', async () => {
      const { owner, members, channel } = await publicChannel();
      const [victim] = members;
      const forged = [
        `@[[FAKE](999999)](${victim.id})`,
        `@[[FAKE](abc)](${victim.id})`,
        `@[@[FAKE](999999)](${victim.id})`,
        `@[x(](999999)](${victim.id})`,
        `@[[[a](0)](0)](${victim.id})`,
      ];
      const real = new Map(
        [owner, victim].map((u) => [String(u.id), u.username]),
      );

      for (const body of forged) {
        const res = await messages.post(owner.id, channel.id, { body });
        for (const segment of parseMentionBody(res.body)) {
          if (segment.type !== 'mention') continue;
          // Every chip in the stored body is a real member, by real name.
          expect(real.get(segment.userId)).toBe(segment.username);
        }
        expect(extractMentionedUserIds(res.body)).not.toContain(
          String(victim.id),
        );
      }
      expect(
        await prisma.notification.count({
          where: { recipientId: victim.id, type: 'chat_mention' },
        }),
      ).toBe(0);
    });

    it('deleting a message takes its notification previews with it', async () => {
      const { owner, members, workspace, channel } = await publicChannel();
      const [peer] = members;
      const root = await messages.post(peer.id, channel.id, { body: 'root' });
      const reply = await messages.post(owner.id, channel.id, {
        body: `secret for @[${peer.username}](${peer.id})`,
        threadRootId: root.id,
      });
      const kept = await messages.post(owner.id, channel.id, {
        body: `keep @[${peer.username}](${peer.id})`,
      });
      const rows = () =>
        prisma.notification.findMany({
          where: { recipientId: peer.id },
          select: { commentId: true, type: true },
        });
      expect((await rows()).map((r) => r.commentId)).toEqual(
        expect.arrayContaining([reply.id, kept.id]),
      );

      await as(owner)
        .delete(`${base(workspace.id)}/messages/${reply.id}`)
        .expect(204);

      const after = await rows();
      expect(after.map((r) => r.commentId)).not.toContain(reply.id);
      expect(after.map((r) => r.commentId)).toContain(kept.id);
    });

    it('a seq beyond the safe-integer range is 400, not 500', async () => {
      const { owner, workspace, channel } = await publicChannel();
      const url = `${base(workspace.id)}/channels/${channel.id}`;

      await as(owner).post(`${url}/read`).send({ seq: 1e20 }).expect(400);
      await as(owner).get(`${url}/messages?before=1e20`).expect(400);
      await as(owner).get(`${url}/messages?after=1e20`).expect(400);
      await as(owner)
        .post(`${url}/read`)
        .send({ seq: Number.MAX_SAFE_INTEGER })
        .expect(204);
    });

    it('an edit racing a delete cannot restore the deleted body', async () => {
      const { owner, channel } = await publicChannel();
      const mine = await messages.post(owner.id, channel.id, { body: 'mine' });
      const update = jest.spyOn(bus, 'notifyUpdate');
      // The delete commits after the edit has checked ownership but before
      // its write: `canonicalBody` runs in exactly that window.
      const svc = messages as unknown as {
        canonicalBody: (body: string, workspaceId: string) => Promise<string>;
      };
      const real = svc.canonicalBody.bind(messages);
      jest
        .spyOn(svc, 'canonicalBody')
        .mockImplementationOnce(async (body, workspaceId) => {
          await messages.remove(owner.id, mine.id);
          return real(body, workspaceId);
        });

      await expect(
        messages.edit(owner.id, mine.id, 'revived'),
      ).rejects.toMatchObject({ status: 404 });

      const row = await prisma.chatMessage.findUniqueOrThrow({
        where: { id: mine.id },
      });
      expect(row.body).toBe('');
      expect(row.deletedAt).not.toBeNull();
      // Only the delete was announced.
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('edit and delete announce an update with ids only', async () => {
      const { owner, members, workspace, channel } = await publicChannel();
      const root = await messages.post(owner.id, channel.id, { body: 'root' });
      const reply = await messages.post(members[0].id, channel.id, {
        body: 'reply',
        threadRootId: root.id,
      });
      const update = jest.spyOn(bus, 'notifyUpdate');

      await as(owner)
        .patch(`${base(workspace.id)}/messages/${root.id}`)
        .send({ body: 'root, edited' })
        .expect(200);
      expect(update).toHaveBeenLastCalledWith({
        t: 'upd',
        c: channel.id,
        w: workspace.id,
        id: root.id,
        r: null,
      });

      await as(members[0])
        .delete(`${base(workspace.id)}/messages/${reply.id}`)
        .expect(204);
      expect(update).toHaveBeenLastCalledWith({
        t: 'upd',
        c: channel.id,
        w: workspace.id,
        id: reply.id,
        r: root.id,
      });
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('mention tokens are rewritten to the real username', async () => {
      const { owner, members, channel } = await publicChannel();
      const [bob] = members;
      const stranger = await createUser();

      const posted = await messages.post(owner.id, channel.id, {
        body: `hi @[ceo](${bob.id}) and @[boss](${stranger.id}) @[x](nope)`,
      });
      expect(posted.body).toBe(`hi @[${bob.username}](${bob.id}) and @boss @x`);
      const row = await prisma.chatMessage.findUniqueOrThrow({
        where: { id: posted.id },
      });
      expect(row.body).toBe(posted.body);

      const edited = await messages.edit(
        owner.id,
        posted.id,
        `now @[ceo](${bob.id})`,
      );
      expect(edited.body).toBe(`now @[${bob.username}](${bob.id})`);
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
        i: false,
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

  describe('default channel', () => {
    /** A workspace made the way the app makes one, with #general. */
    async function realWorkspace() {
      const owner = await createUser();
      const workspace = await workspaces.create(owner.id, { name: 'team' });
      const general = await prisma.chatChannel.findUniqueOrThrow({
        where: { defaultKey: workspace.id },
      });
      return { owner, workspace, general };
    }

    /** Joins `user` to `workspaceId` through an invite, as the UI does. */
    async function acceptInvite(
      workspaceId: string,
      ownerId: number,
      user: TestUser,
    ) {
      const invite = await workspaces.createInvite(workspaceId, ownerId, {
        role: 'member',
      });
      await workspaces.acceptInvite(invite.token, user.id);
    }

    it('creating a workspace creates #general with the owner in it', async () => {
      const { owner, workspace, general } = await realWorkspace();
      expect(general).toMatchObject({ kind: 'public', name: 'general' });

      const [summary] = await channels.list(owner.id, workspace.id);
      expect(summary).toMatchObject({
        id: general.id,
        isDefault: true,
        isMember: true,
      });
    });

    it('accepting an invite joins #general at the tail', async () => {
      const { owner, workspace, general } = await realWorkspace();
      await messages.post(owner.id, general.id, { body: 'before you came' });
      const joiner = await createUser();

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
        await acceptInvite(workspace.id, owner.id, joiner);

        const [summary] = await channels.list(joiner.id, workspace.id);
        expect(summary).toMatchObject({
          id: general.id,
          isMember: true,
          unreadCount: 0,
        });
        // The new member's open stream must start receiving #general.
        const expected = JSON.stringify({ t: 'mem', c: general.id });
        const deadline = Date.now() + 2_000;
        while (!notified.includes(expected) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(notified.map((p) => JSON.parse(p))).toContainEqual({
          t: 'mem',
          c: general.id,
        });
      } finally {
        await listener.end();
      }
    });

    it('#general cannot be left or archived, but can be renamed', async () => {
      const { owner, workspace, general } = await realWorkspace();
      const url = `${base(workspace.id)}/channels/${general.id}`;

      await as(owner).delete(`${url}/members/me`).expect(400);
      await as(owner).patch(url).send({ archived: true }).expect(400);
      const renamed = await as(owner)
        .patch(url)
        .send({ name: 'lobby' })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: 'lobby', isDefault: true });
    });

    it('reading the list repairs a workspace created without #general', async () => {
      // `team()` writes rows directly, the way a pod from before defaults
      // existed would during a rolling deploy.
      const { owner, members, workspace } = await team(1);
      expect(
        await prisma.chatChannel.count({ where: { defaultKey: workspace.id } }),
      ).toBe(0);

      const [general] = await channels.list(owner.id, workspace.id);
      expect(general).toMatchObject({
        name: 'general',
        isDefault: true,
        isMember: true,
      });
      // Everyone joined, not just the reader.
      const [theirs] = await channels.list(members[0].id, workspace.id);
      expect(theirs).toMatchObject({ id: general.id, isMember: true });
    });

    it('reading the list joins a member an old pod left out', async () => {
      const { owner, workspace, general } = await realWorkspace();
      const late = await createUser();
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: late.id, role: 'member' },
      });
      await messages.post(owner.id, general.id, { body: 'before you came' });

      const [summary] = await channels.list(late.id, workspace.id);
      expect(summary).toMatchObject({
        id: general.id,
        isMember: true,
        unreadCount: 0,
      });
    });

    it('a private general is left alone', async () => {
      const { owner, workspace } = await team(0);
      const secret = await channels.create(owner.id, workspace.id, {
        kind: 'private',
        name: 'general',
      });

      const rows = await channels.list(owner.id, workspace.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: secret.id, isDefault: false });
    });

    it('other channels are not default', async () => {
      const { owner, workspace } = await realWorkspace();
      const other = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'random',
      });
      expect(other.isDefault).toBe(false);
    });
  });

  describe('channel members', () => {
    it('lists who is in a channel, by username', async () => {
      const { owner, members, workspace } = await team(2);
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'random',
      });
      await channels.invite(owner.id, channel.id, [members[0].id]);

      const res = await as(members[1])
        .get(`${base(workspace.id)}/channels/${channel.id}/members`)
        .expect(200);
      expect(res.body.map((u: { id: number }) => u.id).sort()).toEqual(
        [owner.id, members[0].id].sort(),
      );
    });

    it('omits a channel row that outlived its workspace membership', async () => {
      const { owner, members, workspace } = await team(1);
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'public',
        name: 'random',
      });
      await channels.invite(owner.id, channel.id, [members[0].id]);
      // Removed without `removeMember`'s cleanup.
      await prisma.workspaceMember.delete({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: members[0].id,
          },
        },
      });

      const res = await as(owner)
        .get(`${base(workspace.id)}/channels/${channel.id}/members`)
        .expect(200);
      expect(res.body.map((u: { id: number }) => u.id)).toEqual([owner.id]);
    });

    it('a DM is refused: its members are on its summary', async () => {
      const { owner, members, workspace } = await team(1);
      const dm = await channels.openDm(owner.id, workspace.id, [members[0].id]);
      await as(owner)
        .get(`${base(workspace.id)}/channels/${dm.id}/members`)
        .expect(400);
    });

    it("a private channel's members are 404 to a non-member", async () => {
      const { owner, members, workspace } = await team(1);
      const channel = await channels.create(owner.id, workspace.id, {
        kind: 'private',
        name: 'secret',
      });
      await as(members[0])
        .get(`${base(workspace.id)}/channels/${channel.id}/members`)
        .expect(404);
    });
  });
});
