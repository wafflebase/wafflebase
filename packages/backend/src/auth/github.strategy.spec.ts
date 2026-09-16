import { ConfigService } from '@nestjs/config';
import { GitHubStrategy } from './github.strategy';

function makeStrategy(values: Record<string, string>): GitHubStrategy {
  const config = {
    get: (k: string) => values[k],
  } as unknown as ConfigService;
  return new GitHubStrategy(config);
}

// passport-oauth2 stores the resolved endpoints on the underlying node-oauth
// client; passport-github2 keeps the profile URL on the strategy itself.
function endpoints(strategy: GitHubStrategy) {
  const s = strategy as unknown as {
    _oauth2: { _authorizeUrl: string; _accessTokenUrl: string };
    _userProfileURL: string;
    _userEmailURL: string;
  };
  return {
    authorize: s._oauth2._authorizeUrl,
    token: s._oauth2._accessTokenUrl,
    profile: s._userProfileURL,
    email: s._userEmailURL,
  };
}

const BASE = {
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
  GITHUB_CALLBACK_URL: 'http://localhost:3000/auth/github/callback',
};

describe('GitHubStrategy endpoints', () => {
  it('defaults to public github.com when no enterprise vars are set', () => {
    const { authorize, token, profile, email } = endpoints(makeStrategy(BASE));
    expect(authorize).toBe('https://github.com/login/oauth/authorize');
    expect(token).toBe('https://github.com/login/oauth/access_token');
    expect(profile).toBe('https://api.github.com/user');
    expect(email).toBe('https://api.github.com/user/emails');
  });

  it('uses the configured GitHub Enterprise endpoints when set', () => {
    const { authorize, token, profile, email } = endpoints(
      makeStrategy({
        ...BASE,
        GITHUB_AUTHORIZATION_URL:
          'https://ghe.example.com/login/oauth/authorize',
        GITHUB_TOKEN_URL: 'https://ghe.example.com/login/oauth/access_token',
        GITHUB_USER_PROFILE_URL: 'https://ghe.example.com/api/v3/user',
        GITHUB_USER_EMAIL_URL: 'https://ghe.example.com/api/v3/user/emails',
      }),
    );
    expect(authorize).toBe('https://ghe.example.com/login/oauth/authorize');
    expect(token).toBe('https://ghe.example.com/login/oauth/access_token');
    expect(profile).toBe('https://ghe.example.com/api/v3/user');
    expect(email).toBe('https://ghe.example.com/api/v3/user/emails');
  });

  // Each var is independent: overriding one must not disturb the others.
  const DEFAULTS = {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    profile: 'https://api.github.com/user',
    email: 'https://api.github.com/user/emails',
  };

  it('overrides only the authorization URL, others stay default', () => {
    const e = endpoints(
      makeStrategy({
        ...BASE,
        GITHUB_AUTHORIZATION_URL:
          'https://ghe.example.com/login/oauth/authorize',
      }),
    );
    expect(e.authorize).toBe('https://ghe.example.com/login/oauth/authorize');
    expect(e.token).toBe(DEFAULTS.token);
    expect(e.profile).toBe(DEFAULTS.profile);
    expect(e.email).toBe(DEFAULTS.email);
  });

  it('overrides only the token URL, others stay default', () => {
    const e = endpoints(
      makeStrategy({
        ...BASE,
        GITHUB_TOKEN_URL: 'https://ghe.example.com/login/oauth/access_token',
      }),
    );
    expect(e.token).toBe('https://ghe.example.com/login/oauth/access_token');
    expect(e.authorize).toBe(DEFAULTS.authorize);
    expect(e.profile).toBe(DEFAULTS.profile);
    expect(e.email).toBe(DEFAULTS.email);
  });

  it('overrides only the user-profile URL, others stay default', () => {
    const e = endpoints(
      makeStrategy({
        ...BASE,
        GITHUB_USER_PROFILE_URL: 'https://ghe.example.com/api/v3/user',
      }),
    );
    expect(e.profile).toBe('https://ghe.example.com/api/v3/user');
    expect(e.authorize).toBe(DEFAULTS.authorize);
    expect(e.token).toBe(DEFAULTS.token);
    expect(e.email).toBe(DEFAULTS.email);
  });

  it('overrides only the user-email URL, others stay default', () => {
    const e = endpoints(
      makeStrategy({
        ...BASE,
        GITHUB_USER_EMAIL_URL: 'https://ghe.example.com/api/v3/user/emails',
      }),
    );
    expect(e.email).toBe('https://ghe.example.com/api/v3/user/emails');
    expect(e.authorize).toBe(DEFAULTS.authorize);
    expect(e.token).toBe(DEFAULTS.token);
    expect(e.profile).toBe(DEFAULTS.profile);
  });
});

