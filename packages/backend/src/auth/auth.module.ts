import {
  Logger,
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
import { GoogleStrategy } from './google.strategy';
import { JwtStrategy } from './jwt.strategy';
import {
  googleAuthConfigured,
  googleAuthPartiallyConfigured,
  missingGoogleAuthVars,
} from './oauth-providers';

/**
 * Google is registered only where it is configured.
 *
 * `passport-google-oauth20` throws `OAuth2Strategy requires a clientID
 * option` from its constructor, so providing `GoogleStrategy`
 * unconditionally would stop every deployment without a Google OAuth client
 * from booting at all — a new provider is not allowed to be an outage for
 * the installs that do not want it. `GoogleAuthGuard` answers `404` on the
 * routes in that case, and `GET /auth/providers` keeps the button off the
 * login page.
 *
 * A **factory**, not a `googleAuthConfigured() ? [GoogleStrategy] : []` at
 * module scope. That expression is evaluated when this file is imported,
 * which is strictly before `ConfigModule.forRoot()` below it — and before
 * `AppModule`'s global one — has read `packages/backend/.env` into
 * `process.env`. So on the documented `.env`-based setup the module saw no
 * Google vars and registered nothing, while `GET /auth/providers` and
 * `GoogleAuthGuard` answered the same question per request, *after* dotenv,
 * and happily offered the button: the login then died in passport with
 * `Unknown authentication strategy "google"`. A factory runs at injector
 * instantiation, by which time every source of configuration has loaded, so
 * all three answers come from one state of the environment.
 *
 * `null` rather than omitting the provider: a factory has to return
 * something, nothing injects `GoogleStrategy` by token (the routes use
 * `AuthGuard('google')`, which reads passport's own registry, and passport
 * only learns the strategy exists if this constructor runs), and an
 * unconstructed strategy registers nothing.
 */
const googleStrategyProvider = {
  provide: GoogleStrategy,
  useFactory: (configService: ConfigService): GoogleStrategy | null =>
    googleAuthConfigured() ? new GoogleStrategy(configService) : null,
  inject: [ConfigService],
};

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
  providers: [
    AuthService,
    CliAuthStore,
    GitHubAuthGuard,
    JwtStrategy,
    GitHubStrategy,
    googleStrategyProvider,
  ],
  exports: [AuthService],
})
export class AuthModule implements NestModule {
  /**
   * Say so when Google is *half* configured.
   *
   * The symptom otherwise is a button that never appears and a route that
   * answers 404, with nothing anywhere saying which variable is missing —
   * the one failure mode of making the provider optional.
   */
  constructor() {
    if (googleAuthPartiallyConfigured()) {
      new Logger(AuthModule.name).warn(
        `Google sign-in is disabled: ${missingGoogleAuthVars().join(', ')} ` +
          'not set. Set all of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ' +
          'GOOGLE_CALLBACK_URL to enable it.',
      );
    }
  }

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
