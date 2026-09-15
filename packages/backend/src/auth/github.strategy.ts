import { Injectable, UnauthorizedException } from '@nestjs/common';
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

/**
 * One row of `GET /user/emails`, as `allRawEmails` hands it over —
 * `passport-github2` renames `email` to `value` and leaves the rest alone.
 * The typings only promise `value`, so the flags are read defensively.
 */
interface GitHubEmail {
  value?: string;
  primary?: unknown;
  verified?: unknown;
}

/** `true` and the string `"true"`, and nothing else. */
function isFlagSet(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

/**
 * The address to sign in with: GitHub's primary one, **but only if GitHub
 * says it is verified**.
 *
 * This is an authentication check, not a nicety. `UserService
 * .findOrCreateUser()` matches on email alone, so the address is the shared
 * identity across providers — an unverified GitHub address that happens to
 * equal a Google-created account's email would sign its holder straight into
 * that account. `GoogleStrategy` refuses an unverified address for exactly
 * that reason, and a merge point is only as strong as its weaker side.
 *
 * It used to be assumed rather than checked, on the belief that the
 * `user:email` scope returns verified addresses only. It does not: `GET
 * /user/emails` returns every address on the account with a `verified` flag,
 * and an unverified one can be — and by default is — the primary. Nothing
 * here or upstream enforced the belief, so the flag is read.
 *
 * Reading it needs `allRawEmails: true` below: without it `passport-github2`
 * collapses the response to `[{ value: <primary> }]`, dropping the very flag
 * this decision turns on.
 *
 * Primary first, then any other verified address, so an account whose
 * primary is unverified still signs in under an address it owns rather than
 * being locked out.
 */
function verifiedEmail(profile: Profile): string | undefined {
  const emails = (profile.emails ?? []) as GitHubEmail[];
  const verified = emails.filter(
    (e) => typeof e.value === 'string' && e.value !== '' && isFlagSet(e.verified),
  );
  const chosen = verified.find((e) => isFlagSet(e.primary)) ?? verified[0];
  return chosen?.value;
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
      // Hand `validate` every address with its `verified` / `primary` flags
      // rather than the bare primary value. `verifiedEmail` above is what
      // needs them, and the default shape drops them.
      allRawEmails: true,
    });
  }

  /**
   * Forward the `state` parameter `GitHubAuthGuard` attached to the
   * request. Both login paths have one — a `CliAuthStore` token for the
   * CLI, a double-submit cookie hash for the browser — and the callback
   * rejects a request that arrives without it, so a login that reached
   * GitHub stateless would be a login that can never come back. Anything
   * without the flag is not a login start (no guard ran), so it is left
   * to passport's own handling rather than given a state here.
   */
  authenticate(req: Request, options?: Record<string, unknown>) {
    const opts = { ...options };
    const state = (req as { __oauthState?: string }).__oauthState;
    if (state) {
      opts.state = state;
    }
    super.authenticate(req, opts);
  }

  validate(accessToken: string, _refreshToken: string, profile: Profile) {
    const { id, username, photos } = profile;
    const email = verifiedEmail(profile);

    // Refused rather than signed in without one, the same way the Google
    // side is: the email is the account identity `findOrCreateUser` matches
    // on, so signing in without a verified one is what would let an address
    // somebody merely typed into GitHub reach an existing account.
    if (!email) {
      throw new UnauthorizedException(
        'GitHub account has no verified email address. Verify one with ' +
          'GitHub and try again.',
      );
    }

    return {
      authProvider: 'github',
      githubId: id,
      username,
      email,
      photo: photos?.[0]?.value,
      accessToken,
    };
  }
}
