import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { GitHubAuthGuard } from './github-auth.guard';
import { CliAuthStore } from './cli-auth.store';

/**
 * The guard is what decides whether a CLI login code will ever be minted
 * and shipped to a loopback port, so all three cases matter: a
 * well-formed request must carry its nonce into the stored state, a
 * malformed one must create no state at all, and an *absent* one must
 * still be served — published CLIs older than nonce-bound login send no
 * nonce, and the binding that protects a login is the CLI-side check.
 */
describe('GitHubAuthGuard', () => {
  let store: CliAuthStore;
  let guard: GitHubAuthGuard;
  let superCanActivate: jest.SpyInstance;

  const VALID_NONCE = 'a'.repeat(43);

  function contextFor(query: Record<string, unknown>): {
    context: ExecutionContext;
    req: Record<string, unknown>;
  } {
    const req: Record<string, unknown> = { query };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { context, req };
  }

  beforeEach(() => {
    store = new CliAuthStore();
    guard = new GitHubAuthGuard(store);
    // Stop the call from reaching passport's GitHub strategy; we only
    // care about what the guard did to the request before delegating.
    superCanActivate = jest
      .spyOn(
        Object.getPrototypeOf(GitHubAuthGuard.prototype) as {
          canActivate: (c: ExecutionContext) => boolean;
        },
        'canActivate',
      )
      .mockReturnValue(true);
  });

  afterEach(() => {
    superCanActivate.mockRestore();
  });

  it('stores the nonce with the CLI state and delegates', () => {
    const { context, req } = contextFor({
      mode: 'cli',
      port: '54321',
      nonce: VALID_NONCE,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(superCanActivate).toHaveBeenCalled();

    const stateToken = req.__cliStateToken as string;
    expect(typeof stateToken).toBe('string');
    expect(store.consumeState(stateToken)).toEqual({
      csrf: expect.any(String) as string,
      mode: 'cli',
      port: 54321,
      nonce: VALID_NONCE,
    });
  });

  it('still serves a nonce-less CLI login, without a nonce in the state', () => {
    // `@wafflebase/cli` is published, so released versions that predate
    // nonce-bound login keep working: they get the same nonce-less
    // redirect they get today, which their own callback accepts. The
    // current CLI always sends a nonce, so it is unaffected.
    const { context, req } = contextFor({ mode: 'cli', port: '54321' });

    expect(guard.canActivate(context)).toBe(true);
    expect(superCanActivate).toHaveBeenCalled();

    const stateToken = req.__cliStateToken as string;
    expect(store.consumeState(stateToken)).toEqual({
      csrf: expect.any(String) as string,
      mode: 'cli',
      port: 54321,
      nonce: undefined,
    });
  });

  it.each([
    ['too short', 'short'],
    ['too long', 'a'.repeat(129)],
    ['non-URL-safe characters', `${'a'.repeat(20)}<script>`],
  ])('rejects a nonce that is %s', (_label, nonce) => {
    const { context, req } = contextFor({ mode: 'cli', port: '54321', nonce });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
    expect(req.__cliStateToken).toBeUndefined();
  });

  it('rejects a repeated nonce param (array) rather than coercing it', () => {
    const { context } = contextFor({
      mode: 'cli',
      port: '54321',
      nonce: [VALID_NONCE, VALID_NONCE],
    });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  it.each([
    ['a privileged port', '80'],
    ['an out-of-range port', '70000'],
    ['a non-numeric port', 'abc'],
    ['no port at all', undefined],
  ])('rejects CLI mode with %s', (_label, port) => {
    const { context, req } = contextFor({
      mode: 'cli',
      port,
      nonce: VALID_NONCE,
    });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
    expect(req.__cliStateToken).toBeUndefined();
  });

  it('leaves the ordinary web flow untouched', () => {
    const { context, req } = contextFor({});

    expect(guard.canActivate(context)).toBe(true);
    expect(req.__cliStateToken).toBeUndefined();
  });
});
