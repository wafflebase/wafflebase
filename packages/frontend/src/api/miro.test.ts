import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithAuth = vi.fn();
vi.mock('@/api/auth', () => ({ fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a) }));

import { HttpError } from './http-error';
import { importMiroBoard } from './miro';

describe('importMiroBoard', () => {
  beforeEach(() => fetchWithAuth.mockReset());

  it('posts the token and board url to the workspace-scoped endpoint', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], connectors: [], notes: [] }),
    });

    await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'https://miro.com/app/board/B=/' });

    const [url, init] = fetchWithAuth.mock.calls[0];
    expect(String(url)).toContain('/workspaces/ws-1/miro/import');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      token: 'tok',
      boardUrl: 'https://miro.com/app/board/B=/',
    });
  });

  it('throws with the server message on failure', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: false,
      status: 401,
      // A real `fetch()` Response always carries Headers, and `assertOk` reads
      // `retry-after` off it before extracting the message — so the double
      // must have one too.
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'The Miro token was rejected (invalid or expired)' }),
      text: async () => '{"message":"The Miro token was rejected (invalid or expired)"}',
    });

    await expect(
      importMiroBoard('ws-1', { token: 'bad', boardUrl: 'B=' }),
    ).rejects.toThrow(/Miro token/i);
  });

  it('throws an HttpError carrying status and retry-after, like the other API modules', async () => {
    // Miro documents rate limits, so callers must be able to read `.status`
    // and `.retryAfterMs` off the failure. That uniform contract is why this
    // goes through the shared `assertOk` rather than throwing a plain Error.
    fetchWithAuth.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({
        'content-type': 'application/json',
        'retry-after': '30',
      }),
      json: async () => ({ message: 'Miro rate limit exceeded' }),
      text: async () => '{"message":"Miro rate limit exceeded"}',
    });

    const err = await importMiroBoard('ws-1', {
      token: 'tok',
      boardUrl: 'B=',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(429);
    expect((err as HttpError).retryAfterMs).toBe(30_000);
    expect((err as HttpError).message).toMatch(/rate limit/i);
  });
});
