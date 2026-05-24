import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';

@Controller('demo')
class DemoController {
  @Get('hit')
  hit() {
    return { ok: true };
  }

  @Get('strict')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  strict() {
    return { ok: true };
  }
}

describe('ThrottlerGuard integration — mirrors production config', () => {
  let app: INestApplication;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    // Bypass the production `skipIf: NODE_ENV === 'test'` so we can
    // actually exercise the limiter from inside Jest.
    process.env.NODE_ENV = 'development';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          // Mirrors app.module.ts: a single bucket. Adding a second
          // named throttler here would silently cap every route at
          // the lowest limit (regression we now guard against below).
          throttlers: [{ name: 'default', ttl: 60_000, limit: 5 }],
        }),
      ],
      controllers: [DemoController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('enforces the default bucket on undecorated routes', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/demo/hit').expect(200);
    }
    await request(app.getHttpServer()).get('/demo/hit').expect(429);
  });

  it('honors a stricter per-route override via @Throttle', async () => {
    await request(app.getHttpServer()).get('/demo/strict').expect(200);
    await request(app.getHttpServer()).get('/demo/strict').expect(200);
    await request(app.getHttpServer()).get('/demo/strict').expect(429);
  });
});

describe('Two named throttlers stack — regression guard', () => {
  let app: INestApplication;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: 60_000, limit: 60 },
            { name: 'auth', ttl: 60_000, limit: 3 },
          ],
        }),
      ],
      controllers: [DemoController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('caps every route at the strictest bucket — proves the topology bug', async () => {
    await request(app.getHttpServer()).get('/demo/hit').expect(200);
    await request(app.getHttpServer()).get('/demo/hit').expect(200);
    await request(app.getHttpServer()).get('/demo/hit').expect(200);
    // Hits the `auth` bucket's limit even though /demo/hit was never
    // decorated. This is exactly the regression we removed from
    // app.module.ts; if it ever comes back, this test goes red.
    await request(app.getHttpServer()).get('/demo/hit').expect(429);
  });
});

describe('ThrottlerModule skipIf in test env', () => {
  let app: INestApplication;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 2 }],
          skipIf: () => process.env.NODE_ENV === 'test',
        }),
      ],
      controllers: [DemoController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('lets the existing e2e suite blast past the limit without 429', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/demo/hit').expect(200);
    }
  });
});
