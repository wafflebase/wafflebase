import { describe, it, expect } from 'vitest';
import { request as httpRequest } from 'node:http';
import {
  createLoginNonce,
  isLoopbackHost,
  nonceMatches,
  startCallbackServer,
} from '../src/commands/login.js';

/**
 * A request built by hand, so the `Host` header is ours to set — `fetch`
 * treats `Host` as forbidden and rewrites it.
 */
function rawHit(
  port: number,
  path: string,
  host: string,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('createLoginNonce', () => {
  it('is a 64-char hex string and differs per attempt', () => {
    const a = createLoginNonce();
    const b = createLoginNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('nonceMatches', () => {
  it('accepts the exact nonce', () => {
    const nonce = createLoginNonce();
    expect(nonceMatches(nonce, nonce)).toBe(true);
  });

  it('rejects a missing, short, long, or different value', () => {
    const nonce = createLoginNonce();
    expect(nonceMatches(nonce, null)).toBe(false);
    expect(nonceMatches(nonce, '')).toBe(false);
    expect(nonceMatches(nonce, nonce.slice(0, -1))).toBe(false);
    expect(nonceMatches(nonce, `${nonce}0`)).toBe(false);
    expect(nonceMatches(nonce, createLoginNonce())).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  it('accepts only a loopback literal addressing this listener', () => {
    expect(isLoopbackHost('127.0.0.1:4321', 4321)).toBe(true);
    expect(isLoopbackHost('localhost:4321', 4321)).toBe(true);
    expect(isLoopbackHost('[::1]:4321', 4321)).toBe(true);
    expect(isLoopbackHost('127.0.0.1', 4321)).toBe(true);
    // HTTP/1.0 sends no Host; a browser always does.
    expect(isLoopbackHost(undefined, 4321)).toBe(true);
    expect(isLoopbackHost('rebind.example.com:4321', 4321)).toBe(false);
    expect(isLoopbackHost('127.0.0.1.nip.io:4321', 4321)).toBe(false);
    expect(isLoopbackHost('127.0.0.1:4322', 4321)).toBe(false);
  });
});

/**
 * The loopback callback is the login CSRF surface: the port space is
 * small enough for a web page the user visits to scan, so a `code`
 * without our per-attempt nonce must be refused — otherwise the CLI
 * exchanges an attacker-minted code and saves a session for the wrong
 * account.
 */
describe('startCallbackServer', () => {
  it('accepts a code carrying the matching state', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce);
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/callback?code=good-code&state=${nonce}`,
      );
      expect(res.status).toBe(200);
      await expect(waitForCallback()).resolves.toBe('good-code');
    } finally {
      close();
    }
  });

  it('refuses a code with a wrong or missing state and keeps waiting', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce);
    try {
      const forged = await fetch(
        `http://127.0.0.1:${port}/callback?code=attacker-code&state=${createLoginNonce()}`,
      );
      expect(forged.status).toBe(403);

      const bare = await fetch(
        `http://127.0.0.1:${port}/callback?code=attacker-code`,
      );
      expect(bare.status).toBe(403);

      // The wait is still open, so the genuine redirect can still land —
      // and it is the one that decides the code.
      const real = await fetch(
        `http://127.0.0.1:${port}/callback?code=real-code&state=${nonce}`,
      );
      expect(real.status).toBe(200);
      await expect(waitForCallback()).resolves.toBe('real-code');
    } finally {
      close();
    }
  });

  it('refuses non-GET requests', async () => {
    const nonce = createLoginNonce();
    const { port, close } = await startCallbackServer(nonce);
    try {
      const posted = await fetch(
        `http://127.0.0.1:${port}/callback?code=c&state=${nonce}`,
        { method: 'POST' },
      );
      expect(posted.status).toBe(403);
    } finally {
      close();
    }
  });

  /**
   * The nonce is the defense, not the `Origin` header. A browser,
   * extension or proxy may attach one (`Origin: null` among them) to the
   * cross-origin redirect chain that *is* our callback, and refusing on
   * that would refuse the genuine login — which, since a refusal never
   * settles the wait, hangs the command for the whole timeout.
   */
  it('accepts the genuine redirect even when it carries an Origin header', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce);
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/callback?code=real-code&state=${nonce}`,
        { headers: { Origin: 'null' } },
      );
      expect(res.status).toBe(200);
      await expect(waitForCallback()).resolves.toBe('real-code');
    } finally {
      close();
    }
  });

  /**
   * The nonce is a backend contract: a server older than this CLI does
   * not echo it, and every genuine redirect is then refused. Failing
   * silently and hanging until the timeout leaves the user with nothing
   * to act on, so the refusal has to reach the error the wait rejects
   * with.
   */
  it('names the missing nonce when the timeout is reached', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce, {
      timeoutMs: 150,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/callback?code=c`);
      expect(res.status).toBe(403);
      await expect(waitForCallback()).rejects.toThrow(/no `state`/);
      await expect(waitForCallback()).rejects.toThrow(/older than this CLI/);
    } finally {
      close();
    }
  });

  it('names a refused non-GET callback when the timeout is reached', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce, {
      timeoutMs: 150,
    });
    try {
      await fetch(`http://127.0.0.1:${port}/callback?code=c&state=${nonce}`, {
        method: 'POST',
      });
      await expect(waitForCallback()).rejects.toThrow(/non-GET/);
    } finally {
      close();
    }
  });

  it('times out with the plain message when nothing was refused', async () => {
    const { waitForCallback, close } = await startCallbackServer(
      createLoginNonce(),
      { timeoutMs: 150 },
    );
    try {
      await expect(waitForCallback()).rejects.toThrow(/Login timed out\./);
    } finally {
      close();
    }
  });

  /**
   * A name under an attacker's control that resolves to `127.0.0.1` (DNS
   * rebinding) lets a remote page's requests reach this listener. The
   * nonce still guards the code, but such a request never addressed this
   * listener directly, so it is refused before it gets that far — and,
   * like every refusal, without settling the wait.
   */
  it('refuses a request addressed to a rebound host', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce);
    try {
      const rebound = await rawHit(
        port,
        `/callback?code=rebound&state=${nonce}`,
        'attacker.example.com',
      );
      expect(rebound.status).toBe(403);

      const real = await fetch(
        `http://127.0.0.1:${port}/callback?code=real-code&state=${nonce}`,
      );
      expect(real.status).toBe(200);
      await expect(waitForCallback()).resolves.toBe('real-code');
    } finally {
      close();
    }
  });

  it('404s any path other than /callback', async () => {
    const { port, close } = await startCallbackServer(createLoginNonce());
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });
});
