import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
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
 * Whether login cookies are set `Secure` (and so can carry `__Host-`).
 *
 * The deployment's own `GITHUB_CALLBACK_URL` decides. It is the URL GitHub
 * redirects the login to, so its scheme *is* this server's public scheme, and
 * reading a configured value rather than the live request keeps the answer
 * identical on the request that sets the cookie and the callback that reads
 * it — which a per-request `req.secure` behind a proxy would not.
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
 */
export function secureCookies(configService: ConfigService): boolean {
  const callbackUrl = (configService.get<string>('GITHUB_CALLBACK_URL') ?? '')
    .trimStart()
    .toLowerCase();
  if (callbackUrl.startsWith('https://')) return true;
  if (callbackUrl.startsWith('http://')) return false;
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
    configService.get<string>('JWT_SECRET') ?? EPHEMERAL_BINDING_SECRET;
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
      if (!this.hasConfirmation(req, params)) {
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

      this.clearLoginCookie(context, CLI_CONFIRM_COOKIE);
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
   */
  private hasConfirmation(
    req: {
      query?: Record<string, unknown>;
      cookies?: Record<string, unknown>;
    },
    params: CliConsentParams,
  ): boolean {
    const presented = req.query?.[CLI_CONFIRM_PARAM];
    const cookie =
      req.cookies?.[loginCookieName(this.configService, CLI_CONFIRM_COOKIE)];
    if (typeof presented !== 'string' || typeof cookie !== 'string') {
      return false;
    }
    return secretEquals(
      consentToken(bindingSecret(this.configService), cookie, params),
      presented,
    );
  }

  /**
   * Mint one half of a login's double submit and set the cookie holding it.
   *
   * Both flows use it: the browser sends the signature of the value to GitHub
   * under the `w.` prefix, the CLI keeps the value itself beside its state
   * entry. `SameSite=Lax` still travels on GitHub's top-level redirect back
   * here, which is the only request that reads it.
   */
  private issueLoginCookie(context: ExecutionContext, base: string): string {
    const value = randomBytes(32).toString('base64url');
    const res = context.switchToHttp().getResponse();
    // The cookie is the binding, not a nicety: without a response that can
    // set it, every callback would be refused. Fail here, where the reason
    // is visible, rather than at a callback that looks like a CSRF hit.
    if (typeof res?.cookie !== 'function') {
      throw new InternalServerErrorException('Cannot start a login session');
    }
    res.cookie(loginCookieName(this.configService, base), value, {
      ...loginCookieOptions(this.configService),
      maxAge: STATE_COOKIE_MAX_AGE_MS,
    });
    return value;
  }

  /** Spend a login cookie: it authorizes exactly one start. */
  private clearLoginCookie(context: ExecutionContext, base: string): void {
    const res = context.switchToHttp().getResponse();
    if (typeof res?.clearCookie === 'function') {
      res.clearCookie(
        loginCookieName(this.configService, base),
        loginCookieOptions(this.configService),
      );
    }
  }
}
