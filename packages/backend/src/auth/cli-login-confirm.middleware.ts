import { Injectable, NestMiddleware } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import {
  cliLoginAvailable,
  parseCliChallenge,
  parseCliNonce,
  parseCliPort,
} from './github-auth.guard';
import {
  hostPrefixedCookieName,
  timingSafeEqualStr,
  useSecureCookies,
} from './oauth-state';

/**
 * Confirmation gate in front of `GET /auth/github?mode=cli`.
 *
 * That URL is unauthenticated and takes the loopback port off the query
 * string, so without a gate any page the victim visits can top-level
 * navigate them to
 * `…/auth/github?mode=cli&port=<attacker's>&nonce=<attacker's>` and have
 * the backend mint an auth code **for the victim** and post it to a
 * 127.0.0.1 port of the attacker's choosing. The loopback nonce does not
 * help in that direction: the attacker picked the nonce.
 *
 * What an attacker cannot forge is a click. So a CLI login is answered
 * with a confirmation page instead of a redirect to GitHub, and only the
 * "Continue" link on that page — carrying a one-time secret that also
 * went out as an httpOnly cookie — starts the OAuth flow. The attacker
 * can navigate the victim here, but the page merely says a sign-in was
 * requested; they cannot read the secret out of the victim's response,
 * and a secret minted against their own cookie will not match the
 * victim's. `X-Frame-Options: DENY` keeps the click from being stolen by
 * framing it.
 */
const CLI_CONFIRM_COOKIE_BASE = 'wafflebase_cli_confirm';

/**
 * `__Host-` prefixed in production, for the same reason the OAuth state
 * cookie is (`oauth-state.ts`): the click is proven by possession of
 * this cookie alone, so a foothold on any sibling subdomain that can
 * write `wafflebase_cli_confirm=<its own secret>; Domain=<parent>` also
 * holds the `?confirm=` half and can walk itself through the gate. The
 * prefix forbids `Domain`, and requires `Secure` and `Path=/` with it,
 * so the name and the options move together and only the name a
 * plain-HTTP dev server can actually set is used there.
 */
export function cliConfirmCookieName(): string {
  return hostPrefixedCookieName(CLI_CONFIRM_COOKIE_BASE);
}

/** Long enough to read the page, short enough not to linger. */
const CONFIRM_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

function confirmCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Must agree with `cliConfirmCookieName()`, which takes the `__Host-`
    // prefix on exactly the same condition — a browser rejects a prefixed
    // cookie set without `Secure`, so the two answers come from one place.
    secure: useSecureCookies(),
    sameSite: 'lax',
    // `/`, not `/auth`: `__Host-` is honoured only with `Path=/`. The
    // cookie is httpOnly, single-use and lives five minutes.
    path: '/',
    maxAge: CONFIRM_COOKIE_MAX_AGE_MS,
  };
}

/** Set by this middleware; `GitHubAuthGuard` mints CLI state only with it. */
export interface CliConfirmedRequest extends Request {
  __cliConfirmed?: boolean;
}

/**
 * The `?confirm=` value that belongs to one confirmation page.
 *
 * Deliberately not a bare copy of the cookie. A bare copy proves only that
 * this browser was shown *some* confirmation page in the last five minutes —
 * not the page naming port 49152. That is the wrong claim: the entire
 * defence is that a person read the port on the page they clicked, so a
 * confirmation obtained for one set of parameters must not be spendable
 * against another (an attacker-owned loopback listener, say) without a
 * second page being shown. Signing the parameters into the token binds it to
 * what was displayed, and the middleware recomputes it from the *request's
 * own* `port`, `nonce` and `challenge`, so changing any of them invalidates
 * the confirmation.
 *
 * The cookie secret is the key, so there is no server key to configure or
 * rotate: a crafted link still cannot pre-supply the token, because
 * computing it needs the httpOnly cookie the page itself set.
 *
 * Each part is length-prefixed so no combination of values can be re-cut
 * into a different one that signs the same (`"9|87,6"` vs `"98|7,6"`).
 */
export function cliConfirmToken(
  cookieSecret: string,
  port: number,
  nonce?: string,
  challenge?: string,
): string {
  const parts = [String(port), nonce ?? '', challenge ?? ''];
  return createHmac('sha256', cookieSecret)
    .update(parts.map((part) => `${part.length}:${part}`).join('|'))
    .digest('base64url');
}

