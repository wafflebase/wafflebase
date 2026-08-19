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
import { getConfig, getGlobalOpts } from './root.js';

/** Injection points for tests; production uses the defaults. */
export interface LoginDeps {
  /** Steps 2–4: mint the nonce, listen, hand the browser the authorize URL. */
  authorize?: typeof authorizeInBrowser;
}

export function registerLoginCommand(
  program: Command,
  deps: LoginDeps = {},
): void {
  const authorize = deps.authorize ?? authorizeInBrowser;

  program
    .command('login')
    .description('Log in via GitHub OAuth in the browser')
    .option(
      '--allow-unbound-callback',
      'Accept a loopback callback that carries no nonce (servers older than ' +
        'the `cliState` echo; the callback is then unbound to this invocation)',
    )
    .action(async function (this: Command) {
      const localOpts = this.opts<{ allowUnboundCallback?: boolean }>();
      // Resolve the server the way every other command does — flag > env >
      // session > profile > default — so `WAFFLEBASE_SERVER` and a configured
      // profile point `login` at the same backend they point the rest of the
      // CLI at. Reading `--server` alone would log the user in to the public
      // default while their next command talked to a self-hosted server.
      const server = getConfig(getGlobalOpts(this)).server.replace(/\/$/, '');

      // 1. Check existing session
      const existing = loadSession();
      if (existing) {
        const answer = await ask(
          `Logged in as ${existing.user.username}. Continue? [Y/n] `,
        );
        if (answer.toLowerCase() === 'n') {
          console.log('Cancelled.');
          return;
        }
      }

      // 2-4. Start the loopback listener, send the browser to GitHub, and
      // wait for the callback it produces.
      const code = await authorize(server, {
        allowUnbound: localOpts.allowUnboundCallback === true,
      });

      // 5. Exchange code for tokens
      const exchangeRes = await fetch(`${server}/auth/cli/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!exchangeRes.ok) {
        console.error(
          'Token exchange failed. Try again with `wafflebase login`.',
        );
        process.exit(1);
      }

      const tokens = (await exchangeRes.json()) as {
        accessToken: string;
        refreshToken: string;
      };

      // 6. Get user info
      const meRes = await fetch(`${server}/auth/me`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!meRes.ok) {
        console.error('Failed to fetch user info.');
        process.exit(1);
      }

      const user = (await meRes.json()) as {
        id: number;
        username: string;
        email: string;
        photo: string | null;
      };

      // 7. Get workspace list
      const wsRes = await fetch(`${server}/workspaces`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!wsRes.ok) {
        console.error(
          `Failed to fetch workspaces (HTTP ${wsRes.status}). Try again with \`wafflebase login\`.`,
        );
        process.exit(1);
      }

      const workspaces = (await wsRes.json()) as WorkspaceInfo[];

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

      saveSession(session);
      console.log(`Logged in as ${user.username}.`);
    });
}

export interface BrowserFlowOptions {
  /** Accept a callback that carries no nonce (`--allow-unbound-callback`). */
  allowUnbound?: boolean;
  /** Test seam — defaults to the `open` package. */
  openUrl?: (url: string) => Promise<unknown>;
  /** Test seam — defaults to stderr. */
  log?: (message: string) => void;
}

/**
 * Mint the nonce that binds this invocation's loopback callback, start the
 * listener, send the browser to the authorize URL, and resolve with the
 * authorization code the callback carries.
 *
 * The loopback callback is reachable by anything running on the machine and by
 * any page the browser visits, so without a binding the first
 * `GET /callback?code=…` to arrive wins — letting someone else's authorization
 * code be exchanged and saved as this user's session. The nonce travels to the
 * backend and comes back on the redirect, so only the browser leg this process
 * started is accepted.
 *
 * The authorize URL carries that nonce, and it is the URL that is both printed
 * and handed to `open()` — so the nonce is visible in this process's argv
 * (`/proc/<pid>/cmdline` exposes it to other local users on Linux) and in
 * stderr scrollback. That is the deliberate trade: the printed URL has to be
 * the one that actually works, which is the headless copy-paste path
 * `docs/design/cli.md` documents, and the alternative tried here before — a
 * loopback `GET /start` that 302s to the authorize URL — served the same nonce
 * over unauthenticated HTTP to *every* process on the machine (and to any page
 * the browser could be made to fetch it), which is a wider disclosure than
 * argv, not a narrower one, and broke the login outright when anything else
 * followed the one-shot link first. The nonce is a binding, not a credential:
 * learning it only restores the pre-nonce situation. Removing the exposure
 * needs the secret to never leave the CLI — a PKCE-shaped
 * `POST /auth/cli/start` that registers `sha256(verifier)` with the flow and
 * an exchange that must present the verifier, a backend endpoint this change
 * does not add. See `docs/design/rest-api.md` "CLI Auth Endpoints".
 */
