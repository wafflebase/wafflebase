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
 * `GitHubAuthGuard` mints the OAuth `state` and leaves it on the request as
 * `__oauthState`; this strategy is the only thing that puts it on the wire.
 * Nothing else observes the handoff, so a half-applied rename on either side
 * would ship an authorization request with no CSRF binding at all — every
 * other test still green, because passport-oauth2 installs a `NullStore`
 * whose `verify` always succeeds when no `state` option is given.
 */
describe('GitHubStrategy state injection', () => {
  // `super.authenticate` resolves on the prototype above GitHubStrategy's
  // (the Nest mixin), so a stub defined there is what the override calls.
  const base = Object.getPrototypeOf(GitHubStrategy.prototype) as Record<
    string,
    unknown
  >;
  const hadOwn = Object.prototype.hasOwnProperty.call(base, 'authenticate');
  const original = base.authenticate;
  let seen: Record<string, unknown> | undefined;

  beforeEach(() => {
    seen = undefined;
    base.authenticate = function (
      _req: unknown,
      options?: Record<string, unknown>,
    ) {
      seen = options;
    };
  });

  afterEach(() => {
    if (hadOwn) base.authenticate = original;
    else delete base.authenticate;
  });

  it('forwards the state the guard put on the request', () => {
    makeStrategy(BASE).authenticate(
      { __oauthState: 'w.the-browser-half' } as never,
      { scope: ['user:email'] },
    );

    expect(seen).toMatchObject({
      state: 'w.the-browser-half',
      scope: ['user:email'],
    });
  });

  it('forwards a CLI state token unchanged', () => {
    makeStrategy(BASE).authenticate({ __oauthState: 'cli-token' } as never);
    expect(seen?.state).toBe('cli-token');
  });

  it('sends no state when the guard set none', () => {
    makeStrategy(BASE).authenticate({} as never, { scope: ['user:email'] });
    expect(seen).toBeDefined();
    expect('state' in seen!).toBe(false);
  });

  it('does not mutate the options object it was handed', () => {
    const options = { scope: ['user:email'] };
    makeStrategy(BASE).authenticate({ __oauthState: 's' } as never, options);
    expect(options).toEqual({ scope: ['user:email'] });
  });
});
