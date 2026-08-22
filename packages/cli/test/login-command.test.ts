import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgram } from '../src/commands/root.js';
import { registerLoginCommand } from '../src/commands/login.js';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

/**
 * The action leaves the login URL in an owner-only file next to the config
 * when stderr is not a terminal (which it is not under vitest), so the
 * config is pointed at a temporary directory rather than the real one.
 */
const configDir = join(tmpdir(), `wb-login-cmd-${process.pid}`);
const configPath = join(configDir, 'config.yaml');

/**
 * The loopback callback has to be driven with the *real* fetch: the test
 * replaces `globalThis.fetch` to stand in for the backend.
 */
const realFetch = globalThis.fetch.bind(globalThis);

const savedSessions: Array<Record<string, unknown>> = [];
vi.mock('../src/config/session.js', () => ({
  loadSession: () => null,
  saveSession: (s: Record<string, unknown>) => {
    savedSessions.push(s);
  },
  decodeJwtExpiry: () => 0,
}));

/**
 * Stands in for the browser.
 *
 * What `open()` receives is the *loopback launch link*, not the
 * authorization URL: opening a URL spawns a child process with it in argv,
 * which any local user can read, and the authorization URL carries this
 * login's nonce and PKCE challenge. The browser follows one redirect to
 * reach the real URL, so this stand-in does the same.
 */
let onOpen: ((url: string) => Promise<void>) | undefined;
const openedUrls: string[] = [];
vi.mock('open', () => ({
  default: async (url: string) => {
    openedUrls.push(url);
    await onOpen?.(url);
  },
}));

/** Resolve a launch link to the authorization URL behind it. */
async function followLaunch(launch: string): Promise<string> {
  expect(new URL(launch).hostname).toBe('127.0.0.1');
  // The launch link itself must give nothing away — that is why it exists.
  expect(launch).not.toContain('nonce=');
  const res = await realFetch(launch, { redirect: 'manual' });
  expect(res.status).toBe(302);
  return res.headers.get('location')!;
}

const SERVER = 'http://oauth.test';

/** Bodies posted to `/auth/cli/exchange`, so the code can be asserted. */
let exchangeBodies: Array<Record<string, unknown>>;

function stubBackend(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/cli/exchange')) {
        exchangeBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/auth/me')) {
        return new Response(
          JSON.stringify({
            id: 1,
            username: 'octocat',
            email: 'octocat@example.com',
            photo: null,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/workspaces')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

/** Set when the action's callback server reports refusing a callback. */
let onRefusal: ((reason: string) => void) | undefined;

/** Refusals a test expects to provoke itself, before one counts as failure. */
let refusalsToIgnore = 0;

/**
 * Run the real `login` action.
 *
 * Raced against the server's own refusal notice: a login whose nonce
 * does not round-trip refuses the callback and then waits out the full
 * 30-second timeout, which would surface only as an opaque test
 * timeout. Failing on the refusal line names the cause instead.
 */
function runLogin(): Promise<unknown> {
  const program = createProgram();
  registerLoginCommand(program);
  const refused = new Promise<never>((_resolve, reject) => {
    onRefusal = (reason) =>
      reject(new Error(`the login callback was refused: ${reason}`));
  });
  return Promise.race([
    program.parseAsync(['node', 'wafflebase', '--server', SERVER, 'login']),
    refused,
  ]);
}

/**
 * The nonce is only a defense if the value the action puts in the OAuth
 * URL is the same one it bound to the loopback server, under the query
 * key the backend guard reads (`req.query?.nonce`). Every helper test
 * hands `startCallbackServer` a nonce directly, so a login that
 * generated two different nonces — or spelled the query key differently
 * from the backend — would leave them all green while refusing every
 * real callback until the 30s timeout. `github-auth.guard.spec.ts` pins
 * the backend half of the same contract; this pins the CLI half.
 */
describe('login command wiring', () => {
  beforeEach(() => {
    savedSessions.length = 0;
    openedUrls.length = 0;
    exchangeBodies = [];
    onOpen = undefined;
    onRefusal = undefined;
    refusalsToIgnore = 0;
    process.env.WAFFLEBASE_CONFIG = configPath;
    stubBackend();
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const line = args.map(String).join(' ');
      if (!line.startsWith('Refused a login callback:')) return;
      if (refusalsToIgnore > 0) {
        refusalsToIgnore--;
        return;
      }
      onRefusal?.(line);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    onOpen = undefined;
    onRefusal = undefined;
    delete process.env.WAFFLEBASE_CONFIG;
    rmSync(configDir, { recursive: true, force: true });
  });

  it('binds the OAuth URL nonce to the callback server it started', async () => {
    let seen: URL | undefined;

    onOpen = async (raw) => {
      const url = new URL(await followLaunch(raw));
      seen = url;
      const nonce = url.searchParams.get('nonce');
      const port = url.searchParams.get('port');
      const res = await realFetch(
        `http://127.0.0.1:${port}/callback?code=granted-code&state=${nonce}`,
      );
      // Accepted only because the nonce in the URL is the one bound to
      // this server.
      expect(res.status).toBe(200);
    };

    await runLogin();

    expect(openedUrls).toHaveLength(1);
    expect(seen?.origin).toBe(SERVER);
    expect(seen?.pathname).toBe('/auth/github');
    expect(seen?.searchParams.get('mode')).toBe('cli');
    // The exact key `github-auth.guard.ts` reads off the query.
    expect(seen?.searchParams.get('nonce')).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(seen?.searchParams.get('port'))).toBeGreaterThan(0);

    // Reaching the exchange at all proves the callback was accepted.
    expect(exchangeBodies).toHaveLength(1);
    expect(exchangeBodies[0].code).toBe('granted-code');

    // The PKCE half: the code is redeemed with a verifier whose SHA-256
    // is the `challenge` the OAuth URL registered, and the verifier
    // itself never appeared in that URL. Without this the code alone
    // would buy a full session off a plaintext loopback hop.
    const verifier = String(exchangeBodies[0].verifier);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(seen?.searchParams.get('challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    expect(seen?.search).not.toContain(verifier);
    expect(savedSessions).toHaveLength(1);
    expect(savedSessions[0]).toMatchObject({
      server: SERVER,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('refuses a callback that does not carry this attempt’s nonce', async () => {
    // The forged hit below is the one refusal this test provokes; a
    // second would mean the genuine callback was refused too.
    refusalsToIgnore = 1;
    onOpen = async (raw) => {
      const url = new URL(await followLaunch(raw));
      const nonce = url.searchParams.get('nonce')!;
      const port = url.searchParams.get('port');

      // A page the user visits during the wait guesses the port. Without
      // a real binding (a constant or empty nonce) this would be taken.
      const forged = await realFetch(
        `http://127.0.0.1:${port}/callback?code=attacker-code&state=${'0'.repeat(64)}`,
      );
      expect(forged.status).toBe(403);

      const real = await realFetch(
        `http://127.0.0.1:${port}/callback?code=granted-code&state=${nonce}`,
      );
      expect(real.status).toBe(200);
    };

    await runLogin();

    // The attacker's code never reached the exchange.
    expect(exchangeBodies.map((b) => b.code)).toEqual(['granted-code']);
  });
});
