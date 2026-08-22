import { Command } from 'commander';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  loadSession,
  saveSession,
  decodeJwtExpiry,
} from '../config/session.js';
import type { Session, WorkspaceInfo } from '../config/session.js';
import { DEFAULT_SERVER } from '../config/config.js';
import {
  EXIT_USER_ERROR,
  SystemError,
  UserError,
  exitCodeFor,
  exitCodeForStatus,
  fetchOrThrow,
} from '../errors.js';

/**
 * A login failure worth reporting as prose. The exit code comes from the
 * same `exitCodeForStatus` table the API commands use, so a stale CLI
 * code (400) stays a user error while a rejected token or a broken
 * server (401/403/5xx) reports a system error.
 */
export class LoginError extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

function loginHttpError(status: number, message: string): LoginError {
  return new LoginError(exitCodeForStatus(status), message);
}

/**
 * Exit code for a thrown login failure, or `null` when the throw is not
 * part of the contract (a bug, a local filesystem fault) and should keep
 * its stack trace instead of being flattened to one prose line.
 */
export function classifyLoginFailure(error: unknown): number | null {
  if (
    error instanceof LoginError ||
    error instanceof SystemError ||
    // `fetchOrThrow` raises `UserError('INVALID_URL')` for an
    // unparseable `--server`; without this it escapes `login` as an
    // unhandled rejection instead of the documented one-line message.
    error instanceof UserError
  ) {
    return exitCodeFor(error);
  }
  return null;
}

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Log in via GitHub OAuth in the browser')
    // Escape hatch for a server older than nonce-bound login. Published
    // CLIs and self-hosted backends upgrade independently, so a new CLI
    // must not be unable to log into an old server at all — but the
    // downgrade is the operator's explicit choice, never a silent
    // fallback, because the nonce is what stops a local web page from
    // fixing this CLI onto an attacker's account.
    .option(
      '--allow-unbound-callback',
      'accept a login callback that carries no state (server predates nonce-bound CLI login)',
    )
    .action(async function (this: Command) {
      // `login` prints prose rather than the JSON error body, but it
      // honors the same exit contract: a server that was never reached
      // is a system error, bad input from the caller is not. Anything
      // unclassified is a bug and keeps its stack trace, as before.
      try {
        await runLogin(this.optsWithGlobals<LoginOptions>());
      } catch (e) {
        const exitCode = classifyLoginFailure(e);
        if (exitCode === null) throw e;
        console.error((e as Error).message);
        process.exit(exitCode);
      }
    });
}

interface LoginSession {
  tokens: { accessToken: string; refreshToken: string };
  user: {
    id: number;
    username: string;
    email: string;
    photo: string | null;
  };
  workspaces: WorkspaceInfo[];
}

/**
 * Trade the callback code for a session: tokens, then the user, then the
 * workspace list. Split out of `runLogin` (which owns the browser and
 * the local callback server) so the exit contract of the three HTTP
 * steps is testable with a stubbed `fetch`.
 *
 * `verifier` is the PKCE half of the exchange: the code arrived over a
 * plaintext loopback hop, so redeeming it also requires a value that
 * never left this process (see `createPkcePair`).
 */
