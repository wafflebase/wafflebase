import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import { YorkieService } from 'src/yorkie/yorkie.service';
import { YorkieAdminService } from 'src/yorkie/yorkie-admin.service';
import { FolderService } from 'src/folder/folder.service';
import {
  applyGlobalBootstrap,
  describeDb,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
} from './helpers/integration-helpers';

describeDb('FolderService integration (Prisma-backed)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let folderService: FolderService;
  let jwtService: JwtService;
  let createUser: ReturnType<typeof createUserFactory>;

  let userId: number;
  let workspaceId: string;
  let user: { id: number; username: string; email: string; photo: string | null };

  function authCookie(u: {
    id: number;
    username: string;
    email: string;
    photo: string | null;
  }) {
    const token = jwtService.sign(
      {
        tokenType: 'access',
        sub: u.id,
        username: u.username,
        email: u.email,
        photo: u.photo,
      },
      {
        secret: process.env.JWT_SECRET!,
        expiresIn: '1h',
      },
    );

    return `wafflebase_session=${token}`;
  }

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();

    const yorkieStub = {
      onModuleInit: () => Promise.resolve(),
      onModuleDestroy: () => Promise.resolve(),
      withDocument: () => Promise.resolve(null),
    };

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(YorkieService)
      .useValue(yorkieStub)
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
    folderService = moduleRef.get(FolderService);
    jwtService = moduleRef.get(JwtService);
    createUser = createUserFactory(prisma, 'folder');
    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);

    user = await createUser();
    const workspace = await createWorkspace(prisma, user.id);
    userId = user.id;
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    await clearDatabase(prisma);
    await app.close();
    await moduleRef.close();
  });

  it('rejects moving a folder into its own descendant', async () => {
    const a = await folderService.create({
      name: 'A',
      workspaceId,
      parentId: null,
      authorID: userId,
    });
    const b = await folderService.create({
      name: 'B',
      workspaceId,
      parentId: a.id,
      authorID: userId,
    });
    await expect(folderService.assertNoCycle(a.id, b.id)).rejects.toThrow();
  });

  it('deleting a parent folder returns its documents to the workspace root', async () => {
    const f = await folderService.create({
      name: 'F',
      workspaceId,
      parentId: null,
      authorID: userId,
    });
    const doc = await prisma.document.create({
      data: { title: 'D', workspaceId, authorID: userId, folderId: f.id },
    });
    await folderService.delete(f.id);
    const after = await prisma.document.findUnique({ where: { id: doc.id } });
    expect(after?.folderId).toBeNull();
  });

  it('cascade-deletes descendant folders', async () => {
    const a = await folderService.create({
      name: 'A',
      workspaceId,
      parentId: null,
      authorID: userId,
    });
    const b = await folderService.create({
      name: 'B',
      workspaceId,
      parentId: a.id,
      authorID: userId,
    });
    await folderService.delete(a.id);
    expect(await prisma.folder.findUnique({ where: { id: b.id } })).toBeNull();
  });

  it('POST creates a folder and GET lists it', async () => {
    const created = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/folders`)
      .set('Cookie', authCookie(user))
      .send({ name: 'Reports' })
      .expect(201);
    const list = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/folders`)
      .set('Cookie', authCookie(user))
      .expect(200);
    expect(list.body.map((f: any) => f.id)).toContain(created.body.id);
  });

  it('PATCH rejects a cycle-forming move with 400', async () => {
    const a = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/folders`)
      .set('Cookie', authCookie(user))
      .send({ name: 'A' });
    const b = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/folders`)
      .set('Cookie', authCookie(user))
      .send({ name: 'B', parentId: a.body.id });
    await request(app.getHttpServer())
      .patch(`/folders/${a.body.id}`)
      .set('Cookie', authCookie(user))
      .send({ parentId: b.body.id })
      .expect(400);
  });

  it('moves a document into a folder and lists it under that folder only', async () => {
    const folder = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/folders`)
      .set('Cookie', authCookie(user))
      .send({ name: 'F' });
    const doc = await prisma.document.create({
      data: { title: 'D', workspaceId, authorID: user.id },
    });
    await request(app.getHttpServer())
      .patch(`/documents/${doc.id}`)
      .set('Cookie', authCookie(user))
      .send({ folderId: folder.body.id })
      .expect(200);

    const inFolder = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/documents?folderId=${folder.body.id}`)
      .set('Cookie', authCookie(user))
      .expect(200);
    expect(inFolder.body.map((d: any) => d.id)).toContain(doc.id);

    const atRoot = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/documents`)
      .set('Cookie', authCookie(user))
      .expect(200);
    expect(atRoot.body.map((d: any) => d.id)).not.toContain(doc.id);
  });

  it('rejects moving a document into a folder from another workspace with 400', async () => {
    const otherWs = await createWorkspace(prisma, user.id);
    const otherFolder = await request(app.getHttpServer())
      .post(`/workspaces/${otherWs.id}/folders`)
      .set('Cookie', authCookie(user))
      .send({ name: 'X' });
    const doc = await prisma.document.create({
      data: { title: 'D2', workspaceId, authorID: user.id },
    });
    await request(app.getHttpServer())
      .patch(`/documents/${doc.id}`)
      .set('Cookie', authCookie(user))
      .send({ folderId: otherFolder.body.id })
      .expect(400);
  });
});
