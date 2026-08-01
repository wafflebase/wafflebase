import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithAuth = vi.fn();
vi.mock('@/api/auth', () => ({ fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a) }));

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
      json: async () => ({ message: 'The Miro token was rejected (invalid or expired)' }),
      text: async () => '{"message":"The Miro token was rejected (invalid or expired)"}',
    });

    await expect(
      importMiroBoard('ws-1', { token: 'bad', boardUrl: 'B=' }),
    ).rejects.toThrow(/Miro token/i);
  });
});
