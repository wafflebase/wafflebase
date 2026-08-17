import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import {
  START_CONSUMED_MESSAGE,
  UNBOUND_CALLBACK_MESSAGE,
  buildAuthorizeUrl,
  registerLoginCommand,
  startCallbackServer,
  stateMatches,
} from '../src/commands/login.js';

const NONCE = randomBytes(32).toString('base64url');

async function hit(
  port: number,
  path: string,
): Promise<{ status: number; body: string; location: string | null }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'manual',
  });
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get('location'),
  };
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
      // lever for aborting the login — it is reported and then ignored.
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toMatch(/--allow-unbound-callback/);
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

  it('does not crash when a callback arrives before anyone awaits it', async () => {
    // `login` only reaches `waitForCallback()` after `await import('open')`
    // and `open()`; a rejection raised in that window must not surface as an
    // unhandled rejection.
    const srv = await startCallbackServer(NONCE, { warn: () => {} });
    try {
      const res = await hit(srv.port, '/callback?code=unbound');
      expect(res.status).toBe(400);
      // Nothing awaited the promise at any point before now.
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

  it('keeps the nonce out of the URL handed to the browser and to stderr', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      srv.setAuthorizeUrl(buildAuthorizeUrl('https://api.example.com', srv.port, NONCE));
      // This is the URL `login` prints and passes to `open()`: no nonce, so
      // neither stderr nor `/proc/<pid>/cmdline` carries it...
      expect(srv.startUrl).toBe(`http://127.0.0.1:${srv.port}/start`);
      expect(srv.startUrl).not.toContain(NONCE);

      // ...and it is still the URL that works, which is what the headless
      // copy-paste path depends on: it redirects to the nonce-carrying one.
      const redirect = await hit(srv.port, '/start');
      expect(redirect.status).toBe(302);
      expect(redirect.location).toBe(
        buildAuthorizeUrl('https://api.example.com', srv.port, NONCE),
      );
      expect(
        new URL(redirect.location ?? '').searchParams.get('cliState'),
      ).toBe(NONCE);
    } finally {
      srv.close();
    }
  });

  it('hands the nonce out only once', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      // Before the authorize URL is known there is nothing to leak either.
      expect((await hit(srv.port, '/start')).status).toBe(503);
      srv.setAuthorizeUrl(buildAuthorizeUrl('https://api.example.com', srv.port, NONCE));
      expect((await hit(srv.port, '/start')).status).toBe(302);

      const second = await hit(srv.port, '/start');
      expect(second.status).toBe(410);
      expect(second.location).toBeNull();
      expect(second.body).toBe(START_CONSUMED_MESSAGE);
    } finally {
      srv.close();
    }
  });
});

describe('registerLoginCommand', () => {
  it('registers `login` with the unbound-callback opt-out', () => {
    const program = new Command();
    registerLoginCommand(program);

    const login = program.commands.find((c) => c.name() === 'login');
    expect(login).toBeDefined();
    expect(login?.options.map((o) => o.long)).toContain(
      '--allow-unbound-callback',
    );
  });
});
