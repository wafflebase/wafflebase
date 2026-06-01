import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from '../user/user.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type ms from 'ms';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CliAuthStore } from './cli-auth.store';
import { GitHubAuthGuard } from './github-auth.guard';
import { GitHubStrategy } from './github.strategy';
import { JwtStrategy } from './jwt.strategy';
import { TestAuthController } from './test-auth.controller';

const TEST_AUTH_ENABLED = process.env.WAFFLEBASE_E2E_AUTH === '1';

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
  controllers: [
    AuthController,
    ...(TEST_AUTH_ENABLED ? [TestAuthController] : []),
  ],
  providers: [AuthService, CliAuthStore, GitHubAuthGuard, JwtStrategy, GitHubStrategy],
})
export class AuthModule {
  constructor() {
    if (TEST_AUTH_ENABLED) {
      console.warn('[test-auth] DEV-ONLY ROUTES ENABLED (WAFFLEBASE_E2E_AUTH=1)');
    }
  }
}
