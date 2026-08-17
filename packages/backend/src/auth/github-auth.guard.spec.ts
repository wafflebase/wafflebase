import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CliAuthStore } from './cli-auth.store';
import { GitHubAuthGuard, normalizeCliState } from './github-auth.guard';

type Query = Record<string, unknown>;

function createContext(query: Query) {
  const req: Query & { __cliStateToken?: string } = { query };
  return {
    req,
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

describe('normalizeCliState', () => {
  const nonce = randomBytes(32).toString('base64url');

  it('accepts a nonce of the shape the CLI mints', () => {
    expect(nonce).toHaveLength(43);
    expect(normalizeCliState(nonce)).toBe(nonce);
  });

  it('treats an absent param as a CLI that predates the nonce', () => {
    expect(normalizeCliState(undefined)).toBeUndefined();
  });

  it('accepts a duplicated param when both values are the same nonce', () => {
    // Express's query parser yields an array for `?cliState=x&cliState=x`.
    expect(normalizeCliState([nonce, nonce])).toBe(nonce);
  });

  it('refuses a duplicated param whose values disagree', () => {
    const other = randomBytes(32).toString('base64url');
    expect(() => normalizeCliState([nonce, other])).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['outside the charset', `${nonce.slice(0, 42)}/`],
    ['empty', ''],
    ['not a string', 42],
    ['an empty array', []],
  ])('refuses a %s cliState rather than dropping it', (_label, value) => {
    expect(() => normalizeCliState(value)).toThrow(BadRequestException);
  });
});

describe('GitHubAuthGuard', () => {
  const nonce = randomBytes(32).toString('base64url');
  let store: CliAuthStore;
  let guard: GitHubAuthGuard;
  let createState: jest.SpyInstance;

  beforeEach(() => {
    store = new CliAuthStore();
    guard = new GitHubAuthGuard(store);
    createState = jest.spyOn(store, 'createState');
    // Stop at the guard's own logic: the passport half needs a real strategy.
    jest
      .spyOn(
        Object.getPrototypeOf(GitHubAuthGuard.prototype) as {
          canActivate: (context: ExecutionContext) => boolean;
        },
        'canActivate',
      )
      .mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores a valid nonce with the flow and injects the state token', () => {
    const { req, context } = createContext({
      mode: 'cli',
      port: '49152',
      cliState: nonce,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(createState).toHaveBeenCalledWith('cli', 49152, nonce);
    expect(typeof req.__cliStateToken).toBe('string');
    expect(store.consumeState(req.__cliStateToken!)?.cliState).toBe(nonce);
  });

  it('starts a nonce-less flow when the CLI sent no cliState', () => {
    const { req, context } = createContext({ mode: 'cli', port: '49152' });

    expect(guard.canActivate(context)).toBe(true);
    expect(createState).toHaveBeenCalledWith('cli', 49152, undefined);
    expect(store.consumeState(req.__cliStateToken!)?.cliState).toBeUndefined();
  });

  it('rejects a malformed cliState instead of dropping it silently', () => {
    const { req, context } = createContext({
      mode: 'cli',
      port: '49152',
      cliState: 'nope',
    });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
    expect(createState).not.toHaveBeenCalled();
    expect(req.__cliStateToken).toBeUndefined();
  });

  it('rejects a duplicated cliState whose values disagree', () => {
    const { context } = createContext({
      mode: 'cli',
      port: '49152',
      cliState: [nonce, randomBytes(32).toString('base64url')],
    });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
    expect(createState).not.toHaveBeenCalled();
  });

  it('leaves the web flow alone, cliState or not', () => {
    const { req, context } = createContext({ cliState: 'nope' });

    expect(guard.canActivate(context)).toBe(true);
    expect(createState).not.toHaveBeenCalled();
    expect(req.__cliStateToken).toBeUndefined();
  });
});
