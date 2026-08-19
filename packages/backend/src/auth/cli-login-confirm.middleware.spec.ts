import type { NextFunction, Request, Response } from 'express';
import {
  cliConfirmCookieName,
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

  /**
   * The Continue link is the only way the login's parameters survive the
   * confirmation hop: the click re-enters `/auth/github`, and whatever
   * the href omits is simply gone by the time the guard runs. Drop the
   * `nonce` and the CLI's loopback server refuses every genuine redirect
   * ("the redirect carried no `state`") until the wait times out; drop
   * the `port` and the callback has nowhere to redirect. Neither shows
   * up as a failure anywhere else, so it is asserted here.
   */
  it('carries the CLI port, nonce and challenge into the Continue link', () => {
    const nonce = 'a'.repeat(64);
    const challenge = 'c'.repeat(43);
    const { res } = run({ mode: 'cli', port: '49152', nonce, challenge });

    const [html] = res.send.mock.calls[0] as [string];
    // The href is HTML-escaped in the attribute (`&` → `&amp;`); read
    // the URL a browser would actually navigate to.
    const href = (/href="([^"]+)"/.exec(html)?.[1] ?? '').replace(
      /&amp;/g,
      '&',
    );
    const params = new URLSearchParams(href.split('?')[1] ?? '');

    expect(href.startsWith('/auth/github?')).toBe(true);
    expect(params.get('mode')).toBe('cli');
    expect(params.get('port')).toBe('49152');
    expect(params.get('nonce')).toBe(nonce);
    // Dropped here, the guard registers no PKCE challenge and the
    // callback refuses to mint a code at all.
    expect(params.get('challenge')).toBe(challenge);
  });

  it('proceeds when the confirm param matches the cookie', () => {
    const nonce = 'a'.repeat(64);
    const { req, res, next } = run(
      { mode: 'cli', port: '49152', nonce, confirm: 'secret-value' },
      { [cliConfirmCookieName()]: 'secret-value' },
    );

    expect(next).toHaveBeenCalled();
    expect(req.__cliConfirmed).toBe(true);
    // Single use.
    expect(res.clearCookie).toHaveBeenCalledWith(
      cliConfirmCookieName(),
      expect.any(Object),
    );
  });

  // Equal lengths on both sides, so the refusal has to come from
  // comparing the contents rather than from a length check standing in
  // for the comparison.
  it('re-prompts when the confirm param does not match the cookie', () => {
    const { req, res, next } = run(
      { mode: 'cli', port: '49152', confirm: 'a'.repeat(43) },
      { [cliConfirmCookieName()]: 'b'.repeat(43) },
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

  /**
   * The click is proven by possession of this cookie alone, so it needs
   * the same host binding as the OAuth state cookie: without `__Host-`,
   * a foothold on any sibling subdomain can write one with `Domain=` set
   * and walk itself through the gate with the `?confirm=` it minted. The
   * prefix is only honoured with `Secure` and `Path=/`, so all three are
   * asserted together — a prefixed cookie missing either is dropped by
   * the browser, which would break every CLI login instead.
   */
  it('prefixes the confirm cookie with __Host- where cookies are Secure', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { res } = run({ mode: 'cli', port: '49152' });

      expect(res.cookie).toHaveBeenCalledWith(
        '__Host-wafflebase_cli_confirm',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: '/',
        }),
      );
      const [, , options] = res.cookie.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(options.domain).toBeUndefined();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
