import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig } from '../src/config/config.js';

describe('resolveConfig', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.WAFFLEBASE_SERVER;
    delete process.env.WAFFLEBASE_API_KEY;
    delete process.env.WAFFLEBASE_WORKSPACE;
    delete process.env.WAFFLEBASE_CONFIG;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('uses defaults when nothing is provided', () => {
    // Point to non-existent config file
    process.env.WAFFLEBASE_CONFIG = '/tmp/nonexistent-wafflebase-config.yaml';
    const config = resolveConfig({});
    expect(config.server).toBe('http://localhost:3000');
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
