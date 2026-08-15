import { Command } from 'commander';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { randomBytes, timingSafeEqual } from 'node:crypto';
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
      'accept a login callback that carries no nonce (server predates nonce-bound CLI login)',
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
 */
export async function fetchLoginSession(
  server: string,
  code: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<LoginSession> {
  const exchangeRes = await fetchOrThrow(
    `${server}/auth/cli/exchange`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
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
 * generated, handed to the listener *and* carried in the OAuth URL, and
 * that `--allow-unbound-callback` actually reaches the listener — can be
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
  // OAuth round trip and only a callback echoing it is accepted.
  const nonce = randomBytes(32).toString('base64url');
  if (options.allowUnboundCallback) {
    console.error(
      'Warning: --allow-unbound-callback accepts a callback that carries no nonce. Any local process that reaches the callback port can complete this login.',
    );
  }
  const { port, waitForCallback, close } = await deps.startCallbackServer(
    nonce,
    { allowUnbound: options.allowUnboundCallback === true },
  );

  // 3. Build OAuth URL and open browser
  const oauthUrl = `${server}/auth/github?mode=cli&port=${port}&nonce=${encodeURIComponent(nonce)}`;
  console.error(`Opening browser: ${oauthUrl}`);
  console.error('If the browser does not open, visit the URL above.');

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

/** Constant-time compare that tolerates differing lengths. */
export function nonceMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface CallbackServerOptions {
  /**
   * Accept a callback that carries **no** nonce at all — the shape an
   * older backend redirects with. Off by default; `wafflebase login
   * --allow-unbound-callback` turns it on for someone who knowingly
   * points a current CLI at a server that predates the echo.
   */
  allowUnbound?: boolean;
  /** How long to wait for the callback. A seam for tests. */
  timeoutMs?: number;
}

/**
 * Listen on `127.0.0.1:<random port>` for the OAuth redirect, accepting
 * only a `/callback` that echoes `expectedNonce`. Exported so the
 * binding can be driven directly in tests — it is the security core of
 * the login flow, not an implementation detail of `runLogin`.
 *
 * A callback carrying a code but no nonce is what an older backend
 * redirects with — and also what a hostile local page would send. The
 * two are indistinguishable here, so it is refused (accepting it would
 * defeat the binding) but not settled, and it changes nothing the CLI
 * later reports: the timeout message is the same either way, because an
 * unauthenticated request must not steer the operator toward the
 * `--allow-unbound-callback` downgrade. With that opt-out explicitly
 * set, a nonce-less callback is accepted so an old server stays usable;
 * a *mismatched* nonce is refused either way, since only an attacker
 * sends one.
 */
export function startCallbackServer(
  expectedNonce: string,
  options: CallbackServerOptions = {},
): Promise<{
  port: number;
  waitForCallback: () => Promise<string>;
  close: () => void;
}> {
  const allowUnbound = options.allowUnbound === true;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackResolve: (code: string) => void;
    let callbackReject: (err: Error) => void;

    const callbackPromise = new Promise<string>((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });

    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }

      // Reject — without settling — anything that does not carry the
      // nonce we handed out: an unrelated local request or a hostile
      // page must be able neither to complete nor to cancel this login.
      // A callback with no nonce *parameter at all* is the shape an
      // older backend redirects with, so it is the one case
      // `--allow-unbound-callback` can wave through.
      const nonce = url.searchParams.get('nonce');
      if (nonce === null && allowUnbound) {
        console.error(
          'Accepting a callback with no login nonce (--allow-unbound-callback).',
        );
      } else if (nonce === null || !nonceMatches(nonce, expectedNonce)) {
        res.writeHead(403);
        res.end('Invalid login nonce');
        console.error(
          'Ignored a callback with a missing or mismatched login nonce.',
        );
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

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        // Deliberately one message for every way this can time out.
        //
        // An earlier version reported "the server predates nonce-bound
        // CLI login — re-run with `--allow-unbound-callback`" whenever a
        // nonce-less callback had arrived. But the listener is reachable
        // by any local process and by any page that guesses the port —
        // the exact adversary the nonce exists to stop — so that signal
        // was attacker-settable: a hostile page could send one
        // nonce-less `/callback?code=<its own code>`, and the CLI would
        // then blame the server and prescribe the one flag that turns
        // the binding off. Accepting that advice completes a login
        // fixation: the replayed callback carries the attacker's code,
        // and the victim's session ends up as the attacker's account.
        //
        // The escape hatch for a genuinely older server stays, but it is
        // discoverable only where an attacker has no say — `wafflebase
        // login --help` and the README — never as advice triggered by an
        // unauthenticated request.
        callbackReject(
          new LoginError(
            EXIT_USER_ERROR,
            'Login timed out. Try again with `wafflebase login`.',
          ),
        );
      }
      srv.close();
    }, timeoutMs);

    // Try to listen on a random port (up to 3 attempts)
    let attempts = 0;
    const tryListen = () => {
      attempts++;
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to start callback server'));
          return;
        }
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
