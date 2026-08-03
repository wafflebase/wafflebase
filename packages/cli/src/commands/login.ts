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
  SystemError,
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
  if (error instanceof LoginError || error instanceof SystemError) {
    return exitCodeFor(error);
  }
  return null;
}

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Log in via GitHub OAuth in the browser')
    .action(async function (this: Command) {
      // `login` prints prose rather than the JSON error body, but it
      // honors the same exit contract: a server that was never reached
      // is a system error, bad input from the caller is not. Anything
      // unclassified is a bug and keeps its stack trace, as before.
      try {
        await runLogin(this);
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

async function runLogin(cmd: Command): Promise<void> {
  const parentOpts = cmd.optsWithGlobals<{ server?: string }>();
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

  // 2. Start local HTTP server, bound to a nonce we generate here. The
  // callback listener is reachable by anything running on the machine
  // (and by any web page that guesses the port), so the code alone is
  // not enough: without the nonce a hostile page could hand us its own
  // code and fix our CLI onto the attacker's account. The server echoes
  // the nonce back through the OAuth round trip and we only accept a
  // callback that carries it.
  const nonce = randomBytes(32).toString('base64url');
  const { port, waitForCallback, close } = await startCallbackServer(nonce);

  // 3. Build OAuth URL and open browser
  const oauthUrl = `${server}/auth/github?mode=cli&port=${port}&nonce=${encodeURIComponent(nonce)}`;
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

  // 5-7. Exchange the code for tokens, then read the user and workspaces.
  const { tokens, user, workspaces } = await fetchLoginSession(server, code);

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
function nonceMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function startCallbackServer(expectedNonce: string): Promise<{
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

      // Reject (without settling) anything that does not carry the nonce
      // we handed the server: an unrelated local request or a hostile
      // page must not be able to complete — or cancel — this login.
      const nonce = url.searchParams.get('nonce');
      if (!nonce || !nonceMatches(nonce, expectedNonce)) {
        res.writeHead(403);
        res.end('Invalid login nonce');
        console.error(
          'Ignored a callback with a missing or mismatched nonce. If this repeats, the server may predate nonce-bound CLI login.',
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
