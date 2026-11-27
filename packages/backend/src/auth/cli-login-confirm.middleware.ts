import { Injectable, NestMiddleware } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import type { CliAuthMode } from './cli-auth.store';
import {
  cliLoginAvailable,
  parseCliAuthMode,
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
 *
 * `?mode=desktop` (the desktop app's sign-in, `docs/design/desktop-app.md`
 * §3) goes through the same gate for the same reason; only the page's
 * wording changes, to name the app instead of the command line.
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
 *
 * The mode is signed in too: the page names the program the sign-in is for
 * (command line or desktop app), and the code the login ends in redeems only
 * through that program's endpoint, so a click on one must not start the
 * other.
 */
export function cliConfirmToken(
  cookieSecret: string,
  port: number,
  nonce?: string,
  challenge?: string,
  mode: CliAuthMode = 'cli',
): string {
  const parts = [mode, String(port), nonce ?? '', challenge ?? ''];
  return createHmac('sha256', cookieSecret)
    .update(parts.map((part) => `${part.length}:${part}`).join('|'))
    .digest('base64url');
}

@Injectable()
export class CliLoginConfirmMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const mode = parseCliAuthMode(req.query?.mode);
    if (!mode) {
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
        cliConfirmToken(cookie, port, nonce, challenge, mode),
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
    const confirmToken = cliConfirmToken(secret, port, nonce, challenge, mode);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res
      .status(200)
      .send(renderConfirmPage(port, nonce, confirmToken, challenge, mode));
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
 *
 * `mode` picks the wording and is carried into the link (and signed into
 * `confirmToken`), so a desktop start stays a desktop start through the hop.
 */
export function renderConfirmPage(
  port: number,
  nonce: string | undefined,
  confirmToken: string,
  challenge?: string,
  mode: CliAuthMode = 'cli',
): string {
  const params = new URLSearchParams({ mode, port: String(port) });
  if (nonce) params.set('nonce', nonce);
  if (challenge) params.set('challenge', challenge);
  params.set('confirm', confirmToken);
  const href = `/auth/github?${params.toString()}`;
  const copy = CONFIRM_COPY[mode];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>${copy.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${BRAND_FONTS_URL}">
<style>
  :root {
    --bg: #FAF9F6; --paper: #FFFFFF; --ink: #1C1B19; --sub: #5F5B55;
    --rule: #E7E4DE; --wash: #F1EEE8; --syrup: #B8651A;
    --primary: #9E5614; --primary-hover: #8A4A12; --on-primary: #FFFAF0;
    --edge: #8A4A12; --warn: oklch(0.555 0.163 48.998);
    --shadow: 0 1px 0 rgba(42,30,18,0.04), 0 30px 60px -32px rgba(42,30,18,0.22);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #161615; --paper: #1F1F1D; --ink: #F5F4F1; --sub: #A8A49C;
      --rule: #2E2D2A; --wash: #2A2927; --syrup: #E08A3A;
      --primary: #E08A3A; --primary-hover: #C97A30; --on-primary: #1C1610;
      --edge: #C97A30; --warn: oklch(0.769 0.188 70.08);
      --shadow: 0 1px 0 rgba(0,0,0,0.2), 0 30px 60px -32px rgba(0,0,0,0.6);
    }
  }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body {
    margin: 0; min-height: 100vh; min-height: 100svh;
    display: flex; flex-direction: column;
    background: var(--bg); color: var(--ink);
    font: 400 14.5px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  ::selection { background: rgba(244, 201, 93, 0.45); color: var(--ink); }
  header { padding: 14px 16px; }
  @media (min-width: 768px) { header { padding: 14px 48px; } }
  .lockup {
    display: inline-flex; align-items: center; gap: 10px;
    font-family: Fraunces, ui-serif, Georgia, serif; font-weight: 500;
    font-size: 19px; letter-spacing: -0.025em;
    font-variation-settings: "opsz" 144; color: var(--ink);
  }
  .lockup svg { fill: var(--syrup); flex: none; }
  main {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 24px 16px 64px;
  }
  .card {
    width: 100%; max-width: 440px; padding: 32px 28px 28px;
    background: var(--paper); border: 1px solid var(--rule);
    border-radius: 16px; box-shadow: var(--shadow);
  }
  @media (min-width: 768px) { .card { padding: 40px 36px 36px; } }
  h1 {
    margin: 0 0 12px; text-align: center; text-wrap: balance;
    font-family: Fraunces, ui-serif, Georgia, serif; font-weight: 600;
    font-size: 28px; line-height: 1.15; letter-spacing: -0.02em;
    font-feature-settings: "ss01" on, "ss02" on;
  }
  .lead { margin: 0; text-align: center; text-wrap: pretty; color: var(--sub); }
  .port {
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px; color: var(--ink); white-space: nowrap;
    background: var(--wash); border-radius: 4.8px; padding: 1px 6px;
  }
  .note {
    display: flex; gap: 10px; align-items: flex-start;
    margin: 24px 0; padding: 12px 14px;
    border: 1px solid var(--rule); border-radius: 8.8px;
    font-size: 13.5px; line-height: 1.5; color: var(--sub);
  }
  .note svg { flex: none; margin-top: 1px; stroke: var(--warn); }
  .note strong { color: var(--ink); font-weight: 600; }
  code {
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em; color: var(--ink);
  }
  a.button {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 13px 22px; border-radius: 9999px;
    background: var(--primary); color: var(--on-primary);
    border: 1px solid var(--edge);
    box-shadow: 0 1px 0 var(--edge), inset 0 1px 0 color-mix(in srgb, white 25%, transparent);
    font-size: 15px; font-weight: 500; text-decoration: none;
    transition: background-color 150ms, transform 150ms;
    outline: none;
  }
  a.button:hover { background: var(--primary-hover); transform: translateY(-1px); }
  a.button:active { transform: none; }
  a.button:focus-visible {
    box-shadow: 0 0 0 2px var(--paper), 0 0 0 5px color-mix(in srgb, var(--syrup) 50%, transparent);
  }
  a.button svg { width: 16px; height: 16px; fill: currentColor; }
  @media (prefers-reduced-motion: reduce) { a.button { transition: none; } a.button:hover { transform: none; } }
</style>
</head>
<body>
  <header>
    <span class="lockup">${WAFFLE_MARK_SVG}Wafflebase</span>
  </header>
  <main>
    <div class="card">
      <h1>${copy.heading}</h1>
      <p class="lead">${copy.request} is asking to complete on this computer,
         <span class="port">port ${escapeHtml(String(port))}</span>.</p>
      <p class="note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4"/><path d="M12 17.5h.01"/></svg>
        <span><strong>${copy.ifNot}, close this page.</strong>
        Continuing would hand a sign-in for your account to whoever asked
        for it.</span>
      </p>
      <a class="button" href="${escapeHtml(href)}">${GITHUB_MARK_SVG}Continue</a>
    </div>
  </main>
</body>
</html>`;
}

/** Fixed, trusted HTML fragments per mode — nothing here comes off a request. */
const CONFIRM_COPY: Record<
  CliAuthMode,
  { title: string; heading: string; request: string; ifNot: string }
> = {
  cli: {
    title: 'Wafflebase CLI sign-in',
    heading: 'Continue signing in to the Wafflebase CLI?',
    request: 'A command-line sign-in',
    ifNot: 'If you did not just run <code>wafflebase login</code>',
  },
  desktop: {
    title: 'Wafflebase desktop app sign-in',
    heading: 'Continue signing in to the Wafflebase desktop app?',
    request: 'A sign-in from the Wafflebase desktop app',
    ifNot: 'If you did not just sign in from the Wafflebase desktop app',
  },
};

/**
 * The brand faces the web sign-in page loads (`packages/frontend/src/lib/
 * brand-fonts.ts`), so this page reads as the same surface. `display=swap`
 * keeps the system stack on screen until they arrive; the page works without
 * them.
 */
const BRAND_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&amp;family=Inter:wght@400;500;600&amp;family=JetBrains+Mono:wght@400&amp;display=swap';

/**
 * The "Facet" mark (`WaffleLogo` in the frontend; `DESIGN.md` → Mark): a
 * 3×3 grid of pockets turned 45°, filled by the page's `--syrup`.
 */
const WAFFLE_MARK_SVG = (() => {
  const pocket = 5.6;
  const step = pocket + 1.4;
  const rects: string[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const u = (i - 1) * step;
      const v = (j - 1) * step;
      const cx = +(16 + (u - v) / Math.SQRT2).toFixed(3);
      const cy = +(16 + (u + v) / Math.SQRT2).toFixed(3);
      rects.push(
        `<rect x="${+(cx - pocket / 2).toFixed(3)}" y="${+(cy - pocket / 2).toFixed(3)}" width="${pocket}" height="${pocket}" rx="1" transform="rotate(45 ${cx} ${cy})"/>`,
      );
    }
  }
  return `<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">${rects.join('')}</svg>`;
})();

/** GitHub's mark, as on the web sign-in button: the click goes there next. */
const GITHUB_MARK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