export async function fetchLoginSession(
  server: string,
  code: string,
  verifier: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<LoginSession> {
  const exchangeRes = await fetchOrThrow(
    `${server}/auth/cli/exchange`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier }),
    },
    fetchImpl,
  );

  if (!exchangeRes.ok) {
    throw loginHttpError(
      exchangeRes.status,
      `Token exchange failed (HTTP ${exchangeRes.status}). Try again with \`wafflebase login\`.`,
    );
  }

  const tokens = (await exchangeRes.json()) as {
    accessToken: string;
    refreshToken: string;
  };

  const meRes = await fetchOrThrow(
    `${server}/auth/me`,
    { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    fetchImpl,
  );

  if (!meRes.ok) {
    throw loginHttpError(
      meRes.status,
      `Failed to fetch user info (HTTP ${meRes.status}).`,
    );
  }

  const user = (await meRes.json()) as LoginSession['user'];

  const wsRes = await fetchOrThrow(
    `${server}/workspaces`,
    { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    fetchImpl,
  );

  if (!wsRes.ok) {
    throw loginHttpError(
      wsRes.status,
      `Failed to fetch workspaces (HTTP ${wsRes.status}). Try again with \`wafflebase login\`.`,
    );
  }

  const workspaces = (await wsRes.json()) as WorkspaceInfo[];
  return { tokens, user, workspaces };
}

/** The flags `runLogin` reads, resolved from the command line. */
export interface LoginOptions {
  server?: string;
  allowUnboundCallback?: boolean;
}

/**
 * Everything `runLogin` reaches outside its own process step: the
 * session file, the local callback listener, the browser, and the three
 * HTTP calls. Injectable so the flow itself — that a fresh nonce is
 * generated, handed to the listener *and* carried in the OAuth URL, that
 * the PKCE verifier never leaves the process, and that
 * `--allow-unbound-callback` actually reaches the listener — can be
 * driven in a test without an OAuth round trip. Every one of those is a
 * security-relevant wire that would otherwise be verified only by
 * reading the code.
 */
export interface LoginDeps {
  loadSession: typeof loadSession;
  saveSession: typeof saveSession;
  startCallbackServer: typeof startCallbackServer;
  fetchLoginSession: typeof fetchLoginSession;
  openBrowser: (url: string) => Promise<void>;
}

const defaultLoginDeps: LoginDeps = {
  loadSession,
  saveSession,
  startCallbackServer,
  fetchLoginSession,
  openBrowser: async (url) => {
    const open = (await import('open')).default;
    await open(url);
  },
};

export async function runLogin(
  options: LoginOptions,
  overrides: Partial<LoginDeps> = {},
): Promise<void> {
  const deps = { ...defaultLoginDeps, ...overrides };
  const server = (options.server ?? DEFAULT_SERVER).replace(/\/$/, '');

  // 1. Check existing session
  const existing = deps.loadSession();
  if (existing) {
    const answer = await ask(
      `Logged in as ${existing.user.username}. Continue? [Y/n] `,
    );
    if (answer.toLowerCase() === 'n') {
      console.log('Cancelled.');
      return;
    }
  }

  // 2. Start the local HTTP server, bound to a nonce generated here.
  // The callback listener is reachable by anything on the machine (and
  // by any web page that guesses the port), so the code alone must not
  // be enough: otherwise a hostile page can hand us *its* code and fix
  // this CLI onto the attacker's account. The nonce rides through the
  // OAuth round trip, comes back as the callback's `state`, and only a
  // callback echoing it is accepted.
  const nonce = createLoginNonce();
  if (options.allowUnboundCallback) {
    console.error(
      'Warning: --allow-unbound-callback accepts a callback that carries no state. Any local process that reaches the callback port can complete this login.',
    );
  }
  const { port, waitForCallback, close } = await deps.startCallbackServer(
    nonce,
    { allowUnbound: options.allowUnboundCallback === true },
  );

  // 3. Build OAuth URL and open browser. The backend echoes `nonce`
  // back as the loopback callback's `state`, which is what lets the
  // callback server tell our own redirect from a forged one.
  //
  // `challenge` is the PKCE half: the `code` comes back to us over
  // plaintext loopback HTTP, so it must not be redeemable on its own.
  // Only the hash goes out; the verifier stays in this process and is
  // sent once, in the exchange POST body.
  //
  // The URL carries the nonce, so while this login is pending it is a
  // credential: anyone who can both read it and reach this machine's
  // callback port can complete the login as themselves and leave this
  // CLI holding *their* session. It is printed anyway because it is the
  // only fallback when the browser cannot be opened (`open()` resolves
  // when the child process spawns, not when a browser appears, so the
  // CLI cannot tell), and it is the listener's timeout that bounds the
  // exposure. Say so rather than printing it silently.
  const { verifier, challenge } = createPkcePair();
  const oauthUrl = `${server}/auth/github?mode=cli&port=${port}&nonce=${encodeURIComponent(nonce)}&challenge=${encodeURIComponent(challenge)}`;
  console.error(`Opening browser: ${oauthUrl}`);
  console.error(
    'If the browser does not open, visit the URL above. Do not share it while this login is pending — it carries the nonce binding the callback to this terminal.',
  );
  // The server answers this URL with a confirmation page rather than
  // going straight to GitHub — a sign-in the user did not start must
  // not proceed on a bare navigation. Say so, or the wait looks stuck.
  console.error('Confirm the sign-in in the browser to continue.');

  try {
    await deps.openBrowser(oauthUrl);
  } catch {
    // Browser open failed — URL was already printed
  }

  // 4. Wait for callback
  let code: string;
  try {
    code = await waitForCallback();
  } finally {
    close();
  }

  // 5-7. Exchange the code for tokens, then read the user and workspaces.
  const { tokens, user, workspaces } = await deps.fetchLoginSession(
    server,
    code,
    verifier,
  );

  // 8. Select workspace
  let activeWorkspace = '';
  if (workspaces.length === 0) {
    console.log('No workspaces found.');
  } else if (workspaces.length === 1) {
    activeWorkspace = workspaces[0].id;
    console.log(`Workspace: ${workspaces[0].name}`);
  } else {
    console.log('Select a workspace:');
    workspaces.forEach((ws, i) => {
      console.log(`  ${i + 1}. ${ws.name} (${ws.id.slice(0, 8)})`);
    });
    const choice = await ask('Enter number: ');
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < workspaces.length) {
      activeWorkspace = workspaces[idx].id;
    } else {
      activeWorkspace = workspaces[0].id;
      console.log(`Invalid choice, using ${workspaces[0].name}.`);
    }
  }

  // 9. Save session
  const session: Session = {
    server,
    user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: decodeJwtExpiry(tokens.accessToken),
    activeWorkspace,
    workspaces,
  };

  deps.saveSession(session);
  console.log(`Logged in as ${user.username}.`);
}

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Per-attempt secret bound into the OAuth round trip. */
export function createLoginNonce(): string {
  return randomBytes(32).toString('hex');
}