export async function authorizeInBrowser(
  server: string,
  options: BrowserFlowOptions = {},
): Promise<string> {
  const log = options.log ?? ((message: string) => console.error(message));
  const state = randomBytes(32).toString('base64url');
  const { waitForCallback, close, port } = await startCallbackServer(state, {
    allowUnbound: options.allowUnbound,
    warn: log,
  });
  const authorizeUrl = buildAuthorizeUrl(server, port, state);

  log(`Opening browser: ${authorizeUrl}`);
  log('If the browser does not open, visit the URL above.');

  try {
    const openUrl = options.openUrl ?? (await import('open')).default;
    await openUrl(authorizeUrl);
  } catch {
    log('Could not open a browser automatically.');
  }

  try {
    return await waitForCallback();
  } finally {
    close();
  }
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

/**
 * Constant-time comparison of two `state` values of possibly different length.
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first — the length of a nonce is not a secret.
 */
export function stateMatches(
  expected: string,
  received: string | null,
): boolean {
  if (received === null) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The authorize URL the browser is sent to. `cliState` is the nonce the backend
 * stores with the flow and echoes back on the loopback redirect — see
 * `authorizeInBrowser` for why it travels in this URL.
 */
export function buildAuthorizeUrl(
  server: string,
  port: number,
  state: string,
): string {
  return (
    `${server}/auth/github?mode=cli&port=${port}` +
    `&cliState=${encodeURIComponent(state)}`
  );
}

/**
 * The message a login that only ever saw a nonce-less callback fails with. A
 * backend that predates the `cliState` echo redirects without one, so this is
 * the version-skew signal — the CLI is published separately from the server it
 * is pointed at (`--server` / `WAFFLEBASE_SERVER`, self-hosting), so the two
 * can disagree.
 *
 * It names no opt-out flag on purpose. The branch that selects it is reachable
 * by any local process and by any page the browser visits, so a message that
 * told the user to re-run with `--allow-unbound-callback` would be an
 * attacker-drivable prompt to turn the callback binding off. The flag stays
 * discoverable in `wafflebase login --help`, where nobody else can put it in
 * front of the user.
 */
export const UNBOUND_CALLBACK_MESSAGE =
  "The server completed the login but did not echo this invocation's nonce, " +
  'so the callback cannot be tied to this `wafflebase login`. Upgrade the ' +
  'server to one that echoes `cliState`.';

/** Hostnames a loopback listener can legitimately be addressed by. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Whether a request's `Host` header addresses this loopback listener.
 *
 * A hostname under an attacker's control that resolves to `127.0.0.1` (DNS
 * rebinding) lets a remote page's requests reach this listener while the
 * browser treats them as same-origin. Such a request carries the attacker's
 * host, so requiring a loopback literal keeps the listener answering only
 * callers that addressed it directly. A missing `Host` (HTTP/1.0) is allowed:
 * a browser always sends one.
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

export function startCallbackServer(
  expectedState: string,
  options: {
    allowUnbound?: boolean;
    warn?: (message: string) => void;
    /** Test seam — how long to wait for the callback. Defaults to 30s. */
    timeoutMs?: number;
  } = {},
): Promise<{
  port: number;
  waitForCallback: () => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackResolve: (code: string) => void;
    let callbackReject: (err: Error) => void;
    let boundPort = 0;
    let sawUnboundCallback = false;
    const warn = options.warn ?? ((message: string) => console.error(message));

    const callbackPromise = new Promise<string>((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });
    // The listener can reject before the caller reaches `waitForCallback()` —
    // the timeout can fire while the browser is being spawned. Keep a handler
    // attached from the start so that is an actionable error at the `await`,
    // not an unhandled rejection that kills the process.
    callbackPromise.catch(() => {});

    const srv = createServer((req, res) => {
      if (!isLoopbackHost(req.headers.host, boundPort)) {
        res.writeHead(400);
        res.end('Bad host');
        return;
      }

      // The OAuth redirect is a GET navigation; nothing else has business
      // here, and answering only GET keeps a preflight-free cross-site
      // POST/HEAD from reaching the callback logic at all.
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

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

      const received = url.searchParams.get('state');

      // No `state` at all is the one case that is not an injection signal: a
      // server older than the `cliState` echo redirects without one. Refuse it
      // — the code is not tied to this invocation — but do *not* end the login
      // here: this branch is reachable by any local process or visited page,
      // and letting one of those abort the login (and steer the user at the
      // flag that turns the binding off) would hand an attacker a downgrade
      // lever. Say so once, keep waiting for the real callback, and report the
      // version-skew message at the timeout, when nothing else ever arrived.
      if (received === null && !options.allowUnbound) {
        res.writeHead(400);
        res.end(UNBOUND_CALLBACK_MESSAGE);
        if (!sawUnboundCallback) {
          sawUnboundCallback = true;
          warn(
            'Ignored a login callback that carried no nonce: it cannot be tied ' +
              'to this `wafflebase login`. Still waiting for the browser.',
          );
        }
        return;
      }

      // A callback that carries the *wrong* nonce is not the browser leg we
      // started: reject it without settling, so an injected code cannot become
      // this machine's session and the real callback can still arrive.
      if (received !== null && !stateMatches(expectedState, received)) {
        res.writeHead(400);
        res.end('State mismatch');
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

    // If the only callback that ever arrived carried no nonce, report the
    // version-skew message instead of the bare timeout: neither message names
    // a way to weaken the binding, so an attacker who triggers that branch can
    // change the diagnostic and nothing else.
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        callbackReject(
          new Error(
            sawUnboundCallback
              ? UNBOUND_CALLBACK_MESSAGE
              : 'Login timed out. Try again with `wafflebase login`.',
          ),
        );
      }
      srv.close();
    }, options.timeoutMs ?? 30_000);

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
        boundPort = addr.port;
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
