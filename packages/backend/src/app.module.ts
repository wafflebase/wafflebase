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
        autoLogging: process.env.NODE_ENV !== 'test',
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
      throttlers: [
        { name: 'default', ttl: 60_000, limit: 60 },
        { name: 'auth', ttl: 60_000, limit: 10 },
      ],
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