@Injectable()
export class CliLoginConfirmMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (req.query?.mode !== 'cli') {
      return next();
    }

    // A deployment whose cookies cannot be `Secure` has no consent gate to
    // show — this cookie is the gate, and there it is plantable
    // (`cliLoginAvailable`). Falling through hands the request to
    // `GitHubAuthGuard`, which answers the documented 400 instead of walking
    // someone through a page that proves nothing.
    if (!cliLoginAvailable()) {
      return next();
    }

    const port = parseCliPort(req.query?.port);
    const nonce = parseCliNonce(req.query?.nonce);
    const challenge = parseCliChallenge(req.query?.challenge);
    if (port === undefined) {
      // Not a usable CLI request. The guard ignores it too, so it falls
      // through to an ordinary browser login rather than 404-ing here.
      return next();
    }

    const confirm = req.query?.confirm;
    // Only the name this build would mint is read: honouring an
    // unprefixed leftover in production would re-admit the very cookie
    // tossing the prefix blocks.
    const confirmCookie = cliConfirmCookieName();
    const cookie = (req as Request & { cookies?: Record<string, unknown> })
      .cookies?.[confirmCookie];
    if (
      typeof confirm === 'string' &&
      typeof cookie === 'string' &&
      // Recomputed from *this* request's parameters, so a click consented
      // for one loopback port does not authorize another — see
      // `cliConfirmToken`.
      timingSafeEqualStr(
        confirm,
        cliConfirmToken(cookie, port, nonce, challenge),
      )
    ) {
      // Single use: the cookie is what makes the secret unforgeable, so
      // it is spent here rather than left to be replayed.
      res.clearCookie(confirmCookie, {
        ...confirmCookieOptions(),
        maxAge: undefined,
      });
      (req as CliConfirmedRequest).__cliConfirmed = true;
      return next();
    }

    const secret = randomBytes(32).toString('base64url');
    res.cookie(confirmCookie, secret, confirmCookieOptions());
    const confirmToken = cliConfirmToken(secret, port, nonce, challenge);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderConfirmPage(port, nonce, confirmToken, challenge));
  }
}

/**
 * Every value interpolated below is already constrained — `port` is an
 * integer, `nonce` is `[0-9a-f]{32,128}`, `challenge` is a 43-character
 * base64url digest, `confirmToken` is base64url — but they are escaped
 * anyway: the page must stay inert even if a future caller loosens one of
 * those parsers.
 *
 * `challenge` has to survive this hop: the guard reads it off the request
 * that gets through the gate, and dropping it here would leave every
 * confirmed CLI login without the binding `cliExchange` requires. It is
 * also signed into `confirmToken`, so the link cannot be re-pointed at
 * another port or another challenge without a second page being shown.
 */
export function renderConfirmPage(
  port: number,
  nonce: string | undefined,
  confirmToken: string,
  challenge?: string,
): string {
  const params = new URLSearchParams({ mode: 'cli', port: String(port) });
  if (nonce) params.set('nonce', nonce);
  if (challenge) params.set('challenge', challenge);
  params.set('confirm', confirmToken);
  const href = `/auth/github?${params.toString()}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Wafflebase CLI sign-in</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; justify-content: center; align-items: center;
    min-height: 100vh; margin: 0; background: #fafafa; color: #1a1a1a;
  }
  .card {
    max-width: 26rem; text-align: center; padding: 2.5rem;
    background: #fff; border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);
  }
  h1 { margin: 0 0 0.75rem; font-size: 1.25rem; font-weight: 600; }
  p { margin: 0 0 1rem; color: #555; font-size: 0.95rem; line-height: 1.5; }
  .warn { color: #8a5300; }
  a.button {
    display: inline-block; padding: 0.6rem 1.4rem; border-radius: 8px;
    background: #1a1a1a; color: #fff; text-decoration: none; font-weight: 600;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>Continue signing in to the Wafflebase CLI?</h1>
    <p>A command-line sign-in is asking to complete on this computer
       (port ${escapeHtml(String(port))}).</p>
    <p class="warn">If you did not just run <code>wafflebase login</code>,
       close this page. Continuing would hand a sign-in for your account to
       whoever asked for it.</p>
    <p><a class="button" href="${escapeHtml(href)}">Continue</a></p>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
