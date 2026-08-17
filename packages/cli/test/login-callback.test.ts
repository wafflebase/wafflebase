import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  UNBOUND_CALLBACK_MESSAGE,
  startCallbackServer,
  stateMatches,
} from '../src/commands/login.js';

const NONCE = randomBytes(32).toString('base64url');

async function hit(
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'manual',
  });
  return { status: res.status, body: await res.text() };
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

  it('rejects a callback with no nonce at all, with an actionable message', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      // `login` is already awaiting the callback when it arrives, so the
      // rejection handler is attached before the request here too.
      const waiting = srv.waitForCallback().then(
        () => null,
        (err: Error) => err,
      );
      const res = await hit(srv.port, '/callback?code=unbound');
      expect(res.status).toBe(400);
      expect(res.body).toBe(UNBOUND_CALLBACK_MESSAGE);
      // Fails fast rather than leaving the caller on the 30-second timeout.
      expect((await waiting)?.message).toMatch(/--allow-unbound-callback/);
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
      expect(await hit(srv.port, `/callback?state=${NONCE}`)).toEqual({
        status: 400,
        body: 'Missing code',
      });
      expect(await hit(srv.port, '/')).toEqual({
        status: 404,
        body: 'Not found',
      });
      expect(await settledWithin(srv.waitForCallback(), 50)).toBeNull();
    } finally {
      srv.close();
    }
  });
});
