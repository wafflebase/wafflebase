import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from '../user/user.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type ms from 'ms';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CliAuthStore } from './cli-auth.store';
import { CliLoginConfirmMiddleware } from './cli-login-confirm.middleware';
import { GitHubAuthGuard } from './github-auth.guard';
import { GitHubStrategy } from './github.strategy';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    ConfigModule.forRoot(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn:
            (configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '1h') as ms.StringValue,
        },
      }),
      inject: [ConfigService],
    }),
    UserModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, CliAuthStore, GitHubAuthGuard, JwtStrategy, GitHubStrategy],
  exports: [AuthService],
})
export class AuthModule implements NestModule {
  /**
   * The CLI confirmation page has to answer `GET /auth/github` *before*
   * the OAuth redirect is issued, and middleware is the only layer that
   * runs ahead of the guard, so it lives here rather than in the guard.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CliLoginConfirmMiddleware)
      .forRoutes({ path: 'auth/github', method: RequestMethod.GET });
  }
}
