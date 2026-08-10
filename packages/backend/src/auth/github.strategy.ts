import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * `{ [key]: value }` when `value` is set, otherwise `{}`. Lets an unset config
 * var fall through to a library default instead of overriding it with
 * `undefined`.
 */
function optional(key: string, value: unknown): Record<string, unknown> {
  return value ? { [key]: value } : {};
}

@Injectable()
export class GitHubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(configService: ConfigService) {
    // Optional GitHub Enterprise endpoints. Unset → passport-github2's
    // github.com defaults. Point all three at a GHE instance to log in
    // against it instead, e.g. for host `ghe.example.com`:
    //   GITHUB_AUTHORIZATION_URL=https://ghe.example.com/login/oauth/authorize
    //   GITHUB_TOKEN_URL=https://ghe.example.com/login/oauth/access_token
    //   GITHUB_USER_PROFILE_URL=https://ghe.example.com/api/v3/user
    // Spread so an unset var falls through to the library default rather than
    // overriding it with `undefined`.
    const enterpriseEndpoints = {
      ...optional(
        'authorizationURL',
        configService.get('GITHUB_AUTHORIZATION_URL'),
      ),
      ...optional('tokenURL', configService.get('GITHUB_TOKEN_URL')),
      ...optional(
        'userProfileURL',
        configService.get('GITHUB_USER_PROFILE_URL'),
      ),
    };
    super({
      clientID: configService.get('GITHUB_CLIENT_ID')!,
      clientSecret: configService.get('GITHUB_CLIENT_SECRET')!,
      callbackURL: configService.get('GITHUB_CALLBACK_URL')!,
      ...enterpriseEndpoints,
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
    const cliState = (req as { __cliStateToken?: string }).__cliStateToken;
    if (cliState) {
      opts.state = cliState;
    }
    super.authenticate(req, opts);
  }

  validate(accessToken: string, _refreshToken: string, profile: Profile) {
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
