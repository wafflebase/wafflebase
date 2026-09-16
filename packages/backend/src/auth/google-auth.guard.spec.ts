import { ExecutionContext, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GoogleAuthGuard, GoogleCallbackGuard } from './google-auth.guard';
import { oauthStateCookieName } from './oauth-state';
import { loginReturnCookieName } from './login-return-path';

function makeContext(query: Record<string, unknown> = {}) {
  const req = { query } as unknown as Request & { __oauthState?: string };
  // Handed back beside the response so assertions never reference
  // `res.cookie` as an unbound method.
  const cookie = jest.fn();
  const res = { cookie } as unknown as Response;
  return {
    req,
    cookie,
    context: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext,
  };
}

const CONFIGURED = {
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
};

/**
 * Stand in for passport. `super.canActivate` hands the request to the
 * registered `google` strategy, which a unit test has not booted; what this
 * guard *adds* is the configured check and the state mint, and both happen
 * before that call.
 */
const passportBase = Object.getPrototypeOf(GoogleAuthGuard.prototype) as {
  canActivate: (context: ExecutionContext) => Promise<boolean>;
};

describe('GoogleAuthGuard', () => {
  const saved = { ...process.env };
  let passport: jest.SpyInstance;

  beforeEach(() => {
    passport = jest
      .spyOn(passportBase, 'canActivate')
      .mockResolvedValue(true as never);
  });

  afterEach(() => {
    passport.mockRestore();
    process.env = { ...saved };
  });

  function configure(vars: Record<string, string | undefined>) {
    for (const key of Object.keys(CONFIGURED)) delete process.env[key];
    Object.assign(process.env, vars);
  }

  // Without a Google OAuth client the strategy is never provided, so
  // reaching passport here would be a 500 ("Unknown authentication
  // strategy") on a URL a visitor can simply type.
  it.each([
    ['nothing configured', {}],
    ['no callback URL', { ...CONFIGURED, GOOGLE_CALLBACK_URL: undefined }],
    ['a blank client id', { ...CONFIGURED, GOOGLE_CLIENT_ID: '  ' }],
  ])('404s the start route when Google is unavailable (%s)', (_name, vars) => {
    configure(vars as Record<string, string | undefined>);
    const { context } = makeContext();
    expect(() => new GoogleAuthGuard().canActivate(context)).toThrow(
      NotFoundException,
    );
  });

  it('404s the callback route just as the start route does', () => {
    configure({});
    const { context } = makeContext();
    expect(() => new GoogleCallbackGuard().canActivate(context)).toThrow(
      NotFoundException,
    );
  });

  it('mints the double-submit state when Google is configured', () => {
    configure(CONFIGURED);
    const { req, cookie, context } = makeContext();
    void new GoogleAuthGuard().canActivate(context);

    expect(passport).toHaveBeenCalled();
    expect(req.__oauthState).toMatch(/^web\./);
    expect(cookie).toHaveBeenCalledWith(
      oauthStateCookieName(),
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  // Same `returnTo` contract as the GitHub start route: reduced to a
  // same-origin path, and anything else dropped rather than sanitized.
  it('remembers a safe returnTo and drops an off-origin one', () => {
    configure(CONFIGURED);

    const safe = makeContext({ returnTo: '/t/abc?use=1' });
    void new GoogleAuthGuard().canActivate(safe.context);
    expect(safe.cookie).toHaveBeenCalledWith(
      loginReturnCookieName(),
      '/t/abc?use=1',
      expect.objectContaining({ httpOnly: true }),
    );

    const hostile = makeContext({ returnTo: 'https://evil.example' });
    void new GoogleAuthGuard().canActivate(hostile.context);
    expect(hostile.cookie).not.toHaveBeenCalledWith(
      loginReturnCookieName(),
      expect.anything(),
      expect.anything(),
    );
  });
});
