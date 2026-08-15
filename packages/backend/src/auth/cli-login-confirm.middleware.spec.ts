import type { NextFunction, Request, Response } from 'express';
import {
  CLI_CONFIRM_COOKIE,
  CliLoginConfirmMiddleware,
} from './cli-login-confirm.middleware';

/**
 * `GET /auth/github?mode=cli&port=…` is unauthenticated and takes the
 * loopback port off the query string, so a page the victim visits can
 * navigate them to it and have the backend mint an auth code for the
 * *victim* addressed at a port the attacker picked. The loopback nonce
 * cannot cover that direction — the attacker chose the nonce — so the
 * gate is a click the attacker cannot forge.
 */
describe('CliLoginConfirmMiddleware', () => {
  const middleware = new CliLoginConfirmMiddleware();

  function run(
    query: Record<string, unknown>,
    cookies: Record<string, string> = {},
  ) {
    const req = { query, cookies } as unknown as Request;
    const res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn(),
      send: jest.fn(),
    };
    res.status.mockReturnValue(res);
    const next = jest.fn() as unknown as NextFunction;
    middleware.use(req, res as unknown as Response, next);
    return { req: req as Request & { __cliConfirmed?: boolean }, res, next };
  }

  it('lets a browser login through untouched', () => {
    const { res, next } = run({});

    expect(next).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('answers an unconfirmed CLI login with the confirmation page', () => {
    const { res, next } = run({ mode: 'cli', port: '49152' });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const [html] = res.send.mock.calls[0] as [string];
    expect(html).toContain('Continue');
    // Clickjacking would turn the confirmation back into a silent click.
    expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    // The secret in the page is also the cookie: an attacker who mints
    // one against their own cookie cannot pass the victim's check.
    const [, secret] = res.cookie.mock.calls[0] as [string, string];
    expect(html).toContain(`confirm=${encodeURIComponent(secret)}`);
  });

  it('proceeds when the confirm param matches the cookie', () => {
    const nonce = 'a'.repeat(64);
    const { req, res, next } = run(
      { mode: 'cli', port: '49152', nonce, confirm: 'secret-value' },
      { [CLI_CONFIRM_COOKIE]: 'secret-value' },
    );

    expect(next).toHaveBeenCalled();
    expect(req.__cliConfirmed).toBe(true);
    // Single use.
    expect(res.clearCookie).toHaveBeenCalledWith(
      CLI_CONFIRM_COOKIE,
      expect.any(Object),
    );
  });

  it('re-prompts when the confirm param does not match the cookie', () => {
    const { req, res, next } = run(
      { mode: 'cli', port: '49152', confirm: 'attacker-minted' },
      { [CLI_CONFIRM_COOKIE]: 'victims-cookie' },
    );

    expect(next).not.toHaveBeenCalled();
    expect(req.__cliConfirmed).toBeUndefined();
    expect(res.send).toHaveBeenCalled();
  });

  it('re-prompts when the confirm param arrives with no cookie', () => {
    const { req, next } = run({
      mode: 'cli',
      port: '49152',
      confirm: 'attacker-minted',
    });

    expect(next).not.toHaveBeenCalled();
    expect(req.__cliConfirmed).toBeUndefined();
  });

  it('passes an unusable CLI port through to the ordinary browser login', () => {
    const { res, next } = run({ mode: 'cli', port: '80' });

    expect(next).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
