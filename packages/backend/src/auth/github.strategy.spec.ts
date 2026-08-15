import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Strategy } from 'passport-github2';
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
 * `req.__oauthState` → `opts.state` is the single wire that carries the
 * CSRF binding to GitHub: `GitHubAuthGuard` mints the value and mirrors it
 * into a cookie, and this override is the only thing that puts it on the
 * authorization request. Drop it (or misspell the property) and the guard
 * still sets its cookie, the callback still compares — against a `state`
 * GitHub was never given, so *every* login breaks; worse, an override that
 * silently sends nothing would have to be caught here, because no other
 * test looks at what reaches passport.
 */
describe('GitHubStrategy state hand-off', () => {
  let authenticate: jest.SpyInstance;

  beforeEach(() => {
    // passport-github2's `Strategy` inherits `authenticate` from
    // OAuth2Strategy; an own property here shadows it for `super`.
    authenticate = jest
      .spyOn(
        Strategy.prototype as unknown as {
          authenticate: (req: Request, options?: unknown) => void;
        },
        'authenticate',
      )
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    authenticate.mockRestore();
  });

  function optionsFor(req: Request, options?: Record<string, unknown>) {
    makeStrategy(BASE).authenticate(req, options);
    expect(authenticate).toHaveBeenCalledTimes(1);
    return authenticate.mock.calls[0][1] as Record<string, unknown>;
  }

  it('forwards the state the guard minted for this request', () => {
    const opts = optionsFor({ __oauthState: 'guard-state' } as unknown as
      Request);

    expect(opts.state).toBe('guard-state');
  });

  it('keeps the caller options and does not mutate them', () => {
    const options = { scope: ['user:email'] };
    const opts = optionsFor(
      { __oauthState: 'guard-state' } as unknown as Request,
      options,
    );

    expect(opts).toMatchObject({ state: 'guard-state', scope: ['user:email'] });
    expect(options).toEqual({ scope: ['user:email'] });
  });

  it('sends no state when the guard minted none', () => {
    // A request that never went through the guard must not invent a
    // `state`: passport would then send one the callback cannot match.
    const opts = optionsFor({} as unknown as Request);

    expect(opts.state).toBeUndefined();
  });
});
