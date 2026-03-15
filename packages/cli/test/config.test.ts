import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveConfig, getConfigPath, migrateConfigIfNeeded, DEFAULT_SERVER } from '../src/config/config.js';

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
