import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as bodyParser from 'body-parser';
import * as cookieParser from 'cookie-parser';
import type { IncomingMessage } from 'http';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/**
 * JSON body cap. The default Express limit (100kB) is too small for the
 * `PUT /api/v1/.../documents/:id/content` endpoint — the CLI's docx
 * importer emits inline `data:` URLs for embedded images, so a single
 * screenshot easily blows past the default. 25MB matches the practical
 * docx file ceiling and keeps malicious-payload exposure bounded.
 *
 * Override with `BACKEND_JSON_BODY_LIMIT` (e.g., `'50mb'`) when a
 * specific install needs more headroom; the value is passed verbatim to
 * `body-parser`.
 */
const JSON_BODY_LIMIT = process.env.BACKEND_JSON_BODY_LIMIT ?? '25mb';

/**
 * Routes whose raw request bytes must be retained for the Yorkie webhook HMAC
 * check — the event webhook (`document/yorkie-event.controller.ts`) and the
 * auth webhook (`document/yorkie-auth.controller.ts`). Both live under
 * `/internal/yorkie/`, so a prefix match covers them (and any future one).
 */
const YORKIE_WEBHOOK_PATH_PREFIX = '/internal/yorkie/';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Trust the upstream proxy hop count from BACKEND_TRUST_PROXY so
  // req.ip resolves to the real client IP (rate limiter and audit
  // logging key off this). Defaults to 0 — turning on `trust proxy`
  // without a real proxy in front lets a client spoof X-Forwarded-For
  // and bypass per-IP limits. Set to 1 (typical: nginx, Cloudflare
  // single hop) when deploying behind an edge that strips client XFF.
  const trustProxy = Number(process.env.BACKEND_TRUST_PROXY ?? '0');
  if (Number.isFinite(trustProxy) && trustProxy > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }
  // Stash the raw request bytes so the Yorkie event-webhook guard can verify
  // its HMAC signature over the exact payload (a re-serialized object would
  // not match). Scoped to the webhook path only: retaining the buffer on every
  // JSON request would roughly double peak memory on the 25MB content-import
  // routes, which never need it.
  app.use(
    bodyParser.json({
      limit: JSON_BODY_LIMIT,
      verify: (req: IncomingMessage & { rawBody?: Buffer }, _res, buf) => {
        if (req.url?.split('?', 1)[0].startsWith(YORKIE_WEBHOOK_PATH_PREFIX)) {
          req.rawBody = buf;
        }
      },
    }),
  );
  app.use(bodyParser.urlencoded({ limit: JSON_BODY_LIMIT, extended: true }));
  // Analytics beacons post their JSON payload as text/plain (a CORS-safelisted
  // content type) so navigator.sendBeacon / keepalive fetch skip the
  // cross-origin preflight the beacon transport cannot perform. The analytics
  // controller JSON-parses the string body itself.
  app.use(bodyParser.text({ type: 'text/plain', limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableCors({
    origin: [process.env.FRONTEND_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
