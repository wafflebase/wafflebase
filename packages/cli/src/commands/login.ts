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
    .option(
      '--allow-unbound-callback',
      'Accept a loopback callback that carries no nonce (servers older than ' +
        'the `cliState` echo; the callback is then unbound to this invocation)',
    )
    .action(async function (this: Command) {
      const parentOpts = this.optsWithGlobals<{ server?: string }>();
      const localOpts = this.opts<{ allowUnboundCallback?: boolean }>();
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

      // 2. Start local HTTP server, bound to a nonce this invocation minted.
      // The loopback callback is reachable by anything running on the machine
      // and by any page the browser visits, so without a binding the first
      // `GET /callback?code=…` to arrive wins — letting someone else's
      // authorization code be exchanged and saved as this user's session.
      // The nonce travels to the backend and comes back on the redirect, so
      // only the browser leg the CLI itself started is accepted.
      //
      // What this does and does not cover: it closes the vector that has no
      // read access to this process — a page the browser visits (same-origin
      // policy keeps it from reading the URL) and any blind injector. It does
      // *not* make the nonce a secret from a local process that can read this
      // one's command line: the nonce has to reach the browser, and `open()`
      // passes the URL as an argv entry, which `/proc/<pid>/cmdline` exposes on
      // Linux. Closing that needs the secret to never leave the CLI — a
      // PKCE-shaped flow where a `POST /auth/cli/start` registers
      // `sha256(verifier)` and the exchange must present the verifier — which
      // is a backend endpoint this change does not add. See
      // `docs/design/rest-api.md` "CLI Auth Endpoints".
      const state = randomBytes(32).toString('base64url');
      const { port, waitForCallback, close } = await startCallbackServer(
        state,
        {
          allowUnbound: localOpts.allowUnboundCallback === true,
        },
      );

      // 3. Build OAuth URL and open browser. The printed form omits the nonce:
      // stderr outlives the login in scrollback, CI logs and terminal
      // recordings, and nothing needs the nonce to be readable there. The full
      // URL is printed only when the browser could not be opened, where it is
      // the only way to continue.
      const oauthUrl =
        `${server}/auth/github?mode=cli&port=${port}` +
        `&cliState=${encodeURIComponent(state)}`;
      console.error(
        `Opening browser: ${server}/auth/github?mode=cli&port=${port}`,
      );

      try {
        const open = (await import('open')).default;
        await open(oauthUrl);
      } catch {
        console.error(
          'Could not open a browser. Visit this URL to continue — it carries a ' +
            'one-time login nonce, so do not share it:',
        );
        console.error(oauthUrl);
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
 * The message a callback with no `state` at all produces. A backend that
 * predates the `cliState` echo redirects without one, so this is the version-skew
 * signal — the CLI is published separately from the server it is pointed at
 * (`--server` / `WAFFLEBASE_SERVER`, self-hosting), so the two can disagree.
 */
export const UNBOUND_CALLBACK_MESSAGE =
  "The server completed the login but did not echo this invocation's nonce, " +
  'so the callback cannot be tied to this `wafflebase login`. Upgrade the ' +
  'server, or re-run with `wafflebase login --allow-unbound-callback` to ' +
  'accept an unbound callback.';

export function startCallbackServer(
  expectedState: string,
  options: { allowUnbound?: boolean } = {},
): Promise<{
  port: number;
  waitForCallback: () => Promise<string>;
  close: () => void;
}> {
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

      const received = url.searchParams.get('state');

      // No `state` at all is the one case that is not an injection signal: a
      // server older than the `cliState` echo redirects without one. Fail the
      // login fast with an actionable message (a 30-second timeout blamed on
      // the browser would be a lie) unless the caller opted into an unbound
      // callback, which is the only way to log in against such a server.
      if (received === null && !options.allowUnbound) {
        res.writeHead(400);
        res.end(UNBOUND_CALLBACK_MESSAGE);
        if (!settled) {
          settled = true;
          callbackReject(new Error(UNBOUND_CALLBACK_MESSAGE));
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

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        callbackReject(
          new Error('Login timed out. Try again with `wafflebase login`.'),
        );
      }
      srv.close();
    }, 30_000);

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
