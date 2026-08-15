import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import open from 'open';
import {
  registerLoginCommand,
  startCallbackServer,
} from '../src/commands/login.js';

// `open` would launch a real browser in CI. It is also how the tests read the
// authorization URL: it carries this login's nonce and PKCE challenge, so the
// command hands it to the browser rather than printing it on stderr, which an
// agent harness captures into logs.
vi.mock('open', () => ({ default: vi.fn(async () => undefined) }));

const openMock = vi.mocked(open);

// The login callback listens on loopback, but the port is guessable and any
// page in the user's browser can navigate to it. The nonce echoed back as
// `state` is the only thing that ties a `code` to the flow this process
// started — without it the CLI would redeem an attacker's code and log the
// terminal into their account (RFC 8252 §8.9).
describe('login callback server', () => {
  it('rejects a callback whose state is missing or wrong, and takes the matching one', async () => {
    const { port, waitForCallback, close } =
      await startCallbackServer('the-nonce');
    try {
      const noState = await fetch(
        `http://127.0.0.1:${port}/callback?code=evil-1`,
      );
      expect(noState.status).toBe(400);

      const wrongState = await fetch(
        `http://127.0.0.1:${port}/callback?code=evil-2&state=guessed`,
      );
      expect(wrongState.status).toBe(400);

      // Same length as `the-nonce`, so this one gets past the length check
      // and has to be refused by the value comparison itself. Without it a
      // `nonceMatches` that only compared lengths would pass this suite.
      const sameLength = await fetch(
        `http://127.0.0.1:${port}/callback?code=evil-3&state=xxx-nonce`,
      );
      expect(sameLength.status).toBe(400);

      // The listener survives the rejections, so the genuine callback — which
      // may arrive after an attacker's probe — is still accepted.
      const ok = await fetch(
        `http://127.0.0.1:${port}/callback?code=real&state=the-nonce`,
      );
      expect(ok.status).toBe(200);

      await expect(waitForCallback()).resolves.toBe('real');
    } finally {
      close();
    }
  });
});

/** A JWT whose payload `decodeJwtExpiry` can read. */
function fakeJwt(): string {
  const payload = Buffer.from(JSON.stringify({ exp: 9999999999 })).toString(
    'base64url',
  );
  return `header.${payload}.sig`;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for the OAuth URL');
}

/** The authorization URL the command handed to the browser. */
async function openedUrl(): Promise<URL> {
  const target = await waitFor(
    () => openMock.mock.calls[0]?.[0] as string | undefined,
  );
  return new URL(target);
}

