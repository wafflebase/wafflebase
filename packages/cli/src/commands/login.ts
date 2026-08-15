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

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Log in via GitHub OAuth in the browser')
    .action(async function (this: Command) {
      const parentOpts = this.optsWithGlobals<{ server?: string }>();
      const server = (parentOpts.server ?? DEFAULT_SERVER).replace(/\/$/, '');

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

      // 2. Start local HTTP server, bound to a per-attempt nonce
      const nonce = createLoginNonce();
      const { port, waitForCallback, close } = await startCallbackServer(nonce);

      // 3. Build OAuth URL and open browser. The backend echoes `nonce`
      // back as the loopback callback's `state`, which is what lets the
      // callback server tell our own redirect from a forged one.
      const oauthUrl = `${server}/auth/github?mode=cli&port=${port}&nonce=${nonce}`;
      console.error(`Opening browser: ${oauthUrl}`);
      console.error('If the browser does not open, visit the URL above.');

      try {
        const open = (await import('open')).default;
        await open(oauthUrl);
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

/** Default wait for the browser to come back. */
const CALLBACK_TIMEOUT_MS = 30_000;

/**
 * Why a callback that reached the loopback server was not accepted.
 *
 * Refusing silently is what made the nonce a hard backend contract with
 * no diagnosis: against a server too old to echo `state`, every genuine
 * redirect is refused and the login hangs for the full timeout with
 * nothing to act on. The reason is reported as it happens and repeated
 * in the timeout error, so the failure names its cause.
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
  notNavigation:
    'a callback was refused for not looking like the browser redirect ' +
    '(non-GET, or carrying an `Origin` header). Only the plain GET ' +
    'navigation the server redirects to is accepted.',
} as const;

/** The wait's failure message, naming the last refusal when there was one. */
export function loginTimeoutMessage(refusal?: string): string {
  const base = 'Login timed out. Try again with `wafflebase login`.';
  return refusal ? `${base}\nThe last callback was refused: ${refusal}` : base;
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
 * session fixation). Requests carrying an `Origin` header or using a
 * method other than GET are rejected outright: our redirect is a
 * top-level GET navigation and never looks like that.
 *
 * A refusal never settles the wait — the genuine redirect may still be
 * on its way — but it is recorded and surfaced, so a refused login is
 * diagnosable rather than a silent 30-second hang.
 */
export function startCallbackServer(
  nonce: string,
  options: { timeoutMs?: number } = {},
): Promise<{
  port: number;
  waitForCallback: () => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
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

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      if (req.method !== 'GET' || req.headers.origin !== undefined) {
        refuse(res, 403, REFUSAL.notNavigation);
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }

      const state = url.searchParams.get('state');
      if (!nonceMatches(nonce, state)) {
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

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        callbackReject(new Error(loginTimeoutMessage(lastRefusal)));
      }
      srv.close();
    }, options.timeoutMs ?? CALLBACK_TIMEOUT_MS);

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
