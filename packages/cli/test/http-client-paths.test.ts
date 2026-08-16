import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/client/http-client.js';
import type { CliConfig } from '../src/config/config.js';

/**
 * Identifiers reach the client straight from argv, and `fetch` parses the URL
 * string with the WHATWG parser — which resolves `..` segments and truncates
 * the path at a `?` or `#`. Unencoded, a crafted document/tab/cell id would
 * therefore send the request (with the caller's credential attached) to an
 * arbitrary path on the configured server rather than inside the workspace
 * prefix. Every interpolated segment must be escaped.
 */

const CONFIG: CliConfig = {
  server: 'https://api.example.test',
  apiKey: 'wfb_test',
  workspace: 'ws-1',
  authMode: 'api-key',
};
const BASE = `${CONFIG.server}/api/v1/workspaces/${CONFIG.workspace}`;

const fetchMock = vi.fn();

function urlOf(call: number): string {
  return String(fetchMock.mock.calls[call][0]);
}

describe('HttpClient path encoding', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('escapes a traversal-shaped document id instead of resolving it', async () => {
    await new HttpClient({ ...CONFIG }).getDocument('../../../admin/users');

    // The decisive assertion: the request stays under the workspace prefix.
    expect(urlOf(0)).toBe(`${BASE}/documents/..%2F..%2F..%2Fadmin%2Fusers`);
    expect(new URL(urlOf(0)).pathname).toContain('/workspaces/ws-1/documents/');
  });

  it('escapes a `?` in an id rather than letting it start a query string', async () => {
    await new HttpClient({ ...CONFIG }).deleteDocument('doc-1?force=true');

    expect(urlOf(0)).toBe(`${BASE}/documents/doc-1%3Fforce%3Dtrue`);
  });

  it('escapes doc, tab and cell segments together', async () => {
    await new HttpClient({ ...CONFIG }).getCell('d/1', 't/2', 'A1/../..');

    expect(urlOf(0)).toBe(
      `${BASE}/documents/d%2F1/tabs/t%2F2/cells/A1%2F..%2F..`,
    );
  });

  it('leaves ordinary identifiers untouched', async () => {
    const client = new HttpClient({ ...CONFIG });
    await client.getCells('doc-1', 'tab-1', 'A1:C10');
    await client.listTabs('doc-1');
    await client.getDocContent('doc-1');

    expect(urlOf(0)).toBe(`${BASE}/documents/doc-1/tabs/tab-1/cells?range=A1%3AC10`);
    expect(urlOf(1)).toBe(`${BASE}/documents/doc-1/tabs`);
    expect(urlOf(2)).toBe(`${BASE}/documents/doc-1/content`);
  });

  it('escapes the key id on the api-key management route', async () => {
    await new HttpClient({ ...CONFIG }).revokeApiKey('../../../documents/d1');

    expect(urlOf(0)).toBe(
      `${CONFIG.server}/workspaces/ws-1/api-keys/..%2F..%2F..%2Fdocuments%2Fd1`,
    );
  });
});