/**
 * PKCE S256 pair for one login attempt.
 *
 * The `code` the backend hands back travels through the browser and lands
 * on `http://127.0.0.1:<port>/callback` as a plaintext query string, and
 * `POST /auth/cli/exchange` trades a code for full access and refresh
 * JWTs. Binding it to a verifier means observing that hop is not enough:
 * the redemption also needs a value that never left this process. Only
 * `challenge` (its SHA-256) goes into the login URL.
 */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

/**
 * Constant-time comparison of a callback's `state` against the nonce
 * this login attempt generated.
 */
export function nonceMatches(
  expected: string,
  received: string | null,
): boolean {
  if (!received) return false;
  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(received, 'utf-8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Default wait for the browser to come back. Three minutes, not thirty
 * seconds: the browser leg is now a confirmation page the user has to
 * click through plus, on a cold browser, a full GitHub sign-in. It stays
 * under the backend's five-minute OAuth state TTL, so the wait never
 * outlives the state it is waiting on.
 */
const CALLBACK_TIMEOUT_MS = 180_000;

/**
 * Why a callback that reached the loopback server was not accepted.
 *
 * Refusing silently is what made the nonce a hard backend contract with
 * no diagnosis: against a server too old to echo `state`, every genuine
 * redirect is refused and the login hangs for the full timeout with
 * nothing to act on. The reason is reported as it happens and repeated
 * in the timeout error, so the failure names its cause.
 *
 * What the reasons deliberately never do is *prescribe the downgrade*.
 * The listener is reachable by any local process and by any page that
 * guesses the port — the exact adversary the state binding exists to
 * stop — so a nonce-less hit is attacker-settable. Telling the operator
 * to re-run with `--allow-unbound-callback` because of one would
 * complete a login fixation: the replayed callback carries the
 * attacker's code, and the victim's session ends up as the attacker's
 * account. The escape hatch stays discoverable only where an attacker
 * has no say — `wafflebase login --help` and the README.
 */
const REFUSAL = {
  noState:
    'the redirect carried no `state`. This CLI sends a per-attempt ' +
    '`nonce` and requires the server to echo it back, so the server is ' +
    'likely older than this CLI — update the server, or use a CLI ' +
    'matching it.',
  badState:
    'a callback carried a `state` that does not match this login ' +
    'attempt, so it did not come from the browser window this command ' +
    'opened and was ignored.',
  notGet:
    'a non-GET request reached the callback. The server redirects the ' +
    'browser with a plain GET navigation, so this was not it.',
  notLoopback:
    'a request addressed to a host other than this loopback listener ' +
    'reached the callback. Our redirect is addressed to ' +
    '`127.0.0.1:<port>`, so this was a name that merely resolves here ' +
    '(DNS rebinding).',
} as const;

/**
 * Hostnames a loopback listener can legitimately be addressed by.
 *
 * IPv6 appears bracketed only: `Host` requires the brackets for an IPv6
 * literal (RFC 7230 §5.4), and `isLoopbackHost`'s pattern splits the port off
 * a colon, so a bare `::1` never reaches this set to be matched.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Whether a request's `Host` header addresses this loopback listener.
 *
 * A hostname under an attacker's control that resolves to `127.0.0.1` (DNS
 * rebinding) lets a remote page's requests reach this listener while the
 * browser treats them as same-origin. Such a request carries the attacker's
 * host, so requiring a loopback literal keeps the listener answering only
 * callers that addressed it directly. That is defence in depth behind the
 * nonce, not a replacement for it: a rebound page still has to guess the
 * per-attempt nonce, and this simply stops it from reaching the code that
 * checks. A missing `Host` (HTTP/1.0) is allowed: a browser always sends one.
 */
export function isLoopbackHost(
  host: string | undefined,
  port: number,
): boolean {
  if (host === undefined) return true;
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(
    host.trim().toLowerCase(),
  );
  if (!match || !LOOPBACK_HOSTS.has(match[1])) return false;
  return match[2] === undefined || Number(match[2]) === port;
}

/** The wait's failure message, naming the last refusal when there was one. */
export function loginTimeoutMessage(refusal?: string): string {
  const base = 'Login timed out. Try again with `wafflebase login`.';
  return refusal ? `${base}\nThe last callback was refused: ${refusal}` : base;
}

export interface CallbackServerOptions {
  /**
   * Accept a callback that carries **no** `state` at all — the shape an
   * older backend redirects with. Off by default; `wafflebase login
   * --allow-unbound-callback` turns it on for someone who knowingly
   * points a current CLI at a server that predates the echo. A
   * *mismatched* `state` is refused either way, since only an attacker
   * sends one.
   */
  allowUnbound?: boolean;
  /** How long to wait for the callback. A seam for tests. */
  timeoutMs?: number;
}

/**
 * Serve the loopback OAuth callback.
 *
 * The `code` is only accepted when the request carries back the
 * per-attempt `nonce` as `state`. Without that binding any web page the
 * victim visits during the wait window can hit
 * `http://127.0.0.1:<port>/callback?code=<attacker code>` — the port is
 * a small scannable space — and the CLI would exchange the attacker's
 * code, saving a session for the attacker's account (login CSRF /
 * session fixation). A method other than GET is rejected outright: our
 * redirect is a top-level GET navigation and never looks like that.
 *
 * The nonce is what makes a callback trustworthy; `isLoopbackHost` only
 * keeps a DNS-rebound name from reaching the check at all. Nothing else
 * is required of the request: an earlier revision also
 * refused any request carrying an `Origin` header, which a browser,
 * extension, or proxy can legitimately attach to a cross-origin redirect
 * chain (`Origin: null` among them). That would refuse the *genuine*
 * redirect, and because a refusal never settles the wait, the login
 * would then hang for the whole timeout. A header no attacker is
 * obliged to send buys nothing the nonce does not already cover.
 *
 * A refusal never settles the wait — the genuine redirect may still be
 * on its way — but it is recorded and surfaced, so a refused login is
 * diagnosable rather than a silent three-minute hang.
 *
 * Exported so the binding can be driven directly in tests: it is the
 * security core of the login flow, not an implementation detail of
 * `runLogin`.
 */
export function startCallbackServer(
  nonce: string,
  options: CallbackServerOptions = {},
): Promise<{
  port: number;
  waitForCallback: () => Promise<string>;
  close: () => void;
}> {
  const allowUnbound = options.allowUnbound === true;
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastRefusal: string | undefined;
    // Known once the listener is bound; the `Host` check below compares
    // against it, and a request cannot arrive before then.
    let boundPort = 0;

    const refuse = (
      res: import('node:http').ServerResponse,
      status: number,
      reason: string,
    ) => {
      lastRefusal = reason;
      console.error(`Refused a login callback: ${reason}`);
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Wafflebase CLI refused this callback: ${reason}\n`);
    };
    let callbackResolve: (code: string) => void;
    let callbackReject: (err: Error) => void;

    const callbackPromise = new Promise<string>((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });

    const srv = createServer((req, res) => {
      if (!isLoopbackHost(req.headers.host, boundPort)) {
        refuse(res, 403, REFUSAL.notLoopback);
        return;
      }

      const url = new URL(req.url ?? '/', `http://127.0.0.1`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      if (req.method !== 'GET') {
        refuse(res, 403, REFUSAL.notGet);
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }

      const state = url.searchParams.get('state');
      if (state === null && allowUnbound) {
        // The one case the downgrade flag can wave through: a server
        // that predates the echo redirects with no `state` at all. A
        // hostile local page sends the same shape, which is exactly why
        // this needs the operator's explicit opt-in.
        console.error(
          'Accepting a callback with no login state (--allow-unbound-callback).',
        );
      } else if (!nonceMatches(nonce, state)) {
        // Never settle the promise here: a forged hit must not end the
        // wait, so the real redirect can still arrive. `state` missing
        // entirely and `state` wrong are different failures — the first
        // is an out-of-date server, the second a callback that is not
        // ours — so they are reported apart.
        refuse(res, 403, state === null ? REFUSAL.noState : REFUSAL.badState);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wafflebase CLI</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    margin: 0;
    background: #fafafa;
    color: #1a1a1a;
  }
  .card {
    text-align: center;
    padding: 3rem 2.5rem;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);
  }
  .icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
  h2 { margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 600; }
  p { margin: 0; color: #666; font-size: 0.95rem; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h2>Login successful!</h2>
    <p>You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`);

      if (!settled) {
        settled = true;
        callbackResolve(code);
      }
    });

    // Armed only once the server is actually listening, and only there:
    // the timer bounds the wait for a callback, and there is nothing to
    // wait for until a browser can reach us. Arming it during setup
    // instead leaks it out of every path that rejects before the caller
    // is handed the `close()` that clears it — the timer then holds the
    // process open for the whole wait and finally rejects
    // `callbackPromise`, which on those paths nobody is awaiting, so the
    // command dies on an unhandled rejection minutes after it already
    // reported the real error.
    let timeout: ReturnType<typeof setTimeout> | undefined;

    // Try to listen on a random port (up to 3 attempts)
    let attempts = 0;
    const tryListen = () => {
      attempts++;
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (!addr || typeof addr === 'string') {
          srv.close();
          reject(new Error('Failed to start callback server'));
          return;
        }
        boundPort = addr.port;
        timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            // A timeout is the caller's to retry, not a fault of the
            // environment, so it exits `1` like any other user error.
            callbackReject(
              new LoginError(EXIT_USER_ERROR, loginTimeoutMessage(lastRefusal)),
            );
          }
          srv.close();
        }, options.timeoutMs ?? CALLBACK_TIMEOUT_MS);
        resolve({
          port: addr.port,
          waitForCallback: () => callbackPromise,
          close: () => {
            clearTimeout(timeout);
            srv.close();
          },
        });
      });
    };

    srv.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attempts < 3) {
        tryListen();
      } else {
        reject(err);
      }
    });

    tryListen();
  });
}
