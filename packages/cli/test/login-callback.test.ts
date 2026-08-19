import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UNBOUND_CALLBACK_MESSAGE,
  authorizeInBrowser,
  buildAuthorizeUrl,
  isLoopbackHost,
  registerLoginCommand,
  startCallbackServer,
  stateMatches,
} from '../src/commands/login.js';

const NONCE = randomBytes(32).toString('base64url');

async function hit(
  port: number,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string; location: string | null }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'manual',
    ...init,
  });
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get('location'),
  };
}

/**
 * A request built by hand, so the `Host` header and the method are ours to
 * set — `fetch` treats `Host` as forbidden and rewrites it.
 */
function rawHit(
  port: number,
  path: string,
  init: { method?: string; host?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: init.method ?? 'GET',
        headers: init.host === undefined ? {} : { Host: init.host },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Poll `read` until it yields a value, or fail after `ms`. */
async function waitFor<T>(read: () => T | undefined, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for a value');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Resolve to `null` if `promise` has not settled within `ms`. */
function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.then(
      (value) => value,
      (err: Error) => err,
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]) as Promise<T | null>;
}

describe('stateMatches', () => {
  it('accepts only the exact nonce', () => {
    expect(stateMatches(NONCE, NONCE)).toBe(true);
    expect(stateMatches(NONCE, `${NONCE}x`)).toBe(false);
    expect(stateMatches(NONCE, NONCE.slice(0, -1))).toBe(false);
    expect(stateMatches(NONCE, `${NONCE.slice(0, -1)}#`)).toBe(false);
    expect(stateMatches(NONCE, '')).toBe(false);
    expect(stateMatches(NONCE, null)).toBe(false);
  });
});

describe('startCallbackServer', () => {
  it('accepts the callback carrying this invocation nonce', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      const res = await hit(
        srv.port,
        `/callback?code=real-code&state=${encodeURIComponent(NONCE)}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toContain('Login successful');
      await expect(srv.waitForCallback()).resolves.toBe('real-code');
    } finally {
      srv.close();
    }
  });

  it('rejects a wrong nonce without settling, so the real callback still wins', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      const injected = await hit(
        srv.port,
        `/callback?code=injected&state=${randomBytes(32).toString('base64url')}`,
      );
      expect(injected.status).toBe(400);
      expect(injected.body).toBe('State mismatch');

      // The login is still waiting — the injected code neither resolved it nor
      // killed it.
      expect(await settledWithin(srv.waitForCallback(), 50)).toBeNull();

      const real = await hit(
        srv.port,
        `/callback?code=real-code&state=${encodeURIComponent(NONCE)}`,
      );
      expect(real.status).toBe(200);
      await expect(srv.waitForCallback()).resolves.toBe('real-code');
    } finally {
      srv.close();
    }
  });

  it('refuses a callback with no nonce without ending the login', async () => {
    const warnings: Array<string> = [];
    const srv = await startCallbackServer(NONCE, {
      warn: (message) => warnings.push(message),
    });
    try {
      const res = await hit(srv.port, '/callback?code=unbound');
      expect(res.status).toBe(400);
      expect(res.body).toBe(UNBOUND_CALLBACK_MESSAGE);
      // Anyone on the machine can send that request, so it must not be a
      // lever for aborting the login — it is reported and then ignored — and
      // neither the report nor the message it serves may point the user at
      // the flag that turns the binding off.
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toMatch(/--allow-unbound-callback/);
      expect(UNBOUND_CALLBACK_MESSAGE).not.toMatch(/--allow-unbound-callback/);
      expect(await settledWithin(srv.waitForCallback(), 50)).toBeNull();

      // Repeats do not re-warn, and the real callback still wins.
      await hit(srv.port, '/callback?code=unbound-again');
      expect(warnings).toHaveLength(1);
      const real = await hit(
        srv.port,
        `/callback?code=real-code&state=${encodeURIComponent(NONCE)}`,
      );
      expect(real.status).toBe(200);
      await expect(srv.waitForCallback()).resolves.toBe('real-code');
    } finally {
      srv.close();
    }
  });

  it('does not crash when the login fails before anyone awaits it', async () => {
    // `login` only reaches `waitForCallback()` after `await import('open')`
    // and `open()`; a rejection raised in that window must not surface as an
    // unhandled rejection (vitest fails the run on one), which is what the
    // handler attached at construction time buys.
    const srv = await startCallbackServer(NONCE, {
      warn: () => {},
      timeoutMs: 10,
    });
    try {
      // Let the timeout reject the promise with nothing attached to it.
      await new Promise((resolve) => setTimeout(resolve, 80));
      await expect(srv.waitForCallback()).rejects.toThrow(/Login timed out/);
    } finally {
      srv.close();
    }
  });

  it('reports version skew when only nonce-less callbacks ever arrived', async () => {
    const srv = await startCallbackServer(NONCE, {
      warn: () => {},
      timeoutMs: 60,
    });
    try {
      const res = await hit(srv.port, '/callback?code=unbound');
      expect(res.status).toBe(400);
      // The login is not ended by that request; it ends at the timeout, and
      // the message says *why* nothing usable arrived.
      await expect(srv.waitForCallback()).rejects.toThrow(
        UNBOUND_CALLBACK_MESSAGE,
      );
    } finally {
      srv.close();
    }
  });

  it('reports the plain timeout when nothing arrived at all', async () => {
    const srv = await startCallbackServer(NONCE, { timeoutMs: 20 });
    try {
      await expect(srv.waitForCallback()).rejects.toThrow(
        'Login timed out. Try again with `wafflebase login`.',
      );
    } finally {
      srv.close();
    }
  });

  it('answers only loopback hosts and only GET', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      // A hostname that resolves to 127.0.0.1 (DNS rebinding) reaches the
      // listener with the attacker's host in the header.
      const rebound = await rawHit(srv.port, '/callback?code=rebound', {
        host: 'attacker.example.com',
      });
      expect(rebound.status).toBe(400);
      expect(rebound.body).toBe('Bad host');

      const posted = await rawHit(
        srv.port,
        `/callback?code=posted&state=${encodeURIComponent(NONCE)}`,
        { method: 'POST' },
      );
      expect(posted.status).toBe(405);

      expect(await settledWithin(srv.waitForCallback(), 50)).toBeNull();
    } finally {
      srv.close();
    }
  });

  it('accepts a nonce-less callback under --allow-unbound-callback', async () => {
    const srv = await startCallbackServer(NONCE, { allowUnbound: true });
    try {
      const res = await hit(srv.port, '/callback?code=legacy-code');
      expect(res.status).toBe(200);
      await expect(srv.waitForCallback()).resolves.toBe('legacy-code');
    } finally {
      srv.close();
    }
  });

  it('still refuses a wrong nonce under --allow-unbound-callback', async () => {
    const srv = await startCallbackServer(NONCE, { allowUnbound: true });
    try {
      const res = await hit(srv.port, '/callback?code=injected&state=wrong');
      expect(res.status).toBe(400);
      expect(res.body).toBe('State mismatch');
      expect(await settledWithin(srv.waitForCallback(), 50)).toBeNull();
    } finally {
      srv.close();
    }
  });

  it('answers a missing code and any other path without settling', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      const missingCode = await hit(srv.port, `/callback?state=${NONCE}`);
      expect(missingCode.status).toBe(400);
      expect(missingCode.body).toBe('Missing code');
      const other = await hit(srv.port, '/');
      expect(other.status).toBe(404);
      expect(other.body).toBe('Not found');
      expect(await settledWithin(srv.waitForCallback(), 50)).toBeNull();
    } finally {
      srv.close();
    }
  });
});

describe('the browser hand-off', () => {
  it('carries the nonce on the authorize URL, encoded', () => {
    const url = buildAuthorizeUrl('https://api.example.com', 4321, 'a b/c+d');
    expect(url).toBe(
      'https://api.example.com/auth/github?mode=cli&port=4321&cliState=a%20b%2Fc%2Bd',
    );
    expect(new URL(url).searchParams.get('cliState')).toBe('a b/c+d');
  });

  it('rejects a host that is not this loopback listener', () => {
    expect(isLoopbackHost('127.0.0.1:4321', 4321)).toBe(true);
    expect(isLoopbackHost('localhost:4321', 4321)).toBe(true);
    expect(isLoopbackHost('[::1]:4321', 4321)).toBe(true);
    expect(isLoopbackHost('127.0.0.1', 4321)).toBe(true);
    expect(isLoopbackHost(undefined, 4321)).toBe(true);
    expect(isLoopbackHost('rebind.example.com:4321', 4321)).toBe(false);
    expect(isLoopbackHost('127.0.0.1.nip.io:4321', 4321)).toBe(false);
    expect(isLoopbackHost('127.0.0.1:4322', 4321)).toBe(false);
  });

  it('gives the browser and stderr the URL the listener will honour', async () => {
    // This is the hand-off `login` performs: whatever `open()` is given must
    // be the URL the printed one equals (the headless copy-paste path) and
    // must carry the nonce the listener then demands back.
    const opened: Array<string> = [];
    const logged: Array<string> = [];
    const code = authorizeInBrowser('https://api.example.com/', {
      openUrl: async (url) => {
        opened.push(url);
      },
      log: (message) => logged.push(message),
    });

    // Play the browser: follow the URL `open()` got, and call back with the
    // nonce it carries.
    const url = await waitFor(() => opened[0]);
    expect(logged[0]).toBe(`Opening browser: ${url}`);
    const params = new URL(url).searchParams;
    const port = Number(params.get('port'));
    const nonce = params.get('cliState') ?? '';
    expect(url).toBe(
      buildAuthorizeUrl('https://api.example.com/', port, nonce),
    );
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const res = await hit(
      port,
      `/callback?code=real-code&state=${encodeURIComponent(nonce)}`,
    );
    expect(res.status).toBe(200);
    await expect(code).resolves.toBe('real-code');

    // A different invocation would have minted a different nonce: the one
    // handed to the browser is per-login, not a constant.
    expect(nonce).not.toBe(NONCE);
  });

  it('passes --allow-unbound-callback through to the listener', async () => {
    const opened: Array<string> = [];
    const code = authorizeInBrowser('https://api.example.com', {
      allowUnbound: true,
      openUrl: async (url) => {
        opened.push(url);
      },
      log: () => {},
    });

    const url = await waitFor(() => opened[0]);
    const port = Number(new URL(url).searchParams.get('port'));
    expect((await hit(port, '/callback?code=legacy-code')).status).toBe(200);
    await expect(code).resolves.toBe('legacy-code');
  });
});

describe('registerLoginCommand', () => {
  const KEYS = [
    'WAFFLEBASE_SERVER',
    'WAFFLEBASE_SESSION',
    'WAFFLEBASE_CONFIG',
  ] as const;
  const saved = KEYS.map((key) => [key, process.env[key]] as const);

  beforeEach(() => {
    // Point the session and config files at paths that do not exist, so the
    // developer's own login neither prompts nor decides the resolved server.
    process.env.WAFFLEBASE_SESSION = join(tmpdir(), 'wafflebase-absent.json');
    process.env.WAFFLEBASE_CONFIG = join(tmpdir(), 'wafflebase-absent.yaml');
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** Register `login` on a root that carries the global options it reads. */
  function program(
    authorize: (
      server: string,
      options: { allowUnbound?: boolean },
    ) => Promise<string>,
  ): Command {
    const root = new Command();
    root
      .name('wafflebase')
      .option('--server <url>', 'Server URL')
      .option('--api-key <key>', 'API key')
      .option('--workspace <id>', 'Workspace ID')
      .option('--profile <name>', 'Config profile', 'default');
    registerLoginCommand(root, { authorize });
    return root;
  }

  /** Run `login` and capture the arguments the browser flow was called with. */
  async function runLogin(argv: Array<string>) {
    const calls: Array<{ server: string; options: { allowUnbound?: boolean } }> =
      [];
    const root = program((server, options) => {
      calls.push({ server, options });
      // Stop before the network legs; the hand-off is what is under test.
      return Promise.reject(new Error('stop'));
    });
    await expect(
      root.parseAsync(['login', ...argv], { from: 'user' }),
    ).rejects.toThrow('stop');
    return calls;
  }

  it('registers `login` with the unbound-callback opt-out', () => {
    const root = new Command();
    registerLoginCommand(root);

    const login = root.commands.find((c) => c.name() === 'login');
    expect(login).toBeDefined();
    expect(login?.options.map((o) => o.long)).toContain(
      '--allow-unbound-callback',
    );
  });

  it('logs in against the server flags and env resolve to', async () => {
    process.env.WAFFLEBASE_SERVER = 'https://env.example.com';

    // `--server` wins over the environment, and the trailing slash is dropped
    // so the endpoints below are not built with a double slash.
    expect(
      await runLogin(['--server', 'https://flag.example.com/']),
    ).toEqual([
      { server: 'https://flag.example.com', options: { allowUnbound: false } },
    ]);

    // Without the flag, `WAFFLEBASE_SERVER` still applies — `login` used to
    // ignore it and go to the public default.
    expect((await runLogin([]))[0].server).toBe('https://env.example.com');
  });

  it('wires --allow-unbound-callback into the browser flow', async () => {
    process.env.WAFFLEBASE_SERVER = 'https://env.example.com';
    expect((await runLogin(['--allow-unbound-callback']))[0].options).toEqual({
      allowUnbound: true,
    });
  });
});
