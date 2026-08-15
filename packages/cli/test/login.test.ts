import { describe, it, expect } from 'vitest';
import {
  createLoginNonce,
  nonceMatches,
  startCallbackServer,
} from '../src/commands/login.js';

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

  it('refuses cross-origin and non-GET requests', async () => {
    const nonce = createLoginNonce();
    const { port, close } = await startCallbackServer(nonce);
    try {
      const crossOrigin = await fetch(
        `http://127.0.0.1:${port}/callback?code=c&state=${nonce}`,
        { headers: { Origin: 'https://evil.example' } },
      );
      expect(crossOrigin.status).toBe(403);

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

  it('names a refused cross-origin callback when the timeout is reached', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce, {
      timeoutMs: 150,
    });
    try {
      await fetch(`http://127.0.0.1:${port}/callback?code=c&state=${nonce}`, {
        headers: { Origin: 'https://evil.example' },
      });
      await expect(waitForCallback()).rejects.toThrow(/Origin/);
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
