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

/**
 * Covers the notification controller end to end, and the two guarantees that
 * only a real database can prove: the unique index absorbing a duplicate
 * report, and the document cascade removing notifications with their
 * document.
 */
describeDb('Notification HTTP integration', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let createUser: ReturnType<typeof createUserFactory>;

  function authCookie(user: {
    id: number;
    username: string;
    email: string;
    photo: string | null;
  }) {
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
    createUser = createUserFactory(prisma, 'notif');
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

  /** An author and a peer in one workspace, with a document to comment on. */
  async function scenario() {
    const author = await createUser();
    const peer = await createUser();
    const workspace = await createWorkspace(prisma, author.id);
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: peer.id, role: 'member' },
    });
    const document = await prisma.document.create({
      data: {
        title: 'Notes',
        authorID: author.id,
        workspaceId: workspace.id,
      },
    });
    return { author, peer, workspace, document };
  }

  function mentionBody(documentId: string, recipientUserIds: number[]) {
    return {
      type: 'comment_mention',
      documentId,
      threadId: 'thread-1',
      commentId: 'comment-1',
      recipientUserIds,
      preview: 'take a look @you',
    };
  }

  it('rejects an unauthenticated report', async () => {
    const { document, peer } = await scenario();

    await request(app.getHttpServer())
      .post('/notifications/comment')
      .send(mentionBody(document.id, [peer.id]))
      .expect(401);
  });

  it('delivers a mention to a workspace peer, with actor and document attached', async () => {
    const { author, peer, document } = await scenario();

    await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(author))
      .send(mentionBody(document.id, [peer.id]))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set('Cookie', authCookie(peer))
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      type: 'comment_mention',
      preview: 'take a look @you',
      readAt: null,
      actor: { id: author.id, username: author.username },
      document: { id: document.id, title: 'Notes', type: 'sheet' },
    });
  });

  it('does not deliver the mention back to its author', async () => {
    const { author, peer, document } = await scenario();

    await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(author))
      .send(mentionBody(document.id, [author.id, peer.id]))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set('Cookie', authCookie(author))
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('refuses a report from someone outside the document workspace', async () => {
    const { peer, document } = await scenario();
    const outsider = await createUser();

    await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(outsider))
      .send(mentionBody(document.id, [peer.id]))
      .expect(403);
  });

  it('drops a recipient who is not in the workspace', async () => {
    const { author, peer, document } = await scenario();
    const outsider = await createUser();

    const res = await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(author))
      .send(mentionBody(document.id, [peer.id, outsider.id]))
      .expect(201);

    expect(res.body).toEqual({ created: 1 });
    expect(
      await prisma.notification.count({ where: { recipientId: outsider.id } }),
    ).toBe(0);
  });

  it('stores a repeated report once, via the unique index', async () => {
    const { author, peer, document } = await scenario();

    await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(author))
      .send(mentionBody(document.id, [peer.id]))
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(author))
      .send(mentionBody(document.id, [peer.id]))
      .expect(201);

    expect(second.body).toEqual({ created: 0 });
    expect(
      await prisma.notification.count({ where: { recipientId: peer.id } }),
    ).toBe(1);
  });

  it('rejects an unknown notification type', async () => {
    const { author, peer, document } = await scenario();

    await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(author))
      .send({ ...mentionBody(document.id, [peer.id]), type: 'anything' })
      .expect(400);
  });

  it('marks everything read and clears the unread count', async () => {
    const { author, peer, document } = await scenario();
    await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(author))
      .send(mentionBody(document.id, [peer.id]))
      .expect(201);

    const before = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Cookie', authCookie(peer))
      .expect(200);
    expect(before.body).toEqual({ count: 1 });

    await request(app.getHttpServer())
      .post('/notifications/read')
      .set('Cookie', authCookie(peer))
      .send({})
      .expect(204);

    const after = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Cookie', authCookie(peer))
      .expect(200);
    expect(after.body).toEqual({ count: 0 });
  });

  it('cannot mark another user notification read', async () => {
    const { author, peer, document } = await scenario();
    await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(author))
      .send(mentionBody(document.id, [peer.id]))
      .expect(201);
    const row = await prisma.notification.findFirstOrThrow({
      where: { recipientId: peer.id },
    });

    await request(app.getHttpServer())
      .post('/notifications/read')
      .set('Cookie', authCookie(author))
      .send({ ids: [row.id] })
      .expect(204);

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.readAt).toBeNull();
  });

  it('removes notifications when their document is deleted', async () => {
    const { author, peer, document } = await scenario();
    await request(app.getHttpServer())
      .post('/notifications/comment')
      .set('Cookie', authCookie(author))
      .send(mentionBody(document.id, [peer.id]))
      .expect(201);

    await prisma.document.delete({ where: { id: document.id } });

    expect(
      await prisma.notification.count({ where: { recipientId: peer.id } }),
    ).toBe(0);
  });

  it('notifies the owner when someone accepts their invite link', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const invite = await prisma.workspaceInvite.create({
      data: { workspaceId: workspace.id, createdBy: owner.id, role: 'member' },
    });

    await request(app.getHttpServer())
      .post(`/invites/${invite.token}/accept`)
      .set('Cookie', authCookie(joiner))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set('Cookie', authCookie(owner))
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      type: 'workspace_member_joined',
      documentId: null,
      actor: { id: joiner.id },
    });
  });
});
