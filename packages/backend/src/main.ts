import { NestFactory } from '@nestjs/core';
import * as bodyParser from 'body-parser';
import * as cookieParser from 'cookie-parser';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(bodyParser.json({ limit: JSON_BODY_LIMIT }));
  app.use(bodyParser.urlencoded({ limit: JSON_BODY_LIMIT, extended: true }));
  app.use(cookieParser());
  app.enableCors({
    origin: [process.env.FRONTEND_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
