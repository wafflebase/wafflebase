import { Command } from 'commander';
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  loadSession,
  saveSession,
  decodeJwtExpiry,
} from '../config/session.js';
import type { Session, WorkspaceInfo } from '../config/session.js';
import { DEFAULT_SERVER, getConfigPath } from '../config/config.js';
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

/**
 * Hand the authorization URL to the system browser, best effort.
 *
 * Nothing here is evidence a browser appeared. `open()` resolves as soon as
 * the child process is *spawned*, so on a headless box `xdg-open` resolves
 * and then exits non-zero a moment later. So the caller announces the URL
 * regardless: treating "spawned" as "opened" is what left headless users
 * staring at the callback timeout with no way to continue.
 *
 * Both failure shapes are absorbed here, and they are different ones:
 *
 * - **The spawn itself fails** (no opener binary). `child_process.spawn`
 *   schedules that `error` on `process.nextTick`, so nothing a caller
 *   attaches after `await` could catch it — but `open` attaches
 *   `once('error', reject)` in the same synchronous turn as the spawn and
 *   resolves only on `'spawn'`, so the failure arrives as a *rejection* and
 *   the `try` is what handles it (open v11 `index.js`, the `subprocess`
 *   block).
 * - **The child fails after spawning.** `open` removes its own listener once
 *   `'spawn'` fires, leaving an emitter with no `error` handler; an unhandled
 *   `error` event takes the process down. That is what the listener below is
 *   for.
 *
 * Exported for tests: the two absorbers are the whole point of the helper and
 * nothing else observes them.
 */
export async function openBrowser(url: string): Promise<void> {
  try {
    const open = (await import('open')).default;
    const child = await open(url);
    child?.on?.('error', () => {});
  } catch {
    // No opener at all — the announced URL is the way through.
  }
}

/**
 * Tell the user where to continue, and return the file the URL was left in
 * (if any) so the caller can delete it once the login settles.
 *
 * The URL carries both bindings of this login — the nonce and the PKCE
 * challenge — so anyone who reads it can start their own login against the
 * same pair and push the resulting code at this port. When stderr is a
 * terminal, the only reader is the person logging in and printing is safe.
 * When it is not — a pipe, a CI log, an agent harness transcript — printing
 * parks a live login secret in a file somebody else can read, so the URL goes
 * to an owner-only file and only its path is printed. That is the headless
 * case, which is precisely where the browser cannot open.
 */
