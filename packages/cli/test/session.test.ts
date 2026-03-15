import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadSession,
  saveSession,
  clearSession,
  isSessionExpired,
  decodeJwtExpiry,
  type Session,
} from '../src/config/session.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    server: 'http://localhost:3000',
    user: { id: 1, username: 'testuser', email: 'test@example.com', photo: null },
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    activeWorkspace: 'ws-1',
    workspaces: [{ id: 'ws-1', name: 'My Workspace' }],
    ...overrides,
  };
}

describe('loadSession', () => {
  it('returns null when file does not exist', () => {
    const path = join(tmpdir(), `wfb-session-nonexistent-${Date.now()}.json`);
    expect(loadSession(path)).toBeNull();
  });

  it('returns null when file contains invalid JSON', () => {
    const dir = join(tmpdir(), `wfb-session-invalid-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'session.json');
    writeFileSync(path, 'not-json', 'utf-8');
    expect(loadSession(path)).toBeNull();
  });
});

describe('saveSession + loadSession', () => {
  let tmpDir: string;
  let sessionPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `wfb-session-test-${Date.now()}`);
    sessionPath = join(tmpDir, 'session.json');
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes JSON that loadSession can read back', () => {
    const session = makeSession();
    saveSession(session, sessionPath);
    const loaded = loadSession(sessionPath);
    expect(loaded).toEqual(session);
  });

  it('creates directory if it does not exist', () => {
    expect(existsSync(tmpDir)).toBe(false);
    saveSession(makeSession(), sessionPath);
    expect(existsSync(sessionPath)).toBe(true);
  });

  it('sets file permissions to 0o600 on non-Windows', () => {
    if (process.platform === 'win32') return;
    saveSession(makeSession(), sessionPath);
    const stats = statSync(sessionPath);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('clearSession', () => {
  let tmpDir: string;
  let sessionPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `wfb-session-clear-${Date.now()}`);
    sessionPath = join(tmpDir, 'session.json');
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('deletes the session file when it exists', () => {
    saveSession(makeSession(), sessionPath);
    expect(existsSync(sessionPath)).toBe(true);
    clearSession(sessionPath);
    expect(existsSync(sessionPath)).toBe(false);
  });

  it('is a no-op when file does not exist', () => {
    // Should not throw
    expect(() => clearSession(sessionPath)).not.toThrow();
  });
});

describe('isSessionExpired', () => {
  it('returns true for a past expiresAt', () => {
    const session = makeSession({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(isSessionExpired(session)).toBe(true);
  });

  it('returns false for a future expiresAt', () => {
    const session = makeSession({ expiresAt: new Date(Date.now() + 3600 * 1000).toISOString() });
    expect(isSessionExpired(session)).toBe(false);
  });
});

describe('decodeJwtExpiry', () => {
  it('extracts exp claim from a real JWT-like token', () => {
    // Build a minimal JWT: header.payload.signature
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = { sub: '42', exp };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = `eyJhbGciOiJIUzI1NiJ9.${encoded}.fakesig`;

    const result = decodeJwtExpiry(token);
    expect(result).toBe(new Date(exp * 1000).toISOString());
  });

  it('handles base64url padding differences', () => {
    const exp = 1700000000;
    // Craft a payload where base64url encoding has no padding
    const payload = { exp };
    const encoded = Buffer.from(JSON.stringify(payload))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const token = `header.${encoded}.sig`;

    const result = decodeJwtExpiry(token);
    expect(result).toBe(new Date(exp * 1000).toISOString());
  });
});
