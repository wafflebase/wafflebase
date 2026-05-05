import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveConfig, getConfigPath, migrateConfigIfNeeded, DEFAULT_SERVER } from '../src/config/config.js';
import type { Session } from '../src/config/session.js';

describe('resolveConfig', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.WAFFLEBASE_SERVER;
    delete process.env.WAFFLEBASE_API_KEY;
    delete process.env.WAFFLEBASE_WORKSPACE;
    delete process.env.WAFFLEBASE_CONFIG;
    delete process.env.WAFFLEBASE_SESSION;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('uses defaults when nothing is provided', () => {
    // Point to non-existent config/session files
    process.env.WAFFLEBASE_CONFIG = '/tmp/nonexistent-wafflebase-config.yaml';
    process.env.WAFFLEBASE_SESSION = '/tmp/nonexistent-wafflebase-session.json';
    const config = resolveConfig({});
    expect(config.server).toBe(DEFAULT_SERVER);
    expect(config.apiKey).toBe('');
    expect(config.workspace).toBe('');
  });

  it('flags override env vars', () => {
    process.env.WAFFLEBASE_SERVER = 'https://env.example.com';
    process.env.WAFFLEBASE_API_KEY = 'wfb_env';
    process.env.WAFFLEBASE_WORKSPACE = 'ws-env';

    const config = resolveConfig({
      server: 'https://flag.example.com',
      apiKey: 'wfb_flag',
      workspace: 'ws-flag',
    });

    expect(config.server).toBe('https://flag.example.com');
    expect(config.apiKey).toBe('wfb_flag');
    expect(config.workspace).toBe('ws-flag');
  });

  it('env vars override config file defaults', () => {
    process.env.WAFFLEBASE_CONFIG = '/tmp/nonexistent-wafflebase-config.yaml';
    process.env.WAFFLEBASE_SERVER = 'https://env.example.com';
    process.env.WAFFLEBASE_API_KEY = 'wfb_env';

    const config = resolveConfig({});

    expect(config.server).toBe('https://env.example.com');
    expect(config.apiKey).toBe('wfb_env');
  });

  describe('session-backed JWT auth', () => {
    let tmpDir: string;
    let sessionPath: string;

    function writeSessionFile(overrides: Partial<Session>): void {
      const session: Session = {
        server: 'https://api.example.com',
        user: { id: 1, username: 'u', email: 'u@example.com', photo: null },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        activeWorkspace: 'ws-from-session',
        workspaces: [{ id: 'ws-from-session', name: 'WS' }],
        ...overrides,
      };
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(sessionPath, JSON.stringify(session), 'utf-8');
    }

    beforeEach(() => {
      tmpDir = join(tmpdir(), `wfb-config-session-${Date.now()}-${Math.random()}`);
      sessionPath = join(tmpDir, 'session.json');
      process.env.WAFFLEBASE_CONFIG = join(tmpDir, 'config.yaml');
      process.env.WAFFLEBASE_SESSION = sessionPath;
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uses session JWT auth when access token is still valid', () => {
      writeSessionFile({ expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      const config = resolveConfig({});
      expect(config.authMode).toBe('jwt');
      expect(config.workspace).toBe('ws-from-session');
      expect(config.accessToken).toBe('access-token');
      expect(config.refreshToken).toBe('refresh-token');
    });

    // Regression: when the access token is expired but a refresh token is
    // present, resolveConfig must still pick JWT auth and surface the
    // session's active workspace. Otherwise the HTTP client builds
    // `/api/v1/workspaces//documents` (empty segment) and the backend
    // returns 404, making expired sessions look like missing routes.
    it('keeps JWT auth and workspace when access token is expired but refresh token exists', () => {
      writeSessionFile({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
      const config = resolveConfig({});
      expect(config.authMode).toBe('jwt');
      expect(config.workspace).toBe('ws-from-session');
      expect(config.accessToken).toBe('access-token');
      expect(config.refreshToken).toBe('refresh-token');
    });
  });
});

describe('getConfigPath', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.WAFFLEBASE_CONFIG;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns ~/.wafflebase/config.yaml by default', () => {
    const path = getConfigPath();
    expect(path).toMatch(/\.wafflebase[/\\]config\.yaml$/);
    expect(path).not.toMatch(/\.config[/\\]wafflebase/);
  });

  it('WAFFLEBASE_CONFIG overrides the default path', () => {
    process.env.WAFFLEBASE_CONFIG = '/custom/path/config.yaml';
    expect(getConfigPath()).toBe('/custom/path/config.yaml');
  });
});

describe('migrateConfigIfNeeded', () => {
  it('copies config from old path to new path when new path does not exist', () => {
    const base = join(tmpdir(), `wfb-migrate-test-${Date.now()}`);
    const oldDir = join(base, 'old');
    const newDir = join(base, 'new');
    const oldPath = join(oldDir, 'config.yaml');
    const newPath = join(newDir, 'config.yaml');

    mkdirSync(oldDir, { recursive: true });
    writeFileSync(oldPath, 'profiles:\n  default:\n    server: https://old.example.com\n');

    migrateConfigIfNeeded(newPath, oldPath);

    expect(existsSync(newPath)).toBe(true);
    expect(readFileSync(newPath, 'utf-8')).toContain('https://old.example.com');
  });

  it('does not overwrite an existing new path', () => {
    const base = join(tmpdir(), `wfb-migrate-nooverwrite-${Date.now()}`);
    const oldDir = join(base, 'old');
    const newDir = join(base, 'new');
    const oldPath = join(oldDir, 'config.yaml');
    const newPath = join(newDir, 'config.yaml');

    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(oldPath, 'profiles:\n  default:\n    server: https://old.example.com\n');
    writeFileSync(newPath, 'profiles:\n  default:\n    server: https://new.example.com\n');

    migrateConfigIfNeeded(newPath, oldPath);

    expect(readFileSync(newPath, 'utf-8')).toContain('https://new.example.com');
  });

  it('does nothing when neither old nor new path exists', () => {
    const base = join(tmpdir(), `wfb-migrate-none-${Date.now()}`);
    const oldPath = join(base, 'old', 'config.yaml');
    const newPath = join(base, 'new', 'config.yaml');

    // Should not throw
    migrateConfigIfNeeded(newPath, oldPath);

    expect(existsSync(newPath)).toBe(false);
  });
});
