import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { CliAuthStore } from './cli-auth.store';
import {
  cliStateCookieName,
  cliStateCookieOptions,
  createWebOAuthState,
  oauthStateCookieName,
  oauthStateCookieOptions,
  useSecureCookies,
} from './oauth-state';

/** Hostnames the browser treats as a secure context over plain http. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Whether the configured callback URL points at this machine.
 *
 * A browser grants loopback origins the secure-context privileges an
 * `https://` origin gets, so `http://localhost:3000` is not the cleartext
 * deployment the checks below are about — it is how everyone develops, and
 * refusing a CLI login there would refuse it on the only origin where the
 * whole flow is routinely exercised.
 */
export function loopbackCallback(): boolean {
  const host = callbackHost();
  if (host === undefined) return false;
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost');
}

/** The configured callback URL's hostname, lowercased, or `undefined`. */
function callbackHost(): string | undefined {
  const raw = (process.env.GITHUB_CALLBACK_URL ?? '').trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Whether `wafflebase login` may be started against this deployment.
 *
 * The CLI login's one defence against a page navigating a victim into it is
 * the consent click, and that click is proven by a cookie
 * (`wafflebase_cli_confirm`). On a cleartext non-loopback origin that cookie
 * is worth nothing: it cannot carry `Secure` or the `__Host-` prefix, so
 * anything on the network path — and anything on a sibling subdomain — can
 * both read and plant it, and the gate walks itself through. The code the
 * flow then mints is a full session, delivered over a plaintext hop to a port
 * named in a query string.
 *
 * So such a deployment refuses to start one at all rather than serving a gate
 * that only looks like one. The browser login stays available: its state is a
 * double-submit pair whose failure mode is a refused login, not a stolen one,
 * and refusing it would leave the deployment with no way in.
 *
 * The refusal needs *positive* evidence of a cleartext non-loopback origin,
 * which is why an install that configures no callback URL at all is not
 * refused: there is no origin to read, GitHub's OAuth flow cannot complete
 * without one anyway, and guessing "insecure" from an absent variable would
 * break every unit-level and CI run of the flow rather than any real
 * deployment.
 */
export function cliLoginAvailable(): boolean {
  if (useSecureCookies() || loopbackCallback()) return true;
  return callbackHost() === undefined;
}

/**
 * Whether this is a `NODE_ENV=production` install whose session cookies go
 * out without `Secure` — the shape a TLS-terminating proxy produces when the
 * backend is still configured with an `http://` callback URL.
 *
 * An explicit `COOKIE_SECURE=false` does not silence it. That variable states
 * the origin's scheme; it does not make cleartext session cookies in
 * production any less of a finding, and the only reading under which the
 * warning would be noise is a loopback origin, which is excluded already.
 */
export function insecureProductionOrigin(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    !useSecureCookies() &&
    !loopbackCallback()
  );
}

/**
 * Accept only a hex nonce of a sane length. The value is echoed back on
 * a redirect to the CLI's loopback callback, so nothing but `[0-9a-f]`
 * is allowed through — no delimiters, no room to smuggle query params.
 */
export function parseCliNonce(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return /^[0-9a-f]{32,128}$/.test(raw) ? raw : undefined;
}

/**
 * Accept only a base64url SHA-256 digest, which is exactly 43 characters.
 * This is the PKCE-style `challenge` half of the CLI login: the hash of a
 * verifier the CLI keeps in memory, redeemed at
 * `POST /auth/cli/exchange`. It is not a secret — it travels in the start
 * URL and through the confirmation page — but it is interpolated into
 * that page's link, so the vocabulary stays closed.
 */
export function parseCliChallenge(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined;
}

/**
 * `Sec-Fetch-Site` values a CLI login may legitimately arrive with. See
 * `GitHubAuthGuard.assertCliStartNotCrossSite`.
 */
const ALLOWED_FETCH_SITES = new Set(['none', 'same-origin', 'same-site']);

/**
 * The browser's `Sec-Fetch-Site` verdict, lowercased, or `undefined` when
 * the request carries nothing readable.
 *
 * Only a browser sets this header, so a value arriving twice (express
 * hands those back as an array) or folded into one comma-joined string by
 * a proxy is an artefact of the hop, not an attack: the first token is
 * taken rather than the whole thing being failed as an unknown value. An
 * empty value is treated as absent for the same reason.
 */
export function parseFetchSite(raw: unknown): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return undefined;
  const value = first.split(',')[0].trim().toLowerCase();
  return value === '' ? undefined : value;
}

/** The loopback port, or `undefined` when it is not a usable one. */
export function parseCliPort(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
  return port;
}

/**
 * Custom GitHub OAuth guard that attaches the `state` parameter
 * `GitHubStrategy.authenticate()` forwards to GitHub. Every login gets
 * one — there is no stateless path:
 *
 * - **CLI** (`?mode=cli&port=<port>&nonce=<hex>&challenge=<s256>`) — a
 *   token from `CliAuthStore` carrying the port, the CLI's nonce and its
 *   PKCE challenge, so the callback can redirect the code to the loopback
 *   server and bind it to the verifier only that CLI process holds (see
 *   `login.ts`). Minted
 *   only once `CliLoginConfirmMiddleware` has seen the user click through
 *   the confirmation page; without that flag this degrades to an ordinary
 *   browser login rather than silently minting a code for whoever framed
 *   the request. The token is paired with a cookie secret
 *   (`cliStateCookieName()`) so it is bound to this browser, exactly as
 *   the browser state is: the confirmation click gates the *mint*, and
 *   an attacker can perform it in their own browser, so without the
 *   cookie the resulting state could simply be handed to a victim.
 * - **Browser** — a double-submit cookie pair (see `oauth-state.ts`).
 *   Without it, `/auth/github/callback` would set session cookies for any
 *   code presented to it, which is login CSRF / session fixation.
 *
 * Ahead of the CLI branch only, a `?mode=cli` start another *site*
 * navigated the browser into is refused outright
 * (`assertCliStartNotCrossSite`). Neither state mechanism covers that on
 * its own — the navigation carrying the attack is also the navigation
 * that mints the state and sets its cookie. A CLI start is also refused
 * outright on a deployment where the consent cookie cannot be `Secure`
 * (`assertCliLoginAvailable`).
 */
