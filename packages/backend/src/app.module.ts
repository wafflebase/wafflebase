import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { DocumentModule } from './document/document.module';
import { ShareLinkModule } from './share-link/share-link.module';
import { DataSourceModule } from './datasource/datasource.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { YorkieModule } from './yorkie/yorkie.module';
import { ApiV1Module } from './api/v1/api-v1.module';
import { ImageModule } from './image/image.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging:
          process.env.NODE_ENV === 'test'
            ? false
            : {
                // Liveness / readiness probes fire every few seconds and
                // are not interesting at info level — skip to keep the
                // signal-to-noise ratio sane.
                ignore: (req) =>
                  req.url === '/health' || req.url === '/health/ready',
              },
        // Default access log → debug (silent at info). Only destructive
        // operations stay at info so the audit trail still surfaces.
        // 5xx pages on-call, 4xx warns. Meaningful business events
        // (document.create, login success, datasource.test, etc.) should
        // be emitted explicitly from service code as info, not relied on
        // from this generic access log.
        customLogLevel: (req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          if (req.method === 'DELETE') return 'info';
          return 'debug';
        },
        // Slim request/response shape: pino-http's default serializer
        // dumps every header (sec-ch-ua-*, accept-encoding, if-none-match,
        // etc.) and inflates each log line. Keep only what's useful for
        // an access log; full headers stay reachable via debug if needed.
        serializers: {
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            remoteAddress: req.remoteAddress,
            userAgent: req.headers?.['user-agent'],
          }),
          res: (res) => ({
            statusCode: res.statusCode,
          }),
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[redacted]',
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              },
      },
    }),
    ThrottlerModule.forRoot({
      // Single bucket: named throttlers stack across every route, so a
      // second strict bucket would cap all routes at the lowest limit.
      // Auth routes tighten per-route via @Throttle; image routes raise
      // the ceiling to absorb doc-open upload/fetch bursts.
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    AuthModule,
    DocumentModule,
    ShareLinkModule,
    DataSourceModule,
    WorkspaceModule,
    ApiKeyModule,
    YorkieModule,
    ApiV1Module,
    ImageModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
