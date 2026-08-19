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
    // github.com defaults. Point all four at a GHE instance to log in
    // against it instead, e.g. for host `ghe.example.com`:
    //   GITHUB_AUTHORIZATION_URL=https://ghe.example.com/login/oauth/authorize
    //   GITHUB_TOKEN_URL=https://ghe.example.com/login/oauth/access_token
    //   GITHUB_USER_PROFILE_URL=https://ghe.example.com/api/v3/user
    //   GITHUB_USER_EMAIL_URL=https://ghe.example.com/api/v3/user/emails
    // The email URL is separate: with the `user:email` scope, passport-github2
    // fetches emails from its own default (api.github.com) unless overridden,
    // so a GHE token would hit github.com and fail with "Bad credentials".
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
      ...optional('userEmailURL', configService.get('GITHUB_USER_EMAIL_URL')),
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
   * Override authenticate to send the OAuth `state` parameter for the flow
   * `GitHubAuthGuard` opened (it runs first and puts the token on the request).
   *
   * passport-oauth2 sends no `state` unless one is supplied, and the callback
   * is what validates it — see `GitHubAuthGuard` and
   * `AuthController.githubAuthCallback`. Both the browser and the CLI login go
   * through the guard, so both carry a state token; a request that somehow
   * reaches the strategy without one gets no `state` and is then refused at the
   * callback rather than silently completing an unprotected login.
   */
  authenticate(req: Request, options?: Record<string, unknown>) {
    const opts = { ...options };
    const stateToken = (req as { __oauthStateToken?: string })
      .__oauthStateToken;
    if (stateToken) {
      opts.state = stateToken;
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
