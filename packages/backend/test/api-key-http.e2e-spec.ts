import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import { YorkieService } from 'src/yorkie/yorkie.service';
import * as cookieParser from 'cookie-parser';
import {
  describeDb,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
} from './helpers/integration-helpers';

describeDb('API Key HTTP integration', () => {
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
        sub: user.id,
        username: user.username,
        email: user.email,
        photo: user.photo,
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
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);
    createUser = createUserFactory(prisma, 'apikey');
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

  it('full lifecycle: create, list, use as Bearer token, revoke', async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const doc = await prisma.document.create({
      data: {
        title: 'API test doc',
        authorID: owner.id,
        workspaceId: workspace.id,
      },
    });

    // Create API key
    const createRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.id}/api-keys`)
      .set('Cookie', authCookie(owner))
      .send({ name: 'CI key' })
      .expect(201);

    expect(createRes.body.key).toMatch(/^wfb_/);
    expect(createRes.body.name).toBe('CI key');
    expect(createRes.body.prefix).toBe(createRes.body.key.slice(0, 8));
    const rawKey = createRes.body.key;
    const keyId = createRes.body.id;

    // List API keys
    const listRes = await request(app.getHttpServer())
      .get(`/workspaces/${workspace.id}/api-keys`)
      .set('Cookie', authCookie(owner))
      .expect(200);

    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].name).toBe('CI key');
    // Raw key should NOT be in list response
    expect(listRes.body[0].key).toBeUndefined();

    // Use API key as Bearer token on v1 documents endpoint
    const docsRes = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspace.id}/documents`)
      .set('Authorization', `Bearer ${rawKey}`)
      .expect(200);

    expect(docsRes.body).toHaveLength(1);
    expect(docsRes.body[0].id).toBe(doc.id);

    // API key should be rejected for wrong workspace
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/wrong-workspace-id/documents`)
      .set('Authorization', `Bearer ${rawKey}`)
      .expect(404);

    // Revoke API key
    await request(app.getHttpServer())
      .delete(`/workspaces/${workspace.id}/api-keys/${keyId}`)
      .set('Cookie', authCookie(owner))
      .expect(200);

    // Revoked key should be rejected
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspace.id}/documents`)
      .set('Authorization', `Bearer ${rawKey}`)
      .expect(401);
  });

  it('rejects API key management for non-owners', async () => {
    const owner = await createUser();
    const member = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: member.id, role: 'member' },
    });

    // Member cannot create API keys
    await request(app.getHttpServer())
      .post(`/workspaces/${workspace.id}/api-keys`)
      .set('Cookie', authCookie(member))
      .send({ name: 'unauthorized' })
      .expect(403);

    // Member can list API keys
    await request(app.getHttpServer())
      .get(`/workspaces/${workspace.id}/api-keys`)
      .set('Cookie', authCookie(member))
      .expect(200);
  });

  it('v1 documents endpoint works with JWT auth too', async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    await prisma.document.create({
      data: {
        title: 'JWT doc',
        authorID: owner.id,
        workspaceId: workspace.id,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspace.id}/documents`)
      .set('Cookie', authCookie(owner))
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('JWT doc');
  });

  it('v1 document CRUD via API key', async () => {
    const owner = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);

    const keyRes = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.id}/api-keys`)
      .set('Cookie', authCookie(owner))
      .send({ name: 'crud-key' })
      .expect(201);
    const bearerHeader = `Bearer ${keyRes.body.key}`;
    const base = `/api/v1/workspaces/${workspace.id}/documents`;

    // Create
    const createRes = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', bearerHeader)
      .send({ title: 'API doc' })
      .expect(201);

    const docId = createRes.body.id;
    expect(createRes.body.title).toBe('API doc');

    // Get
    const getRes = await request(app.getHttpServer())
      .get(`${base}/${docId}`)
      .set('Authorization', bearerHeader)
      .expect(200);

    expect(getRes.body.title).toBe('API doc');

    // Update
    const patchRes = await request(app.getHttpServer())
      .patch(`${base}/${docId}`)
      .set('Authorization', bearerHeader)
      .send({ title: 'Updated doc' })
      .expect(200);

    expect(patchRes.body.title).toBe('Updated doc');

    // Delete
    await request(app.getHttpServer())
      .delete(`${base}/${docId}`)
      .set('Authorization', bearerHeader)
      .expect(200);

    // Verify deleted
    await request(app.getHttpServer())
      .get(`${base}/${docId}`)
      .set('Authorization', bearerHeader)
      .expect(404);
  });
});
