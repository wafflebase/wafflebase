import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';
import { ChatMessageService } from 'src/chat/chat-message.service';
import { frontendBase } from 'src/chat/chat-document-refs';
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

function at(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Document cards and the Files list against a real database: a ref is
 * stored only for a live document of the channel's own workspace, follows
 * the body through edit and delete, and is read under the channel's access.
 */
describeDb('Chat document refs integration', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let messages: ChatMessageService;
  let createUser: ReturnType<typeof createUserFactory>;
  let base: string;

  function as(user: TestUser) {
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
    const cookie = `wafflebase_session=${token}`;
    const server = app.getHttpServer();
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
    base = frontendBase(process.env.FRONTEND_URL)!;

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
    messages = moduleRef.get(ChatMessageService);
    createUser = createUserFactory(prisma, 'chatref');
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

  async function setup() {
    const owner = await createUser();
    const outsider = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const other = await createWorkspace(prisma, outsider.id, 'other');
    const general = await prisma.chatChannel.create({
      data: {
        workspaceId: workspace.id,
        kind: 'public',
        name: 'general',
        createdBy: owner.id,
        members: { create: { userId: owner.id } },
      },
    });
    const doc = (title: string, type = 'sheet', workspaceId = workspace.id) =>
      prisma.document.create({
        data: { title, type, workspaceId, authorID: owner.id },
      });
    return { owner, outsider, workspace, other, general, doc };
  }

  const messagesUrl = (wid: string, cid: string) =>
    `/workspaces/${wid}/chat/channels/${cid}/messages`;
  const filesUrl = (wid: string, cid: string) =>
    `/workspaces/${wid}/chat/channels/${cid}/files`;

  it('stores refs only for live documents of the channel workspace', async () => {
    const { owner, workspace, other, general, doc } = await setup();
    const live = await doc('Q4 budget');
    const trashed = await doc('Old');
    await prisma.document.update({
      where: { id: trashed.id },
      data: { deletedAt: new Date() },
    });
    const foreign = await doc('Theirs', 'sheet', other.id);
    const anchor = {
      tabId: 't1',
      rowId: 'r1',
      colId: 'c1',
      rowSpan: 2,
      colSpan: 3,
      label: 'Sheet1!C3:E7',
    };

    const res = await as(owner)
      .post(messagesUrl(workspace.id, general.id))
      .send({
        body: [
          `${base}/s/${live.id}?at=${at(anchor)}`,
          `/s/${trashed.id}`,
          `${base}/s/${foreign.id}`,
          `https://elsewhere.test/s/${live.id}`,
        ].join(' '),
      })
      .expect(201);

    expect(res.body.refs).toEqual([
      { documentId: live.id, type: 'sheet', title: 'Q4 budget', anchor },
    ]);
    const rows = await prisma.chatDocumentRef.findMany();
    expect(rows.map((r) => r.documentId)).toEqual([live.id]);
    expect(rows[0].channelId).toBe(general.id);
  });

  it('stores a null anchor for a garbage ?at=', async () => {
    const { owner, workspace, general, doc } = await setup();
    const live = await doc('Deck', 'slides');
    const res = await as(owner)
      .post(messagesUrl(workspace.id, general.id))
      .send({ body: `/p/${live.id}?at=%%%garbage` })
      .expect(201);
    expect(res.body.refs).toEqual([
      { documentId: live.id, type: 'slides', title: 'Deck', anchor: null },
    ]);
  });

  it('reads titles at read time and drops trashed documents', async () => {
    const { owner, workspace, general, doc } = await setup();
    const a = await doc('A');
    const b = await doc('B', 'doc');
    await as(owner)
      .post(messagesUrl(workspace.id, general.id))
      .send({ body: `/s/${a.id} /d/${b.id}` })
      .expect(201);
    await prisma.document.update({
      where: { id: a.id },
      data: { title: 'A renamed' },
    });
    await prisma.document.update({
      where: { id: b.id },
      data: { deletedAt: new Date() },
    });
    const page = await as(owner)
      .get(messagesUrl(workspace.id, general.id))
      .expect(200);
    expect(page.body[0].refs).toEqual([
      { documentId: a.id, type: 'sheet', title: 'A renamed', anchor: null },
    ]);
  });

  it('replaces refs on edit and clears them on delete', async () => {
    const { owner, workspace, general, doc } = await setup();
    const a = await doc('A');
    const b = await doc('B');
    const posted = await as(owner)
      .post(messagesUrl(workspace.id, general.id))
      .send({ body: `/s/${a.id}` })
      .expect(201);
    const edited = await as(owner)
      .patch(`/workspaces/${workspace.id}/chat/messages/${posted.body.id}`)
      .send({ body: `now /s/${b.id}` })
      .expect(200);
    expect(edited.body.refs.map((r: { title: string }) => r.title)).toEqual([
      'B',
    ]);
    expect(
      (await prisma.chatDocumentRef.findMany()).map((r) => r.documentId),
    ).toEqual([b.id]);

    await as(owner)
      .delete(`/workspaces/${workspace.id}/chat/messages/${posted.body.id}`)
      .expect(204);
    expect(await prisma.chatDocumentRef.count()).toBe(0);
  });

  it('lists Files newest share first, once per document, paginated', async () => {
    const { owner, workspace, general, doc } = await setup();
    const a = await doc('A');
    const b = await doc('B');
    const c = await doc('C');
    await messages.post(owner.id, general.id, { body: `/s/${a.id}` });
    await messages.post(owner.id, general.id, { body: `/s/${b.id}` });
    await messages.post(owner.id, general.id, { body: `/s/${c.id}` });
    // Sharing A again moves it to the top.
    await messages.post(owner.id, general.id, { body: `again /s/${a.id}` });

    const first = await as(owner)
      .get(`${filesUrl(workspace.id, general.id)}?limit=2`)
      .expect(200);
    expect(first.body.files.map((f: { title: string }) => f.title)).toEqual([
      'A',
      'C',
    ]);
    expect(first.body.files[0].sharedBy).toMatchObject({ id: owner.id });
    expect(first.body.cursor).toEqual(expect.any(String));

    const second = await as(owner)
      .get(
        `${filesUrl(workspace.id, general.id)}?limit=2&before=${encodeURIComponent(first.body.cursor)}`,
      )
      .expect(200);
    expect(second.body.files.map((f: { title: string }) => f.title)).toEqual([
      'B',
    ]);
    expect(second.body.cursor).toBeNull();
  });

  it('gates Files like messages', async () => {
    const { owner, outsider, workspace, general, doc } = await setup();
    const member = await createUser();
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: member.id, role: 'member' },
    });
    const secret = await prisma.chatChannel.create({
      data: {
        workspaceId: workspace.id,
        kind: 'private',
        name: 'secret',
        createdBy: owner.id,
        members: { create: { userId: owner.id } },
      },
    });
    const a = await doc('A');
    await messages.post(owner.id, secret.id, { body: `/s/${a.id}` });

    await as(owner).get(filesUrl(workspace.id, secret.id)).expect(200);
    await as(member).get(filesUrl(workspace.id, secret.id)).expect(404);
    await as(outsider).get(filesUrl(workspace.id, general.id)).expect(404);
    // A public channel reads for any workspace member, joined or not.
    await as(member).get(filesUrl(workspace.id, general.id)).expect(200);
  });
});