// The gate above is worthless if the CLI never asks the server to echo
// anything: the backend only sends `state` back when the start URL carried
// `nonce`, so a dropped or misnamed parameter would leave every real login
// timing out. This drives the actual command to pin the wire format —
// `nonce`, and the PKCE `code_challenge` whose verifier the exchange must
// carry (RFC 7636).
describe('wafflebase login', () => {
  const sessionPath = join(tmpdir(), `wb-login-test-${process.pid}.json`);

  afterEach(() => {
    vi.restoreAllMocks();
    // `restoreAllMocks` does not touch the module mock, and the next test
    // reads the authorization URL out of its first call.
    openMock.mockClear();
    delete process.env.WAFFLEBASE_SESSION;
    rmSync(sessionPath, { force: true });
  });

  it('sends the nonce it requires back and PKCE-binds the exchange', async () => {
    process.env.WAFFLEBASE_SESSION = sessionPath;

    const program = new Command();
    program.name('wafflebase').exitOverride();
    registerLoginCommand(program);

    const notices: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      notices.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const realFetch = globalThis.fetch;
    const exchanged: Array<Record<string, string>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
        if (url.endsWith('/auth/cli/exchange')) {
          exchanged.push(JSON.parse(String(init?.body)));
          return jsonResponse({ accessToken: fakeJwt(), refreshToken: 'rt' });
        }
        if (url.endsWith('/auth/me')) {
          return jsonResponse({
            id: 1,
            username: 'bob',
            email: 'bob@example.com',
            photo: null,
          });
        }
        if (url.endsWith('/workspaces')) {
          return jsonResponse([{ id: 'w1', name: 'Workspace One' }]);
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    const done = program.parseAsync(['login'], { from: 'user' });

    const oauthUrl = await openedUrl();
    const nonce = oauthUrl.searchParams.get('nonce');
    const challenge = oauthUrl.searchParams.get('code_challenge');
    const port = oauthUrl.searchParams.get('port');
    expect(nonce).toBeTruthy();
    expect(challenge).toBeTruthy();
    expect(oauthUrl.searchParams.get('mode')).toBe('cli');

    // The nonce and the challenge are this login's two bindings; an observer
    // of a printed URL could start their own login against the same pair, so
    // nothing carrying them is written to stderr when the browser opened.
    expect(notices.some((n) => n.includes('nonce='))).toBe(false);

    const callback = await realFetch(
      `http://127.0.0.1:${port}/callback?code=the-code&state=${encodeURIComponent(nonce!)}`,
    );
    expect(callback.status).toBe(200);

    await done;

    expect(exchanged).toHaveLength(1);
    expect(exchanged[0].code).toBe('the-code');
    // The verifier stays in this process until the exchange; its S256 hash is
    // what the server saw, so an intercepted code cannot be redeemed alone.
    expect(
      createHash('sha256')
        .update(exchanged[0].codeVerifier)
        .digest('base64url'),
    ).toBe(challenge);
  });

  // `login` is the first command an agent runs, so a failure it cannot parse
  // is the worst place to print prose (docs/design/cli.md §9). This drives a
  // rejected exchange through `failFromBackend`: one line, attributed to the
  // command, carrying the backend's own reason — and it must stop there
  // rather than fall through into `exchangeRes.json()`.
  it('reports a rejected exchange as the one-line error envelope', async () => {
    process.env.WAFFLEBASE_SESSION = sessionPath;

    const program = new Command();
    program.name('wafflebase').exitOverride();
    registerLoginCommand(program);

    const notices: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      notices.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const realFetch = globalThis.fetch;
    let exchanges = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
        if (url.endsWith('/auth/cli/exchange')) {
          exchanges++;
          // Nest's default shape: the reason is at the top level and
          // `error` is a bare string, not an envelope.
          return new Response(
            JSON.stringify({
              statusCode: 401,
              message: 'Invalid or expired code',
              error: 'Unauthorized',
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    // Observe the rejection now, not after the callback: the action fails
    // the moment the exchange answers, and a rejection nobody is listening
    // to yet is reported as an unhandled one.
    const done = program.parseAsync(['login'], { from: 'user' });
    const settled = done.then(
      () => undefined,
      (err: Error) => err,
    );

    const oauthUrl = await openedUrl();
    const nonce = oauthUrl.searchParams.get('nonce')!;
    const port = oauthUrl.searchParams.get('port');

    await realFetch(
      `http://127.0.0.1:${port}/callback?code=the-code&state=${encodeURIComponent(nonce)}`,
    );

    // A backend 401 is the Error Matrix's exit-2 row (docs/design/cli.md §10).
    expect((await settled)?.message).toBe('exit:2');
    expect(exit).toHaveBeenCalledWith(2);
    // Stopped at the failure: no second call, and nothing was saved.
    expect(exchanges).toBe(1);

    const envelopes = notices.filter((n) => n.startsWith('{'));
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).not.toContain('\n');
    expect(JSON.parse(envelopes[0])).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired code',
        command: 'login',
      },
    });
  });

  // Coding a server fault `UNAUTHORIZED` told the agent to re-run `login`
  // when the credential it just minted was fine — the Error Matrix
  // (docs/design/cli.md §10) puts a 5xx under SYSTEM instead.
  it('codes a backend 5xx as SYSTEM, not as an auth failure', async () => {
    process.env.WAFFLEBASE_SESSION = sessionPath;

    const program = new Command();
    program.name('wafflebase').exitOverride();
    registerLoginCommand(program);

    const notices: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      notices.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
        if (url.endsWith('/auth/cli/exchange')) {
          return jsonResponse({ accessToken: fakeJwt(), refreshToken: 'rt' });
        }
        if (url.endsWith('/auth/me')) {
          return jsonResponse({
            id: 1,
            username: 'bob',
            email: 'bob@example.com',
            photo: null,
          });
        }
        if (url.endsWith('/workspaces')) {
          return new Response('gateway is down', { status: 502 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    const done = program.parseAsync(['login'], { from: 'user' });
    const settled = done.then(
      () => undefined,
      (err: Error) => err,
    );

    const oauthUrl = await openedUrl();
    const nonce = oauthUrl.searchParams.get('nonce')!;
    const port = oauthUrl.searchParams.get('port');

    await realFetch(
      `http://127.0.0.1:${port}/callback?code=the-code&state=${encodeURIComponent(nonce)}`,
    );

    expect((await settled)?.message).toBe('exit:2');
    expect(exit).toHaveBeenCalledWith(2);

    const envelopes = notices.filter((n) => n.startsWith('{'));
    expect(envelopes).toHaveLength(1);
    expect(JSON.parse(envelopes[0])).toEqual({
      error: {
        code: 'SYSTEM',
        message: 'Failed to fetch workspaces (HTTP 502).',
        command: 'login',
      },
    });
  });
});
