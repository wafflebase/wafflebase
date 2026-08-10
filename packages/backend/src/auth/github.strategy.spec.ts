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
  };
  return {
    authorize: s._oauth2._authorizeUrl,
    token: s._oauth2._accessTokenUrl,
    profile: s._userProfileURL,
  };
}

const BASE = {
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
  GITHUB_CALLBACK_URL: 'http://localhost:3000/auth/github/callback',
};

describe('GitHubStrategy endpoints', () => {
  it('defaults to public github.com when no enterprise vars are set', () => {
    const { authorize, token, profile } = endpoints(makeStrategy(BASE));
    expect(authorize).toBe('https://github.com/login/oauth/authorize');
    expect(token).toBe('https://github.com/login/oauth/access_token');
    expect(profile).toBe('https://api.github.com/user');
  });

  it('uses the configured GitHub Enterprise endpoints when set', () => {
    const { authorize, token, profile } = endpoints(
      makeStrategy({
        ...BASE,
        GITHUB_AUTHORIZATION_URL:
          'https://ghe.example.com/login/oauth/authorize',
        GITHUB_TOKEN_URL: 'https://ghe.example.com/login/oauth/access_token',
        GITHUB_USER_PROFILE_URL: 'https://ghe.example.com/api/v3/user',
      }),
    );
    expect(authorize).toBe('https://ghe.example.com/login/oauth/authorize');
    expect(token).toBe('https://ghe.example.com/login/oauth/access_token');
    expect(profile).toBe('https://ghe.example.com/api/v3/user');
  });

  // Each var is independent: overriding one must not disturb the other two.
  const DEFAULTS = {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    profile: 'https://api.github.com/user',
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
  });
});
