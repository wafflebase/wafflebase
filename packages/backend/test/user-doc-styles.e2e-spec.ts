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
  clearDatabase,
  createUserFactory,
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
} from './helpers/integration-helpers';

describeDb('User doc styles HTTP integration (JWT + controller + Prisma)', () => {
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
    createUser = createUserFactory(prisma, 'doc-styles');
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

  it('rejects doc-styles routes without a JWT cookie', async () => {
    await request(app.getHttpServer()).get('/auth/me/doc-styles').expect(401);
    await request(app.getHttpServer())
      .put('/auth/me/doc-styles')
      .send({ styles: {} })
      .expect(401);
  });

  it('returns an empty object when nothing is saved', async () => {
    const user = await createUser();

    const response = await request(app.getHttpServer())
      .get('/auth/me/doc-styles')
      .set('Cookie', authCookie(user))
      .expect(200);

    expect(response.body).toEqual({ styles: {} });
  });

  it('round-trips a saved styles blob through PUT then GET', async () => {
    const user = await createUser();
    const styles = { 'heading-1': { inline: { fontSize: 30 } } };

    const putResponse = await request(app.getHttpServer())
      .put('/auth/me/doc-styles')
      .set('Cookie', authCookie(user))
      .send({ styles })
      .expect(200);

    expect(putResponse.body).toEqual({ styles });

    const getResponse = await request(app.getHttpServer())
      .get('/auth/me/doc-styles')
      .set('Cookie', authCookie(user))
      .expect(200);

    expect(getResponse.body).toEqual({ styles });
  });

  it('rejects a PUT whose body is missing the styles field', async () => {
    const user = await createUser();
    await request(app.getHttpServer())
      .put('/auth/me/doc-styles')
      .set('Cookie', authCookie(user))
      .send({})
      .expect(400);
  });

  it('rejects a PUT whose styles is not a plain object', async () => {
    const user = await createUser();
    await request(app.getHttpServer())
      .put('/auth/me/doc-styles')
      .set('Cookie', authCookie(user))
      .send({ styles: [] })
      .expect(400);
  });

  it('overwrites an existing styles blob on a second PUT', async () => {
    const user = await createUser();

    await request(app.getHttpServer())
      .put('/auth/me/doc-styles')
      .set('Cookie', authCookie(user))
      .send({ styles: { 'heading-1': { inline: { fontSize: 30 } } } })
      .expect(200);

    const updated = { 'heading-2': { inline: { fontSize: 18 } } };
    await request(app.getHttpServer())
      .put('/auth/me/doc-styles')
      .set('Cookie', authCookie(user))
      .send({ styles: updated })
      .expect(200);

    const getResponse = await request(app.getHttpServer())
      .get('/auth/me/doc-styles')
      .set('Cookie', authCookie(user))
      .expect(200);

    expect(getResponse.body).toEqual({ styles: updated });
  });
});
