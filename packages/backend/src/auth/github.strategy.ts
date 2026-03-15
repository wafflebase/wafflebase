import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class GitHubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get('GITHUB_CLIENT_ID')!,
      clientSecret: configService.get('GITHUB_CLIENT_SECRET')!,
      callbackURL: configService.get('GITHUB_CALLBACK_URL')!,
      scope: ['user:email', 'user:avatar'],
    });
  }

  /**
   * Override authenticate to inject a custom `state` parameter when the
   * request carries a CLI state token (set by AuthController before the
   * guard runs).
   */
  authenticate(req: Request, options?: Record<string, unknown>) {
    const opts = { ...options };
    const cliState = (req as any).__cliStateToken as string | undefined;
    if (cliState) {
      opts.state = cliState;
    }
    super.authenticate(req, opts);
  }

  async validate(accessToken: string, _refreshToken: string, profile: Profile) {
    const { id, username, emails, photos } = profile;

    return {
      authProvider: 'github',
      githubId: id,
      username,
      email: emails?.[0]?.value,
      photo: photos?.[0]?.value,
      accessToken,
    };
  }
}
