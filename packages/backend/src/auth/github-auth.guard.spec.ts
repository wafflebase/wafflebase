import { CanActivate, ExecutionContext } from '@nestjs/common';
import { GitHubAuthGuard, parseCliNonce } from './github-auth.guard';
import { CliAuthStore } from './cli-auth.store';

describe('parseCliNonce', () => {
  it('accepts a hex nonce of a sane length', () => {
    const nonce = 'a1b2c3d4'.repeat(8); // 64 chars
    expect(parseCliNonce(nonce)).toBe(nonce);
    expect(parseCliNonce('f'.repeat(32))).toBe('f'.repeat(32));
  });

  it('rejects anything that could smuggle a query param into the redirect', () => {
    expect(parseCliNonce('f'.repeat(32) + '&code=evil')).toBeUndefined();
    expect(parseCliNonce('../callback')).toBeUndefined();
    expect(parseCliNonce('F'.repeat(32))).toBeUndefined(); // uppercase
    expect(parseCliNonce('f'.repeat(31))).toBeUndefined(); // too short
    expect(parseCliNonce('f'.repeat(129))).toBeUndefined(); // too long
  });

  it('rejects non-string input', () => {
    expect(parseCliNonce(undefined)).toBeUndefined();
    expect(parseCliNonce(['f'.repeat(32)])).toBeUndefined();
    expect(parseCliNonce(42)).toBeUndefined();
  });
});

/**
 * The CSRF binding runs query param -> stored state -> loopback
 * `state`, and this guard is its entry point. Testing `parseCliNonce`
 * alone leaves the wiring unpinned: read the nonce from the wrong query
 * key, or drop the argument, and every other test in the chain still
 * passes, because they hand `createState` a nonce directly.
 */
describe('GitHubAuthGuard.canActivate', () => {
  const createState = jest
    .fn()
    .mockReturnValue({ stateToken: 'state-token', csrf: 'csrf' });
  const store = { createState } as unknown as CliAuthStore;

  // `super.canActivate()` would run the real passport strategy.
  const passportProto = Object.getPrototypeOf(
    GitHubAuthGuard.prototype,
  ) as CanActivate;
  let superSpy: jest.SpyInstance;

  beforeEach(() => {
    createState.mockClear();
    superSpy = jest.spyOn(passportProto, 'canActivate').mockReturnValue(true);
  });

  afterEach(() => superSpy.mockRestore());

  function activate(query: Record<string, unknown>) {
    const req: Record<string, unknown> = { query };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const result = new GitHubAuthGuard(store).canActivate(context);
    return { req, result };
  }

  it('binds the request nonce into the stored state', () => {
    const nonce = 'a'.repeat(64);
    const { req, result } = activate({ mode: 'cli', port: '49152', nonce });

    expect(result).toBe(true);
    expect(createState).toHaveBeenCalledWith('cli', 49152, nonce);
    expect(req.__cliStateToken).toBe('state-token');
  });

  it('stores no nonce when the query carries none or a malformed one', () => {
    activate({ mode: 'cli', port: '49152' });
    expect(createState).toHaveBeenCalledWith('cli', 49152, undefined);

    createState.mockClear();
    activate({ mode: 'cli', port: '49152', nonce: 'not-hex&code=evil' });
    expect(createState).toHaveBeenCalledWith('cli', 49152, undefined);
  });

  it('mints no state for a web login or an out-of-range port', () => {
    const web = activate({});
    expect(createState).not.toHaveBeenCalled();
    expect(web.req.__cliStateToken).toBeUndefined();

    activate({ mode: 'cli', port: '80' });
    activate({ mode: 'cli', port: 'not-a-port' });
    expect(createState).not.toHaveBeenCalled();
  });
});
