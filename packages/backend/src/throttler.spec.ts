import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';

@Controller('demo')
class DemoController {
  @Get('hit')
  hit() {
    return { ok: true };
  }
}

describe('ThrottlerGuard integration', () => {
  let app: INestApplication;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    // Bypass the production `skipIf: NODE_ENV === 'test'` so we can
    // actually exercise the limiter from inside Jest.
    process.env.NODE_ENV = 'development';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 2 }],
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

  it('returns 429 once the per-IP burst limit is exceeded', async () => {
    await request(app.getHttpServer()).get('/demo/hit').expect(200);
    await request(app.getHttpServer()).get('/demo/hit').expect(200);
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
