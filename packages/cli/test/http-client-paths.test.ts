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

  // `config.workspace` is not a trusted constant: it comes from `--workspace`,
  // `WAFFLEBASE_WORKSPACE`, or a profile in the YAML config, so it is exactly
  // as caller-controlled as a document id — and it sits in the prefix every
  // other segment is supposed to stay under.
  describe('the workspace segment', () => {
    const HOSTILE: CliConfig = { ...CONFIG, workspace: '../../admin/users' };

    it('is escaped on the v1 API base', async () => {
      await new HttpClient({ ...HOSTILE }).getDocument('doc-1');

      expect(urlOf(0)).toBe(
        `${CONFIG.server}/api/v1/workspaces/..%2F..%2Fadmin%2Fusers/documents/doc-1`,
      );
      expect(new URL(urlOf(0)).pathname).toBe(
        '/api/v1/workspaces/..%2F..%2Fadmin%2Fusers/documents/doc-1',
      );
    });

    it('is escaped on the api-key management route', async () => {
      await new HttpClient({ ...HOSTILE }).listApiKeys();

      expect(urlOf(0)).toBe(
        `${CONFIG.server}/workspaces/..%2F..%2Fadmin%2Fusers/api-keys`,
      );
    });

    it('is escaped on the multipart files route', async () => {
      await new HttpClient({ ...HOSTILE }).uploadFileDocument(
        new Uint8Array([1, 2]),
        'a.bin',
        'application/octet-stream',
      );

      expect(urlOf(0)).toBe(
        `${CONFIG.server}/api/v1/workspaces/..%2F..%2Fadmin%2Fusers/files`,
      );
    });
  });

  /**
   * Escaping is not sufficient on its own: `encodeURIComponent` leaves `.`
   * alone, and the WHATWG parser resolves a segment that *is* `..` (or `%2e%2e`)
   * no matter how it was written. The only correct handling is refusal — and
   * refusal has to happen before the request goes out, because on the api-key
   * route the resolved path (`DELETE /workspaces/<ws>/`) is the workspace-delete
   * endpoint.
   */
  describe('a dot-segment identifier', () => {
    it('is refused rather than sent on the destructive api-key route', async () => {
      await expect(async () =>
        new HttpClient({ ...CONFIG }).revokeApiKey('..'),
      ).rejects.toThrow(/Invalid path segment/);

      expect(fetchMock).not.toHaveBeenCalled();
      // What the rejected request would have become had it been sent.
      expect(
        new URL(`${CONFIG.server}/workspaces/ws-1/api-keys/..`).pathname,
      ).toBe('/workspaces/ws-1/');
    });

    it('is refused as a document id', async () => {
      // Wrapped in an async thunk because the path is built synchronously by
      // some callers and inside the async `request()` by others — either way
      // no request is issued.
      await expect(async () =>
        new HttpClient({ ...CONFIG }).getDocument('..'),
      ).rejects.toThrow(/Invalid path segment/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is refused as a workspace, before any request is built', async () => {
      await expect(async () =>
        new HttpClient({ ...CONFIG, workspace: '..' }).listDocuments(),
      ).rejects.toThrow(/Invalid path segment/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is neutralised, not refused, when the id merely spells one out', async () => {
      // A literal `%2e%2e` is a double-dot segment per the URL spec, but only
      // if it reaches the URL unescaped. Escaping the `%` is enough here, so
      // the id is sent as data rather than rejected.
      await new HttpClient({ ...CONFIG }).getDocument('%2e%2e');

      expect(urlOf(0)).toBe(`${BASE}/documents/%252e%252e`);
      expect(new URL(urlOf(0)).pathname).toBe(
        '/api/v1/workspaces/ws-1/documents/%252e%252e',
      );
    });

    it('leaves a single dot inside a longer id alone', async () => {
      await new HttpClient({ ...CONFIG }).getDocument('report.v2..final');

      expect(urlOf(0)).toBe(`${BASE}/documents/report.v2..final`);
    });
  });
});
