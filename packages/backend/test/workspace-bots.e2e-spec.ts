import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';
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
 * Workspace bots end to end (`docs/design/agent-runner.md`, MVP): a member
 * makes a bot over the session routes, pairs a host with a code, mentions
 * the bot, and the host drains the task over `/api/v1/…/agent/tasks/*` with
 * the key pairing minted. Runs only against a scratch database — `clearDatabase`
 * deletes every row.
 */
describeDb('Workspace bots integration', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let jwtService: JwtService;
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

  /** A supertest wrapper that sends every request as `user`'s session. */
  function as(user: TestUser) {
    const server = app.getHttpServer();
    const cookie = authCookie(user);
    return {
      get: (url: string) => request(server).get(url).set('Cookie', cookie),
      post: (url: string) => request(server).post(url).set('Cookie', cookie),
      delete: (url: string) =>
        request(server).delete(url).set('Cookie', cookie),
    };
  }

  /** A supertest wrapper that sends every request with an API key. */
  function withKey(apiKey: string) {
    const server = app.getHttpServer();
    const auth = `Bearer ${apiKey}`;
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string) =>
        request(server).post(url).set('Authorization', auth),
    };
  }

  const chat = (wid: string) => `/workspaces/${wid}/chat`;
  const tasks = (wid: string) => `/api/v1/workspaces/${wid}/agent/tasks`;

  /** `owner` makes a bot and pairs a host with it; returns the host's key. */
  async function pairedBot(owner: TestUser, wid: string, name = 'deck-bot') {
    const { body: bot } = await as(owner)
      .post(`/workspaces/${wid}/bots`)
      .send({ name })
      .expect(201);
    const { body: code } = await as(owner)
      .post(`/workspaces/${wid}/bots/${bot.id as number}/pairing-codes`)
      .expect(201);
    const { body: paired } = await request(app.getHttpServer())
      .post('/auth/pair')
      .send({ code: code.code as string, hostName: 'MacBook' })
      .expect(200);
    expect(paired).toMatchObject({ botId: bot.id, workspaceId: wid });
    return {
      botId: bot.id as number,
      botName: bot.username as string,
      apiKey: paired.apiKey as string,
    };
  }

  async function publicChannel(owner: TestUser, wid: string, name: string) {
    const { body } = await as(owner)
      .post(`${chat(wid)}/channels`)
      .send({ kind: 'public', name })
      .expect(201);
    return body.id as string;
  }

  async function postAs(
    user: TestUser,
    wid: string,
    cid: string,
    text: string,
  ) {
    const { body } = await as(user)
      .post(`${chat(wid)}/channels/${cid}/messages`)
      .send({ body: text })
      .expect(201);
    return body as { id: string };
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
    createUser = createUserFactory(prisma, 'bots');
    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
  });

  afterAll(async () => {
    await clearDatabase(prisma);
    await app.close();
    await moduleRef.close();
  });

  it("answers its owner's mention in the thread, as the bot", async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const wid = workspace.id;
    const bot = await pairedBot(owner, wid);
    const cid = await publicChannel(owner, wid, 'bots');
    const trigger = await postAs(
      owner,
      wid,
      cid,
      `@[${bot.botName}](${bot.botId}) hello`,
    );

    const host = withKey(bot.apiKey);
    // The host key reaches the task routes and nothing else in /api/v1.
    await host.get(`/api/v1/workspaces/${wid}/documents`).expect(403);
    const { body: next } = await host
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    expect(next.task).toMatchObject({
      channelId: cid,
      channelKind: 'public',
      channelName: 'bots',
      threadRootId: trigger.id,
      triggerMessageId: trigger.id,
      invoker: { id: owner.id, username: owner.username },
      body: `@[${bot.botName}](${bot.botId}) hello`,
    });
    const taskId = next.task.id as string;
    const seen = await prisma.user.findUniqueOrThrow({
      where: { id: bot.botId },
    });
    expect(seen.botLastSeenAt).not.toBeNull();

    const { body: thread } = await host
      .get(`${tasks(wid)}/${taskId}/thread`)
      .expect(200);
    expect(thread.map((m: { id: string }) => m.id)).toEqual([trigger.id]);

    const { body: reply } = await host
      .post(`${tasks(wid)}/${taskId}/reply`)
      .send({ body: 'Hi! On it.' })
      .expect(201);
    expect(reply).toMatchObject({
      channelId: cid,
      threadRootId: trigger.id,
      body: 'Hi! On it.',
      author: { id: bot.botId, username: bot.botName, kind: 'bot' },
    });
    const stored = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: reply.id as string },
    });
    expect(stored.agentTaskId).toBe(taskId);
    const key = await prisma.apiKey.findFirstOrThrow({
      where: { createdBy: bot.botId },
    });
    expect(stored.apiKeyId).toBe(key.id);

    // The owner sees the answer in the thread, labelled as a bot's.
    const { body: seenByOwner } = await as(owner)
      .get(`${chat(wid)}/channels/${cid}/messages?thread=${trigger.id}`)
      .expect(200);
    expect(seenByOwner).toHaveLength(2);
    expect(seenByOwner[0].author.kind).toBe('person');
    expect(seenByOwner[1]).toMatchObject({
      id: reply.id,
      author: { id: bot.botId, kind: 'bot' },
    });

    await host
      .post(`${tasks(wid)}/${taskId}/complete`)
      .send({ status: 'done' })
      .expect(204);
    const done = await prisma.agentTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(done.status).toBe('done');
    expect(done.finishedAt).not.toBeNull();
    await host
      .post(`${tasks(wid)}/${taskId}/reply`)
      .send({ body: 'one more thing' })
      .expect(409);

    const { body: empty } = await host
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    expect(empty).toEqual({ task: null });

    // The bot's own reply created no task, so nothing is left queued.
    expect(await prisma.agentTask.count()).toBe(1);
  });

  it('creates no task when somebody other than the owner mentions the bot', async () => {
    const owner = await createUser();
    const member = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const wid = workspace.id;
    await prisma.workspaceMember.create({
      data: { workspaceId: wid, userId: member.id, role: 'member' },
    });
    const bot = await pairedBot(owner, wid);
    const cid = await publicChannel(owner, wid, 'bots');
    await postAs(member, wid, cid, `@[${bot.botName}](${bot.botId}) hi`);
    expect(await prisma.agentTask.count()).toBe(0);
  });

  it("creates a task for the owner's DM with the bot", async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const wid = workspace.id;
    const bot = await pairedBot(owner, wid);
    const { body: dm } = await as(owner)
      .post(`${chat(wid)}/channels`)
      .send({ kind: 'dm', userIds: [bot.botId] })
      .expect(201);
    const trigger = await postAs(owner, wid, dm.id as string, 'summarize');

    const host = withKey(bot.apiKey);
    const { body: next } = await host
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    expect(next.task).toMatchObject({
      channelKind: 'dm',
      channelName: null,
      threadRootId: trigger.id,
    });
    await host
      .post(`${tasks(wid)}/${next.task.id as string}/reply`)
      .send({ body: 'Summary: …' })
      .expect(201);
  });

  it('wakes a waiting long-poll when the task arrives', async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const wid = workspace.id;
    const bot = await pairedBot(owner, wid);
    const cid = await publicChannel(owner, wid, 'bots');

    const started = Date.now();
    const polling = withKey(bot.apiKey).get(`${tasks(wid)}/next?wait=20`);
    const done = new Promise<request.Response>((resolve, reject) =>
      polling.then(resolve, reject),
    );
    await new Promise((r) => setTimeout(r, 300));
    const trigger = await postAs(
      owner,
      wid,
      cid,
      `@[${bot.botName}](${bot.botId}) wake up`,
    );
    const res = await done;
    expect(res.status).toBe(200);
    expect(res.body.task.triggerMessageId).toBe(trigger.id);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('hands one task to exactly one of two racing polls', async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const wid = workspace.id;
    const bot = await pairedBot(owner, wid);
    const cid = await publicChannel(owner, wid, 'bots');
    await postAs(owner, wid, cid, `@[${bot.botName}](${bot.botId}) once`);

    const host = withKey(bot.apiKey);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        host.get(`${tasks(wid)}/next?wait=0`).expect(200),
      ),
    );
    const won = results.filter((r) => r.body.task !== null);
    expect(won).toHaveLength(1);
  });

  it('re-queues a task whose lease has expired', async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const wid = workspace.id;
    const bot = await pairedBot(owner, wid);
    const cid = await publicChannel(owner, wid, 'bots');
    await postAs(owner, wid, cid, `@[${bot.botName}](${bot.botId}) again`);

    const host = withKey(bot.apiKey);
    const { body: first } = await host
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    const claimed = await prisma.agentTask.findUniqueOrThrow({
      where: { id: first.task.id as string },
    });
    expect(claimed.status).toBe('claimed');
    // About ten minutes out, as the lease is.
    const leaseMs = claimed.leaseExpiresAt!.getTime() - Date.now();
    expect(leaseMs).toBeGreaterThan(9 * 60_000);
    expect(leaseMs).toBeLessThan(11 * 60_000);

    // Still held: nobody else gets it.
    const { body: held } = await host
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    expect(held.task).toBeNull();

    await prisma.agentTask.update({
      where: { id: claimed.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });
    const { body: again } = await host
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    expect(again.task.id).toBe(claimed.id);
  });

  it('lets only the host holding a task answer it once its lease passed on', async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const wid = workspace.id;
    const bot = await pairedBot(owner, wid);
    // A second computer paired with the same bot.
    const { body: code } = await as(owner)
      .post(`/workspaces/${wid}/bots/${bot.botId}/pairing-codes`)
      .expect(201);
    const { body: second } = await request(app.getHttpServer())
      .post('/auth/pair')
      .send({ code: code.code as string, hostName: 'Server' })
      .expect(200);
    const hostA = withKey(bot.apiKey);
    const hostB = withKey(second.apiKey as string);
    const cid = await publicChannel(owner, wid, 'bots');
    await postAs(owner, wid, cid, `@[${bot.botName}](${bot.botId}) slow one`);

    const { body: first } = await hostA
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    const taskId = first.task.id as string;

    // A reply renews the holder's lease.
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { leaseExpiresAt: new Date(Date.now() + 1_000) },
    });
    await hostA
      .post(`${tasks(wid)}/${taskId}/reply`)
      .send({ body: 'Working on it' })
      .expect(201);
    const renewed = await prisma.agentTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(renewed.leaseExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
      9 * 60_000,
    );
    // …so the other host still gets nothing, and may not answer it.
    const { body: none } = await hostB
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    expect(none.task).toBeNull();
    await hostB
      .post(`${tasks(wid)}/${taskId}/reply`)
      .send({ body: 'me too' })
      .expect(409);

    // A's lease runs out and B claims the task: A can no longer answer.
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });
    const { body: handed } = await hostB
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    expect(handed.task.id).toBe(taskId);
    await hostA
      .post(`${tasks(wid)}/${taskId}/reply`)
      .send({ body: 'late answer' })
      .expect(409);
    await hostA
      .post(`${tasks(wid)}/${taskId}/complete`)
      .send({ status: 'done' })
      .expect(409);

    await hostB
      .post(`${tasks(wid)}/${taskId}/reply`)
      .send({ body: 'Here it is' })
      .expect(201);
    await hostB
      .post(`${tasks(wid)}/${taskId}/complete`)
      .send({ status: 'done' })
      .expect(204);
    // Finished: a retry from either host changes nothing.
    await hostA
      .post(`${tasks(wid)}/${taskId}/complete`)
      .send({ status: 'done' })
      .expect(204);
    const replies = await prisma.chatMessage.findMany({
      where: { agentTaskId: taskId },
      orderBy: { createdAt: 'asc' },
    });
    expect(replies.map((m) => m.body)).toEqual(['Working on it', 'Here it is']);
  });

  it("refuses a person's key, and hides another bot's task", async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const wid = workspace.id;
    const bot = await pairedBot(owner, wid, 'deck-bot');
    const other = await pairedBot(owner, wid, 'other-bot');
    const cid = await publicChannel(owner, wid, 'bots');
    await postAs(owner, wid, cid, `@[${bot.botName}](${bot.botId}) mine`);

    const { body: personKey } = await as(owner)
      .post(`/workspaces/${wid}/api-keys`)
      .send({ name: 'my key' })
      .expect(201);
    await withKey(personKey.key as string)
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(403);
    await as(owner)
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(403);

    const { body: next } = await withKey(bot.apiKey)
      .get(`${tasks(wid)}/next?wait=0`)
      .expect(200);
    const taskId = next.task.id as string;
    const intruder = withKey(other.apiKey);
    await intruder.get(`${tasks(wid)}/${taskId}/thread`).expect(404);
    await intruder
      .post(`${tasks(wid)}/${taskId}/reply`)
      .send({ body: 'not mine' })
      .expect(404);
    await intruder
      .post(`${tasks(wid)}/${taskId}/complete`)
      .send({ status: 'done' })
      .expect(404);
  });

  // chat.md § Bot Members: a bot cannot outlive its owner's membership, or
  // its hosts would keep a key into a workspace the owner has left. The key
  // is seeded directly, not paired, to stay under `/auth/pair`'s throttle.
  it("removes a member's bots when the member is removed", async () => {
    const admin = await createUser();
    const member = await createUser();
    const workspace = await createWorkspace(prisma, admin.id);
    const wid = workspace.id;
    await prisma.workspaceMember.create({
      data: { workspaceId: wid, userId: member.id, role: 'member' },
    });
    const { body: bot } = await as(member)
      .post(`/workspaces/${wid}/bots`)
      .send({ name: 'member-bot' })
      .expect(201);
    const { body: kept } = await as(admin)
      .post(`/workspaces/${wid}/bots`)
      .send({ name: 'admin-bot' })
      .expect(201);
    const key = await prisma.apiKey.create({
      data: {
        name: 'MacBook',
        prefix: 'wb_test',
        hashedKey: `hash-${bot.id as number}`,
        workspaceId: wid,
        createdBy: bot.id as number,
      },
    });

    await as(admin)
      .delete(`/workspaces/${wid}/members/${member.id}`)
      .expect(200);

    expect(
      await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: wid, userId: bot.id as number },
        },
      }),
    ).toBeNull();
    const revoked = await prisma.apiKey.findUniqueOrThrow({
      where: { id: key.id },
    });
    expect(revoked.revokedAt).not.toBeNull();
    // The bot's row stays so its messages keep a name.
    expect(
      await prisma.user.findUnique({ where: { id: bot.id as number } }),
    ).not.toBeNull();
    const { body: listed } = await as(admin)
      .get(`/workspaces/${wid}/bots`)
      .expect(200);
    expect(listed.map((b: { id: number }) => b.id)).toEqual([kept.id]);
  });

  it('rejects a wait beyond the cap', async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const bot = await pairedBot(owner, workspace.id);
    await withKey(bot.apiKey)
      .get(`${tasks(workspace.id)}/next?wait=241`)
      .expect(400);
  });
});