@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {
  private readonly logger = new Logger(GitHubAuthGuard.name);

  constructor(private readonly cliAuthStore: CliAuthStore) {
    super();
  }

  /** One line per process, not one per login. */
  private warnedInsecureOrigin = false;

  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse<Response>();
    this.warnIfInsecureOrigin();
    const isCliStart = req.query?.mode === 'cli';
    if (isCliStart) {
      this.assertCliStartNotCrossSite(req);
      this.assertCliLoginAvailable();
    }
    const port = parseCliPort(req.query?.port);

    if (isCliStart && port !== undefined && req.__cliConfirmed) {
      const { stateToken, csrf } = this.cliAuthStore.createState(
        'cli',
        port,
        parseCliNonce(req.query?.nonce),
        parseCliChallenge(req.query?.challenge),
      );
      // The state token alone is transferable — it goes through GitHub in
      // a URL. This cookie is what ties it to *this* browser, and the
      // callback will not consume the state without it.
      res.cookie(cliStateCookieName(), csrf, cliStateCookieOptions());
      req.__oauthState = stateToken;
    } else {
      const { secret, state } = createWebOAuthState();
      res.cookie(oauthStateCookieName(), secret, oauthStateCookieOptions());
      req.__oauthState = state;
    }

    return super.canActivate(context);
  }

  /**
   * Refuse to start a CLI login where its consent cookie is plantable.
   *
   * See `cliLoginAvailable`. The refusal is a 400 with the remedy in it
   * rather than a silent downgrade to a browser login, because the person
   * running `wafflebase login` is waiting on a loopback callback that would
   * otherwise never arrive and would time out five minutes later with
   * nothing to act on.
   */
  private assertCliLoginAvailable() {
    if (cliLoginAvailable()) return;
    this.logger.warn(
      'Refused a CLI login: this origin is plain http and not loopback, ' +
        'so the consent cookie cannot be Secure.',
    );
    throw new BadRequestException(
      'Command-line sign-in requires an https server. Serve Wafflebase ' +
        'over https and set GITHUB_CALLBACK_URL to that URL (or set ' +
        'COOKIE_SECURE=true if TLS terminates at a proxy in front of it). ' +
        'The browser sign-in still works, and `--api-key` needs no login.',
    );
  }

  /**
   * Say so, once, when session cookies leave a production install in the
   * clear (`insecureProductionOrigin`).
   *
   * At the first login rather than at bootstrap: this is the code path that
   * actually writes the cookie, so the warning cannot claim a downgrade a
   * deployment never reaches, and it lands in the log next to the request it
   * is about.
   */
  private warnIfInsecureOrigin() {
    if (this.warnedInsecureOrigin || !insecureProductionOrigin()) return;
    this.warnedInsecureOrigin = true;
    this.logger.warn(
      'Session cookies are being issued without `Secure` on a ' +
        'NODE_ENV=production install: this origin reads as cleartext and is ' +
        'not loopback (GITHUB_CALLBACK_URL, or COOKIE_SECURE=false saying ' +
        'so). Point GITHUB_CALLBACK_URL at the https URL your users reach, ' +
        'or set COOKIE_SECURE=true if TLS terminates at a proxy.',
    );
  }

  /**
   * Refuse a `?mode=cli` start another site navigated the browser into.
   *
   * How a CLI login may legitimately be started, as the browser reports
   * it:
   *
   * - `none` — typed, bookmarked, or opened by another program. This is
   *   the CLI's own shape: `wafflebase login` hands the URL to the OS
   *   opener.
   * - `same-origin` / `same-site` — the click through
   *   `CliLoginConfirmMiddleware`'s confirmation page, which this
   *   backend served itself.
   *
   * `cross-site` is refused: that is a hostile page navigating the
   * victim's browser into a CLI login it chose the parameters of, so a
   * code minted from the victim's GitHub session would be delivered to
   * an attacker-chosen loopback port.
   *
   * **Only the CLI branch is checked.** A browser login is routinely
   * cross-site by construction — the login link lives on the frontend
   * origin and points at `VITE_BACKEND_API_URL`, which need not share a
   * site with it — so refusing `cross-site` here would 400 every sign-in
   * on such a deployment. Nothing is lost by allowing it: the web flow's
   * double-submit `state` cookie is set and read on the *backend's* own
   * origin, so it neither depends on the frontend's site nor can be
   * completed by an attacker whose browser holds the other half. The
   * loopback delivery the CLI branch guards has no such equivalent.
   *
   * A missing `Sec-Fetch-Site` is allowed: it means a client that does
   * not send the header at all, which is not the attack shape — the
   * attack needs the victim's *browser*, carrying the victim's GitHub
   * session, and every browser that can be steered cross-site also sends
   * this.
   */
  private assertCliStartNotCrossSite(req: Request) {
    const value = parseFetchSite(req.headers?.['sec-fetch-site']);
    if (value === undefined) return;
    if (ALLOWED_FETCH_SITES.has(value)) return;
    this.logger.warn(
      `Refused a cross-site-initiated CLI login (Sec-Fetch-Site: ${value}).`,
    );
    throw new BadRequestException(
      'Start the login from Wafflebase itself (or run `wafflebase login`).',
    );
  }
}