/**
 * The email is the identity `findOrCreateUser` matches on, shared with
 * Google, so an unverified GitHub address reaching it would be a way into an
 * account created through the other provider. `GET /user/emails` returns
 * unverified addresses too — including as the primary — so the flag is read
 * rather than assumed.
 */
describe('GitHubStrategy verified email', () => {
  function validate(emails: unknown) {
    return makeStrategy(BASE).validate('token', '', {
      id: '42',
      username: 'ada',
      emails,
      photos: [{ value: 'https://avatars.example/ada.png' }],
    } as never);
  }

  /** The profile half of the union, for the cases that sign in. */
  function signedIn(emails: unknown) {
    const result = validate(emails);
    if ('error' in result) {
      throw new Error(`expected a sign-in, got ${result.error}`);
    }
    return result;
  }

  // Without this the raw list never arrives: passport-github2 collapses the
  // response to `[{ value: <primary> }]` and drops every flag.
  it('asks GitHub for the raw email list', () => {
    expect(
      (makeStrategy(BASE) as unknown as { _allRawEmails: boolean })
        ._allRawEmails,
    ).toBe(true);
  });

  it('signs in under the primary verified address', () => {
    const user = signedIn([
      { value: 'old@example.com', primary: false, verified: true },
      { value: 'ada@example.com', primary: true, verified: true },
    ]);
    expect(user.email).toBe('ada@example.com');
  });

  // Locking such an account out would be worse than signing it in under an
  // address it demonstrably owns.
  it('falls back to another verified address when the primary is not', () => {
    const user = signedIn([
      { value: 'unverified@example.com', primary: true, verified: false },
      { value: 'ada@example.com', primary: false, verified: true },
    ]);
    expect(user.email).toBe('ada@example.com');
  });

  /**
   * Refused as a returned code, never a throw. A throw here happens inside
   * `AuthGuard('github')`, so it would answer with backend JSON and skip the
   * callback's `/login?error=` contract entirely — and leave `wafflebase
   * login` blocked on a loopback callback that never arrives.
   */
  it.each([
    ['nothing verified', [{ value: 'ada@example.com', primary: true }]],
    [
      'explicitly unverified',
      [{ value: 'ada@example.com', primary: true, verified: false }],
    ],
    ['no addresses at all', []],
    ['no emails field', undefined],
  ])('refuses a login with %s', (_name, emails) => {
    expect(validate(emails)).toEqual({
      authProvider: 'github',
      error: 'unverified_email',
    });
  });
});

/**
 * The one hinge of the OAuth CSRF design.
 *
 * `GitHubAuthGuard` attaches the state it minted to the request as
 * `__oauthState`; this is the only place that reads it back out and puts
 * it on the wire. Both login paths depend on it — the CLI's
 * `CliAuthStore` token and the browser's double-submit hash — and the
 * callback now refuses anything arriving without a `state`. If the two
 * sides ever spelled the key differently, every login would reach GitHub
 * stateless and every callback would be rejected, while the guard spec
 * (which asserts only that the guard *sets* the key) stayed green.
 */
describe('GitHubStrategy state forwarding', () => {
  // `super.authenticate` resolves up the prototype chain to whichever
  // ancestor passport defines it on. Spy on that owner so the real
  // redirect never runs and the options it was handed are observable.
  function authenticateOwner(): { authenticate: (...a: unknown[]) => void } {
    let proto: unknown = Object.getPrototypeOf(GitHubStrategy.prototype);
    while (
      proto &&
      !Object.prototype.hasOwnProperty.call(proto, 'authenticate')
    ) {
      proto = Object.getPrototypeOf(proto);
    }
    return proto as { authenticate: (...a: unknown[]) => void };
  }

  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest
      .spyOn(authenticateOwner(), 'authenticate')
      .mockImplementation(() => undefined);
  });

  afterEach(() => spy.mockRestore());

  function optionsFor(req: Record<string, unknown>) {
    makeStrategy(BASE).authenticate(
      req as unknown as Parameters<GitHubStrategy['authenticate']>[0],
      { scope: ['user:email'] },
    );
    return spy.mock.calls[0][1] as Record<string, unknown> | undefined;
  }

  it('forwards the state the guard attached as the OAuth `state`', () => {
    const opts = optionsFor({ __oauthState: 'web.deadbeef' });

    expect(opts?.state).toBe('web.deadbeef');
    // The caller's own options have to survive alongside it.
    expect(opts?.scope).toEqual(['user:email']);
  });

  it('sets no state when no guard ran', () => {
    const opts = optionsFor({});

    expect(opts).not.toHaveProperty('state');
  });
});
