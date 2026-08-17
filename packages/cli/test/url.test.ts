import { describe, expect, it } from 'vitest';
import { apiKeysUrl, apiV1Base, seg, workspaceSeg } from '../src/client/url.js';
import type { CliConfig } from '../src/config/config.js';

const CONFIG: CliConfig = {
  server: 'https://api.example.test',
  apiKey: 'wfb_test',
  workspace: 'ws-1',
  authMode: 'api-key',
};

describe('seg', () => {
  it('percent-encodes the characters that would retarget the request', () => {
    expect(seg('a/b')).toBe('a%2Fb');
    expect(seg('doc?force=true')).toBe('doc%3Fforce%3Dtrue');
    expect(seg('a#b')).toBe('a%23b');
  });

  it('leaves an ordinary identifier untouched', () => {
    expect(seg('doc-1')).toBe('doc-1');
    expect(seg('report.v2..final')).toBe('report.v2..final');
  });

  it('refuses an identifier that is exactly a dot segment', () => {
    for (const value of ['.', '..']) {
      expect(() => seg(value)).toThrow(/Invalid identifier/);
    }
  });

  /**
   * Express runs with strict routing disabled, so `/documents/` matches the
   * *collection* route: an empty id would list every document rather than 404.
   */
  it('refuses an empty identifier', () => {
    expect(() => seg('')).toThrow(/Invalid identifier ""/);
  });
});

describe('workspaceSeg', () => {
  /**
   * `resolveConfig` deliberately returns `workspace: ''` when no `--workspace`,
   * `WAFFLEBASE_WORKSPACE`, session `activeWorkspace` or profile value exists,
   * and `login` persists `activeWorkspace: ''` for an account with no
   * workspaces. Every path built on the workspace has further segments, so an
   * empty one matches no route — it must pass through rather than break every
   * command and every `--dry-run` preview.
   */
  it('passes an unconfigured workspace through as an empty segment', () => {
    expect(workspaceSeg({ ...CONFIG, workspace: '' })).toBe('');
  });

  it('escapes a non-empty workspace like any other identifier', () => {
    expect(workspaceSeg({ ...CONFIG, workspace: 'a/b' })).toBe('a%2Fb');
    expect(() => workspaceSeg({ ...CONFIG, workspace: '..' })).toThrow(
      /Invalid identifier/,
    );
  });
});

describe('apiV1Base', () => {
  it('builds the workspace-scoped v1 base', () => {
    expect(apiV1Base(CONFIG)).toBe(
      'https://api.example.test/api/v1/workspaces/ws-1',
    );
  });

  it('strips a trailing slash from the configured server', () => {
    expect(apiV1Base({ ...CONFIG, server: 'https://api.example.test/' })).toBe(
      'https://api.example.test/api/v1/workspaces/ws-1',
    );
  });

  it('renders an unconfigured workspace as an empty segment', () => {
    expect(apiV1Base({ ...CONFIG, workspace: '' })).toBe(
      'https://api.example.test/api/v1/workspaces/',
    );
  });

  it('refuses a dot-segment workspace', () => {
    expect(() => apiV1Base({ ...CONFIG, workspace: '..' })).toThrow(
      /Invalid identifier/,
    );
  });
});

describe('apiKeysUrl', () => {
  it('builds the collection URL, and the per-key URL when given an id', () => {
    expect(apiKeysUrl(CONFIG)).toBe(
      'https://api.example.test/workspaces/ws-1/api-keys',
    );
    expect(apiKeysUrl(CONFIG, 'key-1')).toBe(
      'https://api.example.test/workspaces/ws-1/api-keys/key-1',
    );
  });

  it('strips a trailing slash from the configured server', () => {
    expect(apiKeysUrl({ ...CONFIG, server: 'https://api.example.test/' })).toBe(
      'https://api.example.test/workspaces/ws-1/api-keys',
    );
  });

  it('escapes the key id and refuses a dot-segment one', () => {
    expect(apiKeysUrl(CONFIG, '../documents/d1')).toBe(
      'https://api.example.test/workspaces/ws-1/api-keys/..%2Fdocuments%2Fd1',
    );
    expect(() => apiKeysUrl(CONFIG, '..')).toThrow(/Invalid identifier/);
  });

  it('renders an unconfigured workspace as an empty segment', () => {
    expect(apiKeysUrl({ ...CONFIG, workspace: '' })).toBe(
      'https://api.example.test/workspaces//api-keys',
    );
  });
});
