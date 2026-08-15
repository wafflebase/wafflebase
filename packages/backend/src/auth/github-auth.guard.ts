import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { CookieOptions } from 'express';
import {
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { CliAuthStore } from './cli-auth.store';

/**
 * Cookie holding the browser flow's OAuth `state`, double-submitted back by
 * GitHub's redirect and compared on the callback.
 */
export const OAUTH_STATE_COOKIE = 'wafflebase_oauth_state';

/**
 * Cookie holding the CLI login's browser binding.
 *
 * Deliberately *not* `OAUTH_STATE_COOKIE`. The two flows start independently
 * and a browser can hold both at once — a `wafflebase login` run while a
 * browser sign-in sits on GitHub's consent screen is an ordinary Tuesday. One
 * shared name means the second start overwrites the first's binding and the
 * first callback is refused as a forgery, which is a login that fails for a
 * reason no one can see. Separate names let the two run side by side; the
 * callback already knows which flow it is validating, so it reads the one it
 * issued.
 *
 * Two logins of the *same* flow are covered too, and not by a third name: a
 * cookie carries up to `MAX_CONCURRENT_LOGINS` bindings and a callback spends
 * the one it matches. See `issueLoginCookie`.
 */
export const CLI_STATE_COOKIE = 'wafflebase_cli_state';

/**
 * Cookie holding the half of the CLI consent click that a crafted link cannot
 * carry; see `GitHubAuthGuard`'s class comment.
 */
export const CLI_CONFIRM_COOKIE = 'wafflebase_cli_confirm';

/** Query parameter presenting the other half of that consent click. */
export const CLI_CONFIRM_PARAM = 'cli_confirm';

/**
 * Marks a `state` as the browser flow's (cookie-checked) rather than the
 * CLI's (store-checked). The two arrive on the same callback parameter.
 */
export const WEB_STATE_PREFIX = 'w.';

/** The `state` cookie lives only as long as the consent screen takes. */
export const STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

/** Upper bound on the CLI-supplied values we will store and echo back. */
const MAX_NONCE_LENGTH = 128;
/** RFC 7636 §4.1 bounds the `code_challenge` at 43–128 characters. */
const MIN_CHALLENGE_LENGTH = 43;
const MAX_CHALLENGE_LENGTH = 128;

/**
 * An operator's explicit answer for the `Secure` cookie attribute, if any.
 *
 * The derivation below reads one config string, and one config string can be
 * wrong: a deployment that terminates TLS at an edge and then names an
 * `http://` callback URL is served over https while telling this server it is
 * not. `COOKIE_SECURE=true` is how such a deployment says so, and it is
 * checked before anything is derived — an explicit statement about the origin
 * always beats a guess made from a URL that is about GitHub's redirect.
 * `COOKIE_SECURE=false` is the same door in the other direction, for a
 * plain-http origin with no callback URL configured. Anything else (unset, or
 * a value that is neither) leaves the derivation in charge.
 */
function configuredSecureCookies(
  configService: ConfigService,
): boolean | undefined {
  const raw = (configService.get<string>('COOKIE_SECURE') ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

/** The plain-http-in-production warning is a config fact; say it once. */
let warnedPlainHttpProduction = false;

/**
 * Say out loud that this deployment's cookies carry no `Secure` flag.
 *
 * The derivation is a guess, and the case where it can be wrong in the unsafe
 * direction is narrow and nameable: `NODE_ENV=production` (so this is not
 * someone's laptop) with a plain-http callback URL that is not loopback. Then
 * either the deployment really is serving cleartext — where the session token
 * is exposed regardless of any cookie attribute — or the callback URL is stale
 * and a TLS-fronted origin has just had `Secure` dropped from its session
 * cookie. Neither should happen quietly, and the second is fixed by one line
 * of configuration, so the log names it.
 */
function warnIfPlainHttpProduction(configService: ConfigService): void {
  if (warnedPlainHttpProduction) return;
  if (process.env.NODE_ENV !== 'production') return;
  if (loopbackCallback(configService)) return;
  warnedPlainHttpProduction = true;
  new Logger('secureCookies').warn(
    'GITHUB_CALLBACK_URL is http://, so session and login cookies are set ' +
      'without `Secure` and without the `__Host-` prefix. If this deployment ' +
      'is actually served over https, fix the callback URL (or set ' +
      'COOKIE_SECURE=true); otherwise its login traffic is in the clear.',
  );
}

/** Test seam: forget that the warning above has already been emitted. */
export function resetSecureCookieWarning(): void {
  warnedPlainHttpProduction = false;
}

/**
 * Whether login cookies are set `Secure` (and so can carry `__Host-`).
 *
 * `COOKIE_SECURE` decides when it is set; otherwise the deployment's own
 * `GITHUB_CALLBACK_URL` does. That URL is where GitHub redirects the login, so
 * its scheme *is* this server's public scheme, and reading a configured value
 * rather than the live request keeps the answer identical on the request that
 * sets the cookie and the callback that reads it — which a per-request
 * `req.secure` behind a proxy would not.
 *
 * `NODE_ENV === 'production'` is only the fallback for a deployment that
 * configures no callback URL at all, and deliberately not an override.
 * Checking it first broke the rule in *both* directions. It dropped the
 * prefix — the only thing that stops a sibling subdomain from planting the
 * browser's half of the double submit — on every https deployment that does
 * not happen to set the variable. And, because the shipped image sets
 * `NODE_ENV=production` (`Dockerfile`) while the self-hosting docs hand out an
 * `http://` callback URL, it set `Secure`/`__Host-` cookies on a plain-http
 * origin, where the browser discards them on arrival. That is not a hardened
 * login but a dead one: the callback never finds its state cookie and
 * redirects to `/login?error=login_state`, and the CLI consent page re-renders
 * forever because the click it waits for can never present its half.
 * `secureCookies` is what says whether a plain-http origin is a development
 * box or a misconfigured production one, so it has to answer for the origin
 * actually being served.
 *
 * The residual risk is that one config string now decides the *session*
 * cookie's `Secure` flag too, so a stale `http://` callback URL on a
 * TLS-terminating deployment downgrades it. That is what `COOKIE_SECURE`
 * overrides and what `warnIfPlainHttpProduction` refuses to let pass in
 * silence; what it is not is a reason to go back to `NODE_ENV`, which got the
 * same deployment wrong in the direction that logs nothing because nothing
 * runs — no session at all.
 */
export function secureCookies(configService: ConfigService): boolean {
  const configured = configuredSecureCookies(configService);
  if (configured !== undefined) return configured;

  const callbackUrl = (configService.get<string>('GITHUB_CALLBACK_URL') ?? '')
    .trimStart()
    .toLowerCase();
  if (callbackUrl.startsWith('https://')) return true;
  if (callbackUrl.startsWith('http://')) {
    warnIfPlainHttpProduction(configService);
    return false;
  }
  return process.env.NODE_ENV === 'production';
}

/**
 * Whether a plain-http origin here never leaves the machine it serves.
 *
 * `127.0.0.0/8` and `localhost` are the loopback the CLI flow is built around
 * (RFC 8252 §8.3); an unset or unparseable callback URL is not one of them,
 * because "we cannot tell what this deployment's public origin is" must not
 * read as "it is safe".
 */
function loopbackCallback(configService: ConfigService): boolean {
  const configured = configService.get<string>('GITHUB_CALLBACK_URL') ?? '';
  let host: string;
  try {
    host = new URL(configured).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * Whether a CLI login can be held shut on this deployment.
 *
 * The consent gate is one cookie: the interstitial sets a token and only a
 * request presenting both halves continues. Without `Secure` the cookie is not
 * `__Host-` prefixed (see `loginCookieName`), which makes it an ordinary host
 * cookie that a sibling subdomain — or anyone with a network position on
 * cleartext — can write. Whoever can write it also holds the query half, since
 * one unauthenticated start hands out a matching pair, so on such an origin the
 * click a crafted link cannot carry becomes a click it can, and the page naming
 * the port is never shown to the person it protects.
 *
 * Loopback is the exception, and only there: planting a cookie on
 * `http://localhost` already means running code on the machine the terminal is
 * on, which is the thing this flow protects. Every other plain-http origin is
 * refused rather than started — the authorization code and the token it buys
 * cross the network in the clear there anyway, so this names a deployment that
 * cannot carry a CLI login instead of narrowing one that can.
 */
function cliLoginAvailable(configService: ConfigService): boolean {
  return secureCookies(configService) || loopbackCallback(configService);
}

/**
 * The wire name of a login cookie.
 *
 * `__Host-` is not decoration: without it these are ordinary host cookies, and
 * any sibling subdomain (or anything that can inject a `Set-Cookie` for the
 * registrable domain) can write the browser's half of the double submit —
 * and, as `stateSignature` explains, whoever can write that half can obtain
 * the query half for free. The prefix makes the browser refuse such a cookie:
 * it is only accepted from the exact host, with `Secure` and `Path=/` and no
 * `Domain`. It is the control here, not a bonus, so it is applied to every
 * deployment served over https rather than only to `NODE_ENV=production`. It
 * requires `Secure`, so a plain-http origin (localhost development) still gets
 * the bare name — and, with it, no defence against an attacker who can plant
 * cookies on that origin.
 */
export function loginCookieName(
  configService: ConfigService,
  base: string,
): string {
  return secureCookies(configService) ? `__Host-${base}` : base;
}

/**
 * Attributes for a login cookie. `Path=/` is forced by `__Host-`; the cookie
 * is httpOnly, single-use and expires with the consent screen, so the wider
 * path costs nothing.
 */
export function loginCookieOptions(configService: ConfigService): CookieOptions {
  return {
    httpOnly: true,
    secure: secureCookies(configService),
    sameSite: 'lax',
    path: '/',
  };
}

/**
 * How many logins of one flow a single browser may have in flight.
 *
 * Each login's binding is a separate value inside its flow's cookie rather
 * than a cookie of its own, because a cookie *name* per login would have to
 * be guessable from the callback — and anything the callback can guess, a
 * crafted start can also plant. A short ring keeps the cookie small (three
 * 43-character values) and bounds what one browser can make the server carry,
 * while covering the cases that actually happen: two `wafflebase login` runs,
 * or a login page opened in two tabs.
 */
export const MAX_CONCURRENT_LOGINS = 3;

/**
 * Separator between the bindings inside one login cookie. Every value is
 * `base64url`, whose alphabet excludes `.`, so no value can contain it and
 * the split is unambiguous.
 */
const BINDING_SEPARATOR = '.';

/** The bindings a login cookie carries, oldest first. */
export function loginCookieValues(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(BINDING_SEPARATOR).filter((value) => value !== '');
}

/** The wire value of a login cookie holding `values`. */
export function joinLoginCookieValues(values: readonly string[]): string {
  return values.join(BINDING_SEPARATOR);
}

/** Constant-time compare of two login secrets (never leak by timing). */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Only used when `JWT_SECRET` is unset — a deployment whose sessions are
 * already broken. Random per process rather than a constant, so a
 * misconfigured server refuses cross-replica callbacks instead of signing
 * bindings with a value an attacker can read out of this file.
 */
const EPHEMERAL_BINDING_SECRET = randomBytes(32).toString('base64url');

/**
 * HKDF (RFC 5869) domain separator for the login-binding key. Versioned:
 * changing the label rotates the key, which invalidates every login already
 * in flight and nothing else.
 */
const BINDING_KEY_INFO = 'wafflebase/oauth-login-binding/v1';

/** Memoized derivation — the input is one config value that does not move. */
let derivedBindingKey: { from: string; key: string } | undefined;

/**
 * The key the login bindings are signed with; see `stateSignature`.
 *
 * Deliberately *not* `JWT_SECRET` itself, though that is where it comes from.
 * `GET /auth/github` is unauthenticated and a single request hands the caller
 * both halves of a signature — the input in `Set-Cookie`, the output in the
 * redirect's `state`. Whatever key signs that is therefore published as a
 * verified (input, MAC) pair to anyone who asks, and signing it with the very
 * key that signs session JWTs turned an anonymous request into an oracle for
 * the session-signing key. Key separation is the fix, and HKDF gives it
 * without new configuration: the subkey is deterministic, so replicas agree
 * and a callback may still land on a different one than the start, and every
 * existing deployment derives it from the `JWT_SECRET` it already sets.
 *
 * What derivation does not do is make a guessable secret safe: an attacker
 * can still test candidate `JWT_SECRET`s *through* the derivation, exactly as
 * they can against any HS256 JWT this server has ever issued. Separation
 * bounds the reuse, not the entropy. A deployment that wants the published
 * pair to say nothing whatever about its session key sets
 * `OAUTH_STATE_SECRET` to an independent high-entropy value; unset — the
 * normal case, and the one every current install is in — the derived subkey
 * is used and nothing has to change.
 */
export function bindingSecret(configService: ConfigService): string {
  const dedicated = configService.get<string>('OAUTH_STATE_SECRET');
  if (dedicated) return dedicated;

  const base =
    // `||`, not `??`: `hkdfSync` accepts zero-length key material and answers
    // a fixed key that anyone can recompute from this file, so an empty
    // `JWT_SECRET` would derive a *publicly known* signing key rather than
    // take the random fallback meant for exactly that deployment.
    configService.get<string>('JWT_SECRET') || EPHEMERAL_BINDING_SECRET;
  if (derivedBindingKey?.from !== base) {
    derivedBindingKey = {
      from: base,
      key: Buffer.from(
        hkdfSync('sha256', base, '', BINDING_KEY_INFO, 32),
      ).toString('base64url'),
    };
  }
  return derivedBindingKey.key;
}

/**
 * The `state` value that belongs to a given cookie value.
 *
 * What this does buy: the browser flow needs no server-side entry, so a
 * callback may land on a different replica than the start, and a `state` the
 * server never issued cannot be invented.
 *
 * What it does **not** buy, despite the shape suggesting otherwise: protection
 * against an attacker who can plant cookies. `GET /auth/github` is
 * unauthenticated, and one request hands the caller a matching pair — the
 * cookie in `Set-Cookie`, its signature in the `Location`'s `state`. An
 * attacker who can write the victim's cookie jar therefore just harvests a
 * pair and plants its cookie half, and signing changes nothing. Cookie
 * planting is closed by `__Host-` (see `loginCookieName`) and by nothing else
 * here; do not read this signature as a second line of defence against it.
 *
 * Because that pair is published to anyone who asks, the key must not be one
 * that anything else depends on — see `bindingSecret`.
 */
export function stateSignature(secret: string, cookieValue: string): string {
  return createHmac('sha256', secret).update(cookieValue).digest('base64url');
}

/** The CLI parameters one consent page was rendered for. */
export interface CliConsentParams {
  port: number;
  nonce: string;
  codeChallenge: string;
}

/** What the CLI consent interstitial needs to render itself. */
export interface CliConsentRequest extends CliConsentParams {
  confirmToken: string;
}

/**
 * The `cli_confirm` value that belongs to one consent page.
 *
 * The token used to be a bare copy of the cookie, which proved only that this
 * browser had been shown *some* consent page in the last five minutes — not
 * the page naming port 9876. That is the wrong claim: the entire defence is
 * that a person read the port on the page they clicked, so a confirmation
 * obtained for one set of parameters must not be spendable against another
 * (an attacker-owned loopback listener, say) without a second page being
 * shown. Signing the parameters into the token binds it to what was
 * displayed: the guard recomputes it from the request's *own* `port`, `nonce`
 * and `code_challenge`, so changing any of them invalidates the confirmation.
 *
 * A crafted link still cannot pre-supply it — computing the token needs the
 * cookie half, which is httpOnly and set by the page itself, and the key.
 *
 * Each part is length-prefixed so no combination of values can be re-cut into
 * a different one that signs the same (`"9|87,6"` vs `"98|7,6"`).
 */
export function consentToken(
  secret: string,
  cookieValue: string,
  params: CliConsentParams,
): string {
  const parts = [
    cookieValue,
    String(params.port),
    params.nonce,
    params.codeChallenge,
  ];
  return createHmac('sha256', secret)
    .update(parts.map((part) => `${part.length}:${part}`).join('|'))
    .digest('base64url');
}

/**
 * A query value we are willing to remember, or `undefined`.
 *
 * Anything the CLI sends is attacker-influenceable — it reaches this guard
 * straight off the query string — so it is length-bounded before it is
 * stored, and (for the challenge) restricted to the base64url alphabet so
 * nothing that lands in a redirect URL or a log line can carry structure.
 */
function boundedToken(
  value: unknown,
  min: number,
  max: number,
  pattern?: RegExp,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length < min || value.length > max) return undefined;
  if (pattern && !pattern.test(value)) return undefined;
  return value;
}

/**
 * Custom GitHub OAuth guard that puts a `state` on every authorization
 * request it starts, so the callback always has something to validate.
 *
 * CLI login params (`?mode=cli&port=<port>&nonce=<nonce>&code_challenge=
 * <challenge>`) are detected here and a state token is injected onto the
 * request so GitHubStrategy.authenticate() can forward it to GitHub.
 *
 * A browser login gets a `state` too: the HMAC of a random value held in a
 * short-lived first-party cookie, sent to GitHub under the `w.` prefix and
 * recomputed from the cookie on the callback. It is a double submit rather
 * than a server-side entry because the callback may land on a different
 * replica than the one that started the login. Without any of it the callback
 * accepted any GitHub redirect, which is a forced-login CSRF: an attacker
 * completes consent for their own account and gets the victim's browser
 * issued cookies for it. What holds that shut is the *cookie* — the signature
 * only proves this server issued some start, and an attacker who can write
 * the victim's cookie jar can harvest a matching pair from one unauthenticated
 * request (see `stateSignature`). Cookie planting is closed by `__Host-`,
 * which is why it now follows the deployment's scheme rather than `NODE_ENV`.
 *
 * A CLI login carries four bindings, and the first three are required — a
 * login that is missing one is refused rather than started, because "the
 * client did not send it" and "this login is unbound" are the same request on
 * the wire:
 *
 * - `nonce` is remembered with the state and handed back to the CLI's
 *   localhost callback, which redeems a code only for its own flow.
 * - `code_challenge` (PKCE S256) rides onto the authorization code, so
 *   redeeming it takes the verifier the CLI never sent.
 * - a cookie, exactly like the browser flow's, ties the state to the browser
 *   that started it. Without it an attacker can mint a CLI state pointing at
 *   a loopback port they own and phish the victim through GitHub's consent
 *   screen, capturing an authorization code for the victim's account on a
 *   shared host — an attack neither of the other two bindings sees, since the
 *   attacker holds both the nonce and the verifier.
 * - a human confirmation. The three bindings above all assume the *start* URL
 *   was the CLI's; none of them looks at a victim who simply clicks
 *   `…/auth/github?mode=cli&port=<attacker's listener>`, where the attacker
 *   holds the nonce and the verifier because the attacker wrote the link. So
 *   a CLI start never redirects to GitHub on its own: it renders an
 *   interstitial naming the loopback port, and only a click on that page —
 *   which echoes a token the page itself set as a cookie, so a crafted link
 *   cannot pre-supply it — starts the login. The token also signs the
 *   parameters the page displayed (`consentToken`), so it authorizes that
 *   port and no other; the claim it makes is "this browser was shown the page
 *   naming port 9876", not "some consent page, once, recently".
 *
 * The cost is that a CLI predating the parameters can no longer log in: it
 * gets a `400` naming what is missing instead of a login with the injection
 * of RFC 8252 §8.9 left open. `--api-key` needs no browser at all.
 */
@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {
  constructor(
    private readonly cliAuthStore: CliAuthStore,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const mode = req.query?.mode;
    const port = req.query?.port;

    if (mode === 'cli') {
      // The consent click below rests entirely on a cookie an attacker must
      // not be able to plant, and on a plain-http origin that is not loopback
      // they can — see `cliLoginAvailable`. Refuse the flow there rather than
      // run it behind a gate anyone on the origin can open: the person would
      // never see the page naming the port, which is the only thing standing
      // between a link they were sent and a code at someone else's listener.
      if (!cliLoginAvailable(this.configService)) {
        throw new BadRequestException(
          'Command-line sign-in requires an https server',
        );
      }

      // Missing and malformed are the same failure: a login that continues
      // without one of these is a bearer-only code at a guessable loopback
      // port, and neither end can see the downgrade (a copy-pasted start
      // URL truncated at the terminal edge looks exactly like an older
      // client). Refusing costs an upgrade; accepting costs the account.
      //
      // The port is held to that rule too. Falling through to the browser
      // flow instead — which is what an unusable port used to do — is the
      // worst of both: the person is walked through GitHub and issued real
      // session cookies for a login they asked to give to a terminal, while
      // the CLI waits out its timeout on a callback that will never come.
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
        throw new BadRequestException('Missing or invalid port');
      }

      const nonce = boundedToken(req.query?.nonce, 1, MAX_NONCE_LENGTH);
      if (nonce === undefined) {
        throw new BadRequestException('Missing or invalid nonce');
      }

      const codeChallenge = boundedToken(
        req.query?.code_challenge,
        MIN_CHALLENGE_LENGTH,
        MAX_CHALLENGE_LENGTH,
        /^[A-Za-z0-9\-._~]+$/,
      );
      if (codeChallenge === undefined) {
        throw new BadRequestException('Missing or invalid code_challenge');
      }

      const params: CliConsentParams = { port: portNum, nonce, codeChallenge };

      // Nothing about this request says the CLI wrote it — an attacker's
      // link reaches here identically, pointing `port` at a listener they
      // own. Stop before GitHub and ask the person, once, naming the port.
      // The confirmation is checked against *these* parameters, so a click
      // consented for one port does not carry another (see `consentToken`).
      const confirmed = this.matchedConfirmation(req, params);
      if (confirmed === undefined) {
        const consent: CliConsentRequest = {
          ...params,
          confirmToken: consentToken(
            bindingSecret(this.configService),
            this.issueLoginCookie(context, CLI_CONFIRM_COOKIE),
            params,
          ),
        };
        req.__cliConsent = consent;
        return true;
      }

      this.spendLoginCookie(context, CLI_CONFIRM_COOKIE, confirmed);
      const { stateToken } = this.cliAuthStore.createState({
        mode,
        port: portNum,
        browserBinding: this.issueLoginCookie(context, CLI_STATE_COOKIE),
        nonce,
        codeChallenge,
      });
      req.__oauthState = stateToken;
    }

    if (!req.__oauthState) {
      const binding = this.issueLoginCookie(context, OAUTH_STATE_COOKIE);
      req.__oauthState = `${WEB_STATE_PREFIX}${stateSignature(
        bindingSecret(this.configService),
        binding,
      )}`;
    }

    return super.canActivate(context);
  }

  /**
   * Whether this request carries both halves of the CLI consent click *for
   * the parameters it is asking to start with*.
   *
   * The query half is not a copy of the cookie but a signature over the
   * cookie and the consented parameters, recomputed here from the request's
   * own `port`, `nonce` and `code_challenge`. A confirmation obtained for a
   * different port therefore does not verify, and the person sees the page
   * naming the new one instead.
   *
   * Returns the cookie value the click belongs to, so the caller can spend
   * that one and leave any other consent page this browser has open alone.
   */
  private matchedConfirmation(
    req: {
      query?: Record<string, unknown>;
      cookies?: Record<string, unknown>;
    },
    params: CliConsentParams,
  ): string | undefined {
    const presented = req.query?.[CLI_CONFIRM_PARAM];
    if (typeof presented !== 'string') return undefined;
    const secret = bindingSecret(this.configService);
    return loginCookieValues(
      req.cookies?.[loginCookieName(this.configService, CLI_CONFIRM_COOKIE)],
    ).find((value) =>
      secretEquals(consentToken(secret, value, params), presented),
    );
  }

  /**
   * Mint one half of a login's double submit and add it to the cookie holding
   * this flow's bindings.
   *
   * Both flows use it: the browser sends the signature of the value to GitHub
   * under the `w.` prefix, the CLI keeps the value itself beside its state
   * entry. `SameSite=Lax` still travels on GitHub's top-level redirect back
   * here, which is the only request that reads it.
   *
   * The new value is *appended* to whatever the browser already holds rather
   * than replacing it. Separate names already let the browser and CLI flows
   * run side by side, but a second login of the *same* flow — two
   * `wafflebase login` runs, or the login page opened in two tabs — used to
   * overwrite the first's binding, and the first callback was then refused as
   * a forgery: a login that fails for a reason nobody can see, which is
   * exactly what the separate names were introduced to prevent. Oldest go
   * first once the ring is full, so the login most recently started — the one
   * a person is looking at — is always the one that survives.
   */
  private issueLoginCookie(context: ExecutionContext, base: string): string {
    const value = randomBytes(32).toString('base64url');
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    // The cookie is the binding, not a nicety: without a response that can
    // set it, every callback would be refused. Fail here, where the reason
    // is visible, rather than at a callback that looks like a CSRF hit.
    if (typeof res?.cookie !== 'function') {
      throw new InternalServerErrorException('Cannot start a login session');
    }
    const name = loginCookieName(this.configService, base);
    const kept = loginCookieValues(req?.cookies?.[name]).slice(
      -(MAX_CONCURRENT_LOGINS - 1),
    );
    res.cookie(name, joinLoginCookieValues([...kept, value]), {
      ...loginCookieOptions(this.configService),
      maxAge: STATE_COOKIE_MAX_AGE_MS,
    });
    return value;
  }

  /**
   * Spend one binding: it authorizes exactly one start, and the browser's
   * other in-flight logins of the same flow keep theirs.
   */
  private spendLoginCookie(
    context: ExecutionContext,
    base: string,
    spent: string,
  ): void {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const name = loginCookieName(this.configService, base);
    const options = loginCookieOptions(this.configService);
    const remaining = loginCookieValues(req?.cookies?.[name]).filter(
      (value) => value !== spent,
    );

    if (remaining.length === 0) {
      if (typeof res?.clearCookie === 'function') res.clearCookie(name, options);
      return;
    }
    if (typeof res?.cookie === 'function') {
      res.cookie(name, joinLoginCookieValues(remaining), {
        ...options,
        maxAge: STATE_COOKIE_MAX_AGE_MS,
      });
    }
  }
}
