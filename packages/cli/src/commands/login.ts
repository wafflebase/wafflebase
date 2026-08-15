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
import { backendErrorEnvelope, commandPath } from '../output/formatter.js';

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Log in via GitHub OAuth in the browser')
    .action(async function (this: Command) {
      const parentOpts = this.optsWithGlobals<{ server?: string }>();
      const server = (parentOpts.server ?? DEFAULT_SERVER).replace(/\/$/, '');
      const name = commandPath(this);

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

      // 2. Start local HTTP server
      //
      // The callback listener is on 127.0.0.1 but the port is guessable, and
      // any page in the user's browser can navigate to it. Without a binding
      // check the CLI would exchange whatever `code` arrived first — an
      // attacker's code included, which silently logs the terminal into the
      // attacker's account (RFC 8252 §8.9). Two bindings close that: the CLI
      // mints a nonce it requires the callback to echo back as `state`, and a
      // PKCE verifier (RFC 7636) that never leaves this process, so even a
      // code lifted off the redirect is not redeemable without it.
      const nonce = randomBytes(32).toString('base64url');
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');
      const { port, waitForCallback, close, armLaunch } =
        await startCallbackServer(nonce);

      // 3. Build OAuth URL and open browser
      const oauthUrl =
        `${server}/auth/github?mode=cli&port=${port}` +
        `&nonce=${encodeURIComponent(nonce)}` +
        `&code_challenge=${encodeURIComponent(codeChallenge)}`;
      console.error('Opening browser for GitHub login...');

      // The browser is handed a loopback URL, never the authorization URL
      // itself: opening a URL spawns a child process with that URL in its
      // argv, and on a shared host any local user can read `/proc/<pid>/
      // cmdline` or `ps`. That would leak this login's nonce *and* PKCE
      // challenge — the two bindings the rest of this flow rests on — to
      // exactly the attacker those bindings exist to stop. The loopback URL
      // gives away nothing: its token is single-use, and spending it is
      // visible, since the genuine browser then lands on a 404.
      await openBrowser(armLaunch(oauthUrl));
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

      // 5. Exchange code for tokens
      const exchangeRes = await fetch(`${server}/auth/cli/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier }),
      });

      if (!exchangeRes.ok) {
        return await failFromBackend(
          exchangeRes,
          name,
          'Token exchange failed. Try again with `wafflebase login`.',
        );
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
        return await failFromBackend(meRes, name, 'Failed to fetch user info.');
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
        return await failFromBackend(
          wsRes,
          name,
          `Failed to fetch workspaces (HTTP ${wsRes.status}).`,
        );
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

/**
 * Hand the authorization URL to the system browser, best effort.
 *
 * Nothing here is evidence a browser appeared. `open()` resolves as soon as
 * the child process is *spawned*, so on a headless box `xdg-open` resolves
 * and then exits non-zero a moment later; and when the opener binary is
 * missing entirely the failure arrives as an asynchronous `error` event on
 * the child, after this `try` has already been left — which, unhandled,
 * takes the process down. So the event is absorbed and the caller announces
 * the URL regardless: treating "spawned" as "opened" is what left headless
 * users staring at a 30-second timeout with no way to continue.
 *
 * Exported for tests: the `error` listener is the whole point of the helper
 * and nothing else observes it.
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

/**
 * The Error Matrix code for a backend status (docs/design/cli.md §10).
 *
 * Coding every failure `UNAUTHORIZED` told an agent to re-run `login` when
 * the backend was simply down: a 500 from `/workspaces` is a system failure,
 * not a rejected credential, and the two are retried differently.
 */
function codeForStatus(status: number): string {
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status >= 500) return 'SYSTEM';
  return 'HTTP_ERROR';
}

/**
 * Report a backend failure as the standard one-line error envelope and exit.
 *
 * `login` used to print prose here. It is the first command an agent runs, so
 * a failure it cannot parse is the worst place to break the convention
 * (docs/design/cli.md §9); the backend's own reason is preserved when the
 * response carries one.
 *
 * Returns `never`, but every call site still `return`s it: TypeScript does not
 * treat an awaited `Promise<never>` as a terminator, so without the `return`
 * the code after it stays reachable and would re-read a consumed body if
 * `process.exit` were ever stubbed or intercepted.
 */
async function failFromBackend(
  res: { status: number; json: () => Promise<unknown> },
  command: string,
  fallbackMessage: string,
): Promise<never> {
  const body = await res.json().catch(() => null);
  const code = codeForStatus(res.status);
  console.error(
    backendErrorEnvelope(body, { code, message: fallbackMessage }, command),
  );
  // Auth and system failures are the Error Matrix's exit-2 rows; every other
  // status is an ordinary command failure.
  return process.exit(code === 'HTTP_ERROR' ? 1 : 2);
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

/** Constant-time compare of two `state` values (never leak by timing). */
function nonceMatches(expected: string, received: string | null): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Path prefix of the single-use redirect that starts the login. */
const LAUNCH_PREFIX = '/launch/';

/** Exported for tests — the nonce gate is the only thing guarding this port. */
export function startCallbackServer(expectedNonce: string): Promise<{
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
   */
  armLaunch: (authorizationUrl: string) => string;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let launchToken: string | undefined;
    let launchTarget: string | undefined;
    // A code that arrived carrying no `state` at all is also what a backend
    // predating the echo looks like, so remember it and say so on timeout
    // rather than leaving the user with a bare "timed out".
    let sawUnboundCode = false;
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
        if (
          !launchToken ||
          !launchTarget ||
          !nonceMatches(launchToken, presented)
        ) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
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

      // Reject (rather than resolve on) a callback that does not carry this
      // process's nonce: a code from any other flow is not ours to redeem.
      // The listener stays open so the genuine callback can still arrive.
      const state = url.searchParams.get('state');
      if (!nonceMatches(expectedNonce, state)) {
        if (state === null) sawUnboundCode = true;
        res.writeHead(400);
        res.end('Invalid state');
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
          new Error(
            sawUnboundCode
              ? 'Login callback carried no `state`, so it could not be tied ' +
                'to this login and was refused. The server may predate the ' +
                'CLI loopback binding — upgrade it, or authenticate with ' +
                '`--api-key`.'
              : 'Login timed out. Try again with `wafflebase login`.',
          ),
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
