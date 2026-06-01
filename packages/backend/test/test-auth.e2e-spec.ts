/**
 * HTTP-level gate test for /test/auth/login.
 *
 * Verifies the security-critical direction of the env gate: when
 * WAFFLEBASE_E2E_AUTH is unset, the route is not registered and POST
 * /test/auth/login returns 404. This locks the contract that a
 * production deploy (which never sets the env) cannot serve the
 * test-auth route.
 *
 * The complementary direction — "with the env set, the route returns
 * 200 and issues cookies" — is not tested here. NestJS's testing module
 * captures AuthModule's controllers metadata at first compile, and
 * `jest.isolateModulesAsync` doesn't work cleanly with @nestjs/core +
 * ThrottlerGuard's Reflector identity check. Rather than patch module
 * metadata in-process (which would mutate AuthModule for the rest of
 * the Jest run and only test the patch, not the env), we cover the
 * 200-path through the Playwright auth fixture: every e2e spec POSTs
 * /test/auth/login on first use, so a regression there fails the whole
 * Playwright lane.
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
} from './helpers/integration-helpers';

// Stub so the Yorkie gRPC client never dials.
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
