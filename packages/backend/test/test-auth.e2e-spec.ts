/**
 * HTTP-level gate tests for /test/auth/login.
 *
 * The env check (WAFFLEBASE_E2E_AUTH=1) is evaluated at NestJS module
 * construction time, so each describe block compiles AppModule with the env
 * in the required state. Jest runs describe blocks sequentially and honours
 * the order of beforeAll calls, so the 404 block (env unset) runs before the
 * 200 block (env set).
 *
 * The 200 case calls UserService.findOrCreateUser + Prisma; it is therefore
 * gated behind RUN_DB_INTEGRATION_TESTS via describeDb (same as other DB
 * e2e suites in this package).  The 404 case does not hit the DB and always
 * runs.
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from 'src/app.module';
import { YorkieService } from 'src/yorkie/yorkie.service';
import {
  setIntegrationEnvDefaults,
  setAuthEnvDefaults,
  applyGlobalBootstrap,
  describeDb,
} from './helpers/integration-helpers';

// Stub shared by both describe blocks so the Yorkie gRPC client never dials.
const yorkieStub = {
  onModuleInit: () => Promise.resolve(),
  onModuleDestroy: () => Promise.resolve(),
  withDocument: () => Promise.resolve(null),
};

// ── 404 case ─────────────────────────────────────────────────────────────────
// Module must be compiled while WAFFLEBASE_E2E_AUTH is absent.  Jest loads
// this file fresh (no prior import of AppModule), so as long as we compile
// before setting the env we get the unguarded module.
describe('Test auth route (e2e) — env gate OFF', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    // Ensure the flag is absent before AppModule is compiled.
    delete process.env.WAFFLEBASE_E2E_AUTH;
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YorkieService)
      .useValue(yorkieStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    applyGlobalBootstrap(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
  });

  it('returns 404 when WAFFLEBASE_E2E_AUTH is unset', async () => {
    await request(app.getHttpServer())
      .post('/test/auth/login')
      .send({ username: 'e2e-0', email: 'e2e-0@test.local' })
      .expect(404);
  });
});

// ── 200 case ─────────────────────────────────────────────────────────────────
// We need a *second* NestJS app compiled after WAFFLEBASE_E2E_AUTH=1 is set.
// AppModule is already loaded in the Jest module cache from the block above,
// but ts-jest caches at the JS level per require() call — re-importing the
// same path returns the cached module.  That means the TOP-LEVEL const
// TEST_AUTH_ENABLED in auth.module.ts was already evaluated with env unset.
//
// Using jest.isolateModulesAsync to force a fresh require() is the correct
// tool, but NestJS's TestingInjector breaks when @nestjs/core is loaded twice
// (Reflector class identity mismatch with ThrottlerGuard's APP_GUARD).
//
// Workaround: patch the cached AuthModule's controllers array directly before
// compiling the second app.  This is intentionally narrow — only the
// controllers list changes, nothing else in the DI graph.
describeDb('Test auth route (e2e) — env gate ON', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    process.env.WAFFLEBASE_E2E_AUTH = '1';
    setIntegrationEnvDefaults();
    setAuthEnvDefaults();

    // Force the cached AuthModule to include TestAuthController.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TestAuthController } = require('src/auth/test-auth.controller') as {
      TestAuthController: new (...args: unknown[]) => unknown;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AuthModule } = require('src/auth/auth.module') as {
      AuthModule: { prototype: unknown };
    };
    const meta: unknown[] = Reflect.getMetadata('controllers', AuthModule) ?? [];
    if (!meta.includes(TestAuthController)) {
      meta.push(TestAuthController);
      Reflect.defineMetadata('controllers', meta, AuthModule);
    }

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YorkieService)
      .useValue(yorkieStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    applyGlobalBootstrap(app);
    await app.init();
  });

  afterAll(async () => {
    delete process.env.WAFFLEBASE_E2E_AUTH;
    await app.close();
    await moduleRef.close();
  });

  it('returns 200 + auth cookies when WAFFLEBASE_E2E_AUTH=1', async () => {
    const res = await request(app.getHttpServer())
      .post('/test/auth/login')
      .send({ username: 'e2e-0', email: 'e2e-0@test.local' })
      .expect(200);

    expect(res.body).toEqual({ ok: true, userId: expect.any(Number) });
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies).toContain('wafflebase_session=');
    expect(cookies).toContain('wafflebase_refresh=');
  });
});
