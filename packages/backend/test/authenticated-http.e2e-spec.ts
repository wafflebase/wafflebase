import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/database/prisma.service';
import * as cookieParser from 'cookie-parser';
import {
  describeDb,
  parseDatabaseUrl,
  clearDatabase,
  createUserFactory,
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

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
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

    const createResponse = await request(app.getHttpServer())
      .post('/documents')
      .set('Cookie', authCookie(owner))
      .send({ title: 'Owner document' })
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

  it('enforces share-link owner permissions and supports public token resolve', async () => {
    const owner = await createUser();
    const other = await createUser();
    const doc = await prisma.document.create({
      data: {
        title: 'Shared roadmap',
        authorID: owner.id,
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
    });
  });

  it('runs datasource routes end-to-end with auth and ownership checks', async () => {
    const owner = await createUser();
    const other = await createUser();
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
});
