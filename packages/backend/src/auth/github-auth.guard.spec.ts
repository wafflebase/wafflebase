import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { CliAuthStore } from './cli-auth.store';
import {
  GitHubAuthGuard,
  OAUTH_STATE_COOKIE,
  WEB_STATE_PREFIX,
} from './github-auth.guard';

/**
 * The guard is the only place the CLI's `nonce` and `code_challenge` enter
 * the server, and both arrive on an attacker-influenceable query string.
 *
 * Passport's own `canActivate` (the mixin this guard extends) is stubbed:
 * it would try to run the GitHub strategy and redirect. What is under test
 * is what the guard recorded on the way through.
 */
function contextFor(query: Record<string, unknown>) {
  const req: Record<string, unknown> = { query };
  const cookies: Array<{ name: string; value: string }> = [];
  const res = {
    cookie: (name: string, value: string) => cookies.push({ name, value }),
  };
  return {
    req,
    cookies,
    context: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext,
  };
}

describe('GitHubAuthGuard', () => {
  let store: CliAuthStore;
  let guard: GitHubAuthGuard;

  beforeEach(() => {
    const passportBase = Object.getPrototypeOf(
      GitHubAuthGuard.prototype,
    ) as Record<string, unknown>;
    jest.spyOn(passportBase, 'canActivate' as never).mockReturnValue(
      true as never,
    );
    store = new CliAuthStore();
    guard = new GitHubAuthGuard(store);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Run the guard and read back what it put in the store. */
  function stateFor(query: Record<string, unknown>) {
    const { req, context } = contextFor(query);
    guard.canActivate(context);
    const token = req.__oauthState as string | undefined;
    return token && !token.startsWith(WEB_STATE_PREFIX)
      ? store.consumeState(token)
      : undefined;
  }

  it('remembers the CLI nonce so the callback can echo it', () => {
    const state = stateFor({ mode: 'cli', port: '9876', nonce: 'n0nce-x/y' });
    expect(state).toMatchObject({
      mode: 'cli',
      port: 9876,
      nonce: 'n0nce-x/y',
    });
  });

  it('keeps a nonce at the 128-character bound and drops a longer one', () => {
    const atBound = 'a'.repeat(128);
    expect(stateFor({ mode: 'cli', port: '9876', nonce: atBound })?.nonce).toBe(
      atBound,
    );

    const overBound = 'a'.repeat(129);
    expect(
      stateFor({ mode: 'cli', port: '9876', nonce: overBound })?.nonce,
    ).toBeUndefined();
  });

  it('ignores an empty or non-string nonce rather than echoing it', () => {
    expect(
      stateFor({ mode: 'cli', port: '9876', nonce: '' })?.nonce,
    ).toBeUndefined();
    // Express gives a repeated `?nonce=` as an array; it is not a nonce.
    expect(
      stateFor({ mode: 'cli', port: '9876', nonce: ['a', 'b'] })?.nonce,
    ).toBeUndefined();
  });

  it('still issues a state token for a CLI login that sends no nonce', () => {
    const state = stateFor({ mode: 'cli', port: '9876' });
    expect(state).toMatchObject({ mode: 'cli', port: 9876 });
    expect(state?.nonce).toBeUndefined();
  });

  it('remembers a well-formed PKCE challenge', () => {
    const challenge = createHash('sha256')
      .update(randomBytes(32).toString('base64url'))
      .digest('base64url');
    expect(
      stateFor({ mode: 'cli', port: '9876', code_challenge: challenge })
        ?.codeChallenge,
    ).toBe(challenge);
  });

  // A challenge that is sent but unusable must fail the request. Storing
  // `undefined` instead would continue the login as an unchallenged,
  // bearer-only code while the client still believes it is PKCE-bound —
  // a downgrade neither end can observe.
  it('fails the request for a malformed challenge instead of dropping it', () => {
    // Too short for RFC 7636 §4.1, and outside the base64url alphabet.
    expect(() =>
      stateFor({ mode: 'cli', port: '9876', code_challenge: 'short' }),
    ).toThrow(BadRequestException);
    expect(() =>
      stateFor({
        mode: 'cli',
        port: '9876',
        code_challenge: `${'a'.repeat(42)}&x=1`,
      }),
    ).toThrow(BadRequestException);
    // Express gives a repeated `?code_challenge=` as an array.
    expect(() =>
      stateFor({ mode: 'cli', port: '9876', code_challenge: ['a', 'b'] }),
    ).toThrow(BadRequestException);
  });

  it('still issues a state token for a CLI login that sends no challenge', () => {
    const state = stateFor({ mode: 'cli', port: '9876', nonce: 'n' });
    expect(state).toMatchObject({ mode: 'cli', port: 9876 });
    expect(state?.codeChallenge).toBeUndefined();
  });

  it('stores no CLI state for a non-CLI request or an out-of-range port', () => {
    const { req: web, context: webCtx } = contextFor({ nonce: 'n' });
    guard.canActivate(webCtx);
    expect(store.consumeState(web.__oauthState as string)).toBeUndefined();

    const { req: low, context: lowCtx } = contextFor({
      mode: 'cli',
      port: '80',
      nonce: 'n',
    });
    guard.canActivate(lowCtx);
    expect(store.consumeState(low.__oauthState as string)).toBeUndefined();
  });

  // A browser login used to reach GitHub with no `state` at all, which left
  // the callback nothing to validate — any redirect completed a login
  // (forced-login CSRF). Every request now carries one, cookie-backed.
  it('mints a cookie-backed `state` for a browser login', () => {
    const { req, cookies, context } = contextFor({});
    guard.canActivate(context);

    const state = req.__oauthState as string;
    expect(state.startsWith(WEB_STATE_PREFIX)).toBe(true);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(OAUTH_STATE_COOKIE);
    // The cookie is the other half of the double submit: same value, sent
    // separately from the query parameter.
    expect(state.slice(WEB_STATE_PREFIX.length)).toBe(cookies[0].value);
  });

  it('leaves the CLI state alone rather than overwriting it with a web one', () => {
    const { req, cookies, context } = contextFor({ mode: 'cli', port: '9876' });
    guard.canActivate(context);

    expect((req.__oauthState as string).startsWith(WEB_STATE_PREFIX)).toBe(
      false,
    );
    expect(cookies).toHaveLength(0);
  });

  it('mints a fresh browser state per request', () => {
    const first = contextFor({});
    guard.canActivate(first.context);
    const second = contextFor({});
    guard.canActivate(second.context);

    expect(first.req.__oauthState).not.toBe(second.req.__oauthState);
  });
});