function announceLoginUrl(url: string): string | undefined {
  if (process.stderr.isTTY) {
    console.error(
      'If no browser opened, visit this URL to continue — it carries ' +
        'one-time login secrets, so do not share or paste it anywhere:',
    );
    console.error(url);
    return undefined;
  }

  try {
    const file = join(dirname(getConfigPath()), 'login-url.txt');
    mkdirSync(dirname(file), { recursive: true });
    // Remove first: `mode` applies only when the file is created, so an
    // existing world-readable file would keep its permissions.
    rmSync(file, { force: true });
    writeFileSync(file, `${url}\n`, { mode: 0o600 });
    console.error(
      `If no browser opened, the login URL was written to ${file} ` +
        '(readable only by you). It carries one-time login secrets: open it ' +
        'yourself, do not share it, and it expires in 5 minutes.',
    );
    return file;
  } catch {
    console.error(
      'Could not open a browser, and stderr is redirected, so the login URL ' +
        '(which carries one-time login secrets) was not printed. Run ' +
        '`wafflebase login` from a terminal, or use `--api-key`.',
    );
    return undefined;
  }
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
  openBrowser,
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
  const { port, waitForCallback, close, armLaunch } =
    await deps.startCallbackServer(nonce, {
      allowUnbound: options.allowUnboundCallback === true,
    });

  // 3. Build OAuth URL and open browser. The backend echoes `nonce`
  // back as the loopback callback's `state`, which is what lets the
  // callback server tell our own redirect from a forged one.
  //
  // `challenge` is the PKCE half: the `code` comes back to us over
  // plaintext loopback HTTP, so it must not be redeemable on its own.
  // Only the hash goes out; the verifier stays in this process and is
  // sent once, in the exchange POST body.
  //
  // The URL carries the nonce *and* the challenge, so while this login is
  // pending it is a credential: anyone who can both read it and reach this
  // machine's callback port can complete the login as themselves and leave
  // this CLI holding *their* session. It is therefore never handed to the
  // browser directly — opening a URL spawns a child process with that URL
  // in its argv, which any local user can read (`ps`,
  // `/proc/<pid>/cmdline`) on exactly the shared host these bindings exist
  // for. `armLaunch` parks it behind a single-use loopback redirect and the
  // opener gets that instead.
  const { verifier, challenge } = createPkcePair();
  const oauthUrl = `${server}/auth/github?mode=cli&port=${port}&nonce=${encodeURIComponent(nonce)}&challenge=${encodeURIComponent(challenge)}`;
  console.error('Opening browser for GitHub login...');
  // The server answers this URL with a confirmation page rather than
  // going straight to GitHub — a sign-in the user did not start must
  // not proceed on a bare navigation. Say so, or the wait looks stuck.
  console.error('Confirm the sign-in in the browser to continue.');

  await deps.openBrowser(armLaunch(oauthUrl));
  // `open()` resolving is not evidence a browser appeared — it only means
  // the child was spawned — so the URL is announced either way, through
  // whichever channel is safe for the stderr it would land on.
  const urlFile = announceLoginUrl(oauthUrl);

  // 4. Wait for callback
  let code: string;
  try {
    code = await waitForCallback();
  } finally {
    close();
    // The URL is spent either way: it is one login's secrets, not a
    // bookmark. Leaving it on disk past the flow is a stale credential.
    if (urlFile) rmSync(urlFile, { force: true });
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

/** Path prefix of the single-use redirect that starts the login. */
const LAUNCH_PREFIX = '/launch/';

/**
 * What a browser sees when the one-time launch link was already spent.
 *
 * It carries no login material — that is the whole point of spending the
 * token — only the one thing the person can act on, so a lost race costs a
 * re-run rather than a bare 404 and a five-minute wait.
 */
const SPENT_LAUNCH_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Wafflebase CLI</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; justify-content: center; align-items: center; min-height: 100vh;
    margin: 0; background: #fafafa; color: #1a1a1a; }
  .card { max-width: 30rem; text-align: center; padding: 2.5rem; background: #fff;
    border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04); }
  h2 { margin: 0 0 0.75rem; font-size: 1.25rem; }
  p { margin: 0 0 1rem; color: #444; font-size: 0.95rem; line-height: 1.5; }
  code { background: #f2f2f2; padding: 0.1rem 0.3rem; border-radius: 4px; }
</style>
</head>
<body>
  <div class="card">
    <h2>This sign-in link was already used</h2>
    <p>The link that starts a command-line sign-in works exactly once, and
    something opened it before this window did.</p>
    <p>Return to your terminal, press <code>Ctrl-C</code>, and run
    <code>wafflebase login</code> again.</p>
  </div>
</body>
</html>`;

/**
 * How long the loopback listener waits for GitHub's redirect.
 *
 * This has to cover everything the person does in the browser, and that is no
 * longer just GitHub's consent screen: the server now stops a CLI start on an
 * interstitial that names the loopback port and waits for a deliberate click,
 * precisely so a link nobody ran cannot walk someone through sign-in. Thirty
 * seconds was already tight for GitHub alone — a password manager, a 2FA
 * prompt, a tab switched away from — and with a human gate in front of it the
 * CLI was giving up on logins the server still considered live. Five minutes
 * is the server's own budget for one (`CLI_STATE_COOKIE_MAX_AGE_MS`, and the
 * `CliAuthStore` state entry), so the two ends now expire together instead of
 * by an order of magnitude apart; it is also what this command's own headless
 * message has been telling people all along.
 *
 * Exported so a test can assert the two ends agree without waiting them out.
 */
export const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

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
} as const;

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
 * The nonce is the whole defense, deliberately: an earlier revision also
 * refused any request carrying an `Origin` header, which a browser,
 * extension, or proxy can legitimately attach to a cross-origin redirect
 * chain (`Origin: null` among them). That would refuse the *genuine*
 * redirect, and because a refusal never settles the wait, the login
 * would then hang for the whole timeout. A header no attacker is
 * obliged to send buys nothing the nonce does not already cover.
 *
 * A refusal never settles the wait — the genuine redirect may still be
 * on its way — but it is recorded and surfaced, so a refused login is
 * diagnosable rather than a silent five-minute hang.
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
  /**
   * Park an authorization URL behind a single-use loopback redirect and
   * return the URL to hand the browser.
   *
   * The authorization URL carries this login's nonce and PKCE challenge, so
   * it must not appear in a child process's argv (see `openBrowser`'s call
   * site). The token is 32 random bytes, so nothing else on the machine can
   * guess the redirect; it is spent on first use, so a local reader who wins
   * the race takes the URL away from the real browser rather than sharing it.
   *
   * A second visit to the spent link is answered with `410` and a page
   * naming the remedy, not a bare `404`: the link is handed to an arbitrary
   * system opener, so losing the race to a prefetch or a link scanner is not
   * far-fetched, and the person left holding the response needs something to
   * do other than wait out the five-minute timeout. It still never re-offers
   * the authorization URL.
   */
  armLaunch: (authorizationUrl: string) => string;
}> {
  const allowUnbound = options.allowUnbound === true;
  return new Promise((resolve, reject) => {
    let settled = false;
    let launchToken: string | undefined;
    let launchTarget: string | undefined;
    let lastRefusal: string | undefined;

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
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);

      if (url.pathname.startsWith(LAUNCH_PREFIX)) {
        const presented = url.pathname.slice(LAUNCH_PREFIX.length);
        const isOurToken = !!launchToken && nonceMatches(launchToken, presented);

        if (isOurToken && launchTarget) {
          const target = launchTarget;
          // Single use: a second visit gets nothing, so a local reader who
          // lifted the loopback URL out of argv cannot also let the real
          // browser through and stay unnoticed.
          launchTarget = undefined;
          res.writeHead(302, {
            Location: target,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          });
          res.end();
          return;
        }

        // Our token, already spent. Something dereferenced the one-time link
        // before the browser reached it — a link scanner, a prefetch, an
        // opener probe, a second window — and the person is now looking at
        // this response with a login that cannot proceed. A bare 404 left
        // them nothing to act on and a five-minute wait to sit through; say
        // what happened and what to do instead. The authorization URL is
        // deliberately *not* re-offered: handing it out on a second visit is
        // exactly what single use exists to prevent.
        if (isOurToken) {
          res.writeHead(410, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          });
          res.end(SPENT_LAUNCH_PAGE);
          return;
        }

        // Not our token at all: say nothing that confirms a login is running.
        res.writeHead(404);
        res.end('Not found');
        return;
      }

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

      // Reject (rather than resolve on) a callback that does not carry this
      // process's nonce: a code from any other flow is not ours to redeem.
      // Never settle the promise here — a forged hit must not end the wait,
      // so the real redirect can still arrive. `state` missing entirely and
      // `state` wrong are different failures — the first is an out-of-date
      // server, the second a callback that is not ours — so they are
      // reported apart.
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
          armLaunch: (authorizationUrl: string) => {
            launchToken = randomBytes(32).toString('base64url');
            launchTarget = authorizationUrl;
            return `http://127.0.0.1:${addr.port}${LAUNCH_PREFIX}${launchToken}`;
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
