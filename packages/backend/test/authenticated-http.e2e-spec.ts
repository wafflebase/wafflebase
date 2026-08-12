import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import { YorkieService } from 'src/yorkie/yorkie.service';
import { YorkieAdminService } from 'src/yorkie/yorkie-admin.service';
import * as cookieParser from 'cookie-parser';
import {
  applyGlobalBootstrap,
  describeDb,
  parseDatabaseUrl,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
} from './helpers/integration-helpers';

describeDb('Authenticated HTTP integration (JWT + controllers + Prisma)', () => {
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
    jwtService = moduleRef.get(JwtService);
    createUser = createUserFactory(prisma, 'http');
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

  it('rejects protected routes without JWT cookie', async () => {
    await request(app.getHttpServer()).get('/documents').expect(401);
    await request(app.getHttpServer()).get('/datasources').expect(401);
  });

  it('enforces document ownership through JWT-authenticated endpoints', async () => {
    const owner = await createUser();
    const other = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);

    const createResponse = await request(app.getHttpServer())
      .post('/documents')
      .set('Cookie', authCookie(owner))
      .send({ title: 'Owner document', workspaceId: workspace.id })
      .expect(201);

    const ownerDocId = createResponse.body.id as string;
    expect(createResponse.body.authorID).toBe(owner.id);

    const listResponse = await request(app.getHttpServer())
      .get('/documents')
      .set('Cookie', authCookie(owner))
      .expect(200);

    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].id).toBe(ownerDocId);

    await request(app.getHttpServer())
      .get(`/documents/${ownerDocId}`)
      .set('Cookie', authCookie(other))
      .expect(403);
  });

  it('reserves document delete/move to owner or author, but rename to any member', async () => {
    const owner = await createUser();
    const member = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: member.id, role: 'member' },
    });
    const other = await createWorkspace(prisma, member.id); // move destination

    const doc = await prisma.document.create({
      data: {
        title: 'Owner roadmap',
        authorID: owner.id,
        workspaceId: workspace.id,
      },
    });

    // The list annotates canManage per row: true for the owner, false for a
    // plain member who is not the author.
    const ownerList = await request(app.getHttpServer())
      .get('/documents')
      .set('Cookie', authCookie(owner))
      .expect(200);
    expect(ownerList.body.find((d: { id: string }) => d.id === doc.id).canManage).toBe(true);

    const memberList = await request(app.getHttpServer())
      .get('/documents')
      .set('Cookie', authCookie(member))
      .expect(200);
    expect(memberList.body.find((d: { id: string }) => d.id === doc.id).canManage).toBe(false);

    // A plain member may rename…
    await request(app.getHttpServer())
      .patch(`/documents/${doc.id}`)
      .set('Cookie', authCookie(member))
      .send({ title: 'Renamed by member' })
      .expect(200);

    // …but not move…
    await request(app.getHttpServer())
      .patch(`/documents/${doc.id}`)
      .set('Cookie', authCookie(member))
      .send({ workspaceId: other.id })
      .expect(403);

    // …nor delete.
    await request(app.getHttpServer())
      .delete(`/documents/${doc.id}`)
      .set('Cookie', authCookie(member))
      .expect(403);

    // The owner can delete.
    await request(app.getHttpServer())
      .delete(`/documents/${doc.id}`)
      .set('Cookie', authCookie(owner))
      .expect(200);
  });

  it('enforces share-link owner permissions and supports public token resolve', async () => {
    const owner = await createUser();
    const other = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const doc = await prisma.document.create({
      data: {
        title: 'Shared roadmap',
        authorID: owner.id,
        workspaceId: workspace.id,
      },
    });

    const createLinkResponse = await request(app.getHttpServer())
      .post(`/documents/${doc.id}/share-links`)
      .set('Cookie', authCookie(owner))
      .send({ role: 'viewer', expiration: '1h' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/documents/${doc.id}/share-links`)
      .set('Cookie', authCookie(other))
      .expect(403);

    const resolveResponse = await request(app.getHttpServer())
      .get(`/share-links/${createLinkResponse.body.token}/resolve`)
      .expect(200);

    expect(resolveResponse.body).toEqual({
      documentId: doc.id,
      role: 'viewer',
      title: 'Shared roadmap',
      type: 'sheet',
    });
  });

  it('runs datasource routes end-to-end with auth and ownership checks', async () => {
    const owner = await createUser();
    const other = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

    const createDsResponse = await request(app.getHttpServer())
      .post('/datasources')
      .set('Cookie', authCookie(owner))
      .send({
        name: 'primary',
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        username: pgConfig.username,
        password: pgConfig.password,
        sslEnabled: false,
        workspaceId: workspace.id,
      })
      .expect(201);

    const dsId = createDsResponse.body.id as string;
    const persisted = await prisma.dataSource.findUniqueOrThrow({
      where: { id: dsId },
    });
    expect(persisted.password).not.toBe(pgConfig.password);

    const getDsResponse = await request(app.getHttpServer())
      .get(`/datasources/${dsId}`)
      .set('Cookie', authCookie(owner))
      .expect(200);
    expect(getDsResponse.body.password).toBe('********');

    await request(app.getHttpServer())
      .post(`/datasources/${dsId}/query`)
      .set('Cookie', authCookie(other))
      .send({ query: 'SELECT 1::int4 AS n' })
      .expect(403);

    const queryResponse = await request(app.getHttpServer())
      .post(`/datasources/${dsId}/query`)
      .set('Cookie', authCookie(owner))
      .send({ query: 'SELECT 1::int4 AS n' })
      .expect(201);

    expect(queryResponse.body.rows).toEqual([{ n: 1 }]);
    expect(queryResponse.body.rowCount).toBe(1);
    expect(queryResponse.body.truncated).toBe(false);
  });

  it('tests connection settings without persisting a datasource', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const workspace = await createWorkspace(prisma, member.id);
    const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

    const payload = {
      host: pgConfig.host,
      port: pgConfig.port,
      database: pgConfig.database,
      username: pgConfig.username,
      password: pgConfig.password,
      sslEnabled: false,
    };

    await request(app.getHttpServer())
      .post(`/workspaces/${workspace.id}/datasources/test`)
      .set('Cookie', authCookie(outsider))
      .send(payload)
      .expect(403);

    const okResponse = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.id}/datasources/test`)
      .set('Cookie', authCookie(member))
      .send(payload)
      .expect(201);
    expect(okResponse.body).toEqual({ success: true });

    // A failure reports its cause rather than an empty string, which is what
    // the dialog used to show when connect() rejected with an AggregateError.
    const failResponse = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.id}/datasources/test`)
      .set('Cookie', authCookie(member))
      .send({ ...payload, database: 'no-such-database-wafflebase' })
      .expect(201);
    expect(failResponse.body.success).toBe(false);
    expect(failResponse.body.error).toBeTruthy();

    // The whole point: testing writes nothing.
    expect(
      await prisma.dataSource.count({ where: { workspaceId: workspace.id } }),
    ).toBe(0);
  });

  it('runs bigquery source routes end-to-end with auth and ownership checks', async () => {
    const owner = await createUser();
    const other = await createUser();
    const workspace = await createWorkspace(prisma, owner.id);
    const credentials = JSON.stringify({
      type: 'service_account',
      project_id: 'my-project',
      client_email: 'sa@my-project.iam.gserviceaccount.com',
      private_key: 'fake-key',
    });

    const createResponse = await request(app.getHttpServer())
      .post(`/workspaces/${workspace.id}/bigquery`)
      .set('Cookie', authCookie(owner))
      .send({
        name: 'analytics',
        projectId: 'my-project',
        dataset: 'analytics',
        location: 'US',
        credentials,
      })
      .expect(201);

    const sourceId = createResponse.body.id as string;
    const persisted = await prisma.bigQuerySource.findUniqueOrThrow({
      where: { id: sourceId },
    });
    expect(persisted.credentials).not.toBe(credentials);

    const getResponse = await request(app.getHttpServer())
      .get(`/bigquery/${sourceId}`)
      .set('Cookie', authCookie(owner))
      .expect(200);
    expect(getResponse.body.credentials).toBe('********');

    await request(app.getHttpServer())
      .get(`/bigquery/${sourceId}`)
      .set('Cookie', authCookie(other))
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/bigquery/${sourceId}`)
      .set('Cookie', authCookie(other))
      .send({ name: 'renamed' })
      .expect(403);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/bigquery/${sourceId}`)
      .set('Cookie', authCookie(owner))
      .send({ name: 'renamed' })
      .expect(200);
    expect(updateResponse.body.name).toBe('renamed');

    const listResponse = await request(app.getHttpServer())
      .get(`/workspaces/${workspace.id}/bigquery`)
      .set('Cookie', authCookie(owner))
      .expect(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].credentials).toBe('********');

    await request(app.getHttpServer())
      .delete(`/bigquery/${sourceId}`)
      .set('Cookie', authCookie(other))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/bigquery/${sourceId}`)
      .set('Cookie', authCookie(owner))
      .expect(200);

    expect(
      await prisma.bigQuerySource.findUnique({ where: { id: sourceId } }),
    ).toBeNull();
  });

  it('tests bigquery connection settings without persisting a source', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const workspace = await createWorkspace(prisma, member.id);

    const payload = {
      projectId: 'my-project',
      credentials: JSON.stringify({
        type: 'service_account',
        project_id: 'my-project',
      }),
    };

    await request(app.getHttpServer())
      .post(`/workspaces/${workspace.id}/bigquery/test`)
      .set('Cookie', authCookie(outsider))
      .send(payload)
      .expect(403);

    // Malformed credentials are rejected by DTO validation before the probe
    // ever runs, so this exercises the auth/DTO wiring without making a real
    // network call to Google. Live-probe behavior (success and failure) is
    // covered by unit tests (bigquery.service.spec.ts) with the client
    // mocked. A real-project integration lane, gated behind
    // RUN_BIGQUERY_INTEGRATION_TESTS per the design doc, is not implemented
    // yet — this DB-only e2e suite intentionally never exercises live
    // BigQuery.
    await request(app.getHttpServer())
      .post(`/workspaces/${workspace.id}/bigquery/test`)
      .set('Cookie', authCookie(member))
      .send({ ...payload, credentials: 'not-json' })
      .expect(400);

    // The whole point: testing writes nothing, even on a bad payload.
    expect(
      await prisma.bigQuerySource.count({ where: { workspaceId: workspace.id } }),
    ).toBe(0);
  });
});
