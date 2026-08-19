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

      // 2. Start local HTTP server, bound to this attempt's two secrets.
      //
      // The callback listener is on 127.0.0.1 but the port is guessable, and
      // any page in the user's browser can navigate to it. Without a binding
      // check the CLI would exchange whatever `code` arrived first — an
      // attacker's code included, which silently logs the terminal into the
      // attacker's account (RFC 8252 §8.9). Two bindings close that: the CLI
      // mints a nonce it requires the callback to echo back as `state`, and a
      // PKCE verifier (RFC 7636) that never leaves this process, so even a
      // code lifted off the redirect is not redeemable without it.
      const nonce = createLoginNonce();
      const { verifier, challenge } = createPkcePair();
      const { port, waitForCallback, close, armLaunch } =
        await startCallbackServer(nonce);

      // 3. Build OAuth URL and open browser. The backend echoes `nonce`
      // back as the loopback callback's `state`, which is what lets the
      // callback server tell our own redirect from a forged one; only the
      // `challenge` (the verifier's SHA-256) goes out with it.
      const oauthUrl =
        `${server}/auth/github?mode=cli&port=${port}` +
        `&nonce=${encodeURIComponent(nonce)}` +
        `&challenge=${encodeURIComponent(challenge)}`;
      console.error('Opening browser for GitHub login...');
      // The server answers this URL with a confirmation page rather than
      // going straight to GitHub — a sign-in the user did not start must
      // not proceed on a bare navigation. Say so, or the wait looks stuck.
      console.error('Confirm the sign-in in the browser to continue.');

      // The browser is handed a loopback URL, never the authorization URL
      // itself: opening a URL spawns a child process with that URL in its
      // argv, and on a shared host any local user can read `/proc/<pid>/
      // cmdline` or `ps`. That would leak this login's nonce *and* PKCE
      // challenge — the two bindings the rest of this flow rests on — to
      // exactly the attacker those bindings exist to stop. The loopback URL
      // gives away nothing: its token is single-use, and spending it is
      // visible, since the genuine browser then lands on the "already used"
      // page instead of GitHub, which names the remedy.
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
        body: JSON.stringify({ code, verifier }),
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
 * users staring at the callback timeout with no way to continue.
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
 * diagnosable rather than a silent hang.
 */
export function startCallbackServer(
  nonce: string,
  options: { timeoutMs?: number } = {},
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
      if (!nonceMatches(nonce, state)) {
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
            callbackReject(new Error(loginTimeoutMessage(lastRefusal)));
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
