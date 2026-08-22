import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuth = vi.hoisted(() => vi.fn());

vi.mock('@/api/auth', () => ({ fetchWithAuth }));

import {
  createWorkspaceLakehouseSource,
  deleteLakehouseSource,
  fetchLakehouseHistory,
  fetchLakehouseSource,
  fetchWorkspaceLakehouseSources,
  readLakehouseSource,
  testLakehouseSource,
  testWorkspaceLakehouseSource,
  updateLakehouseSource,
} from '@/api/lakehouse';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe('lakehouse api', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
  });

  it('lists workspace sources with an encoded workspace id and signal', async () => {
    const signal = new AbortController().signal;
    fetchWithAuth.mockResolvedValue(okJson([{ id: 'source-1' }]));

    await expect(
      fetchWorkspaceLakehouseSources('workspace/one', signal),
    ).resolves.toEqual([{ id: 'source-1' }]);

    expect(fetchWithAuth).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/workspaces\/workspace%2Fone\/lakehouse-sources$/,
      ),
      { signal },
    );
  });

  it('creates and updates sources with JSON request bodies', async () => {
    const createPayload = {
      name: 'Events',
      format: 'delta' as const,
      storage: 's3-compatible' as const,
      endpoint: 'http://localhost:9000',
      bucket: 'fixtures',
      basePath: 'delta-events',
      credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
      },
    };
    fetchWithAuth
      .mockResolvedValueOnce(okJson({ id: 'source-1' }))
      .mockResolvedValueOnce(okJson({ id: 'source-1', name: 'Renamed' }));

    await createWorkspaceLakehouseSource('workspace-1', createPayload);
    const updatePayload = {
      name: 'Renamed',
      endpoint: null,
      region: null,
      bucket: null,
    };
    await updateLakehouseSource('source/1', updatePayload);

    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/workspaces\/workspace-1\/lakehouse-sources$/),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      },
    );
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/lakehouse-sources\/source%2F1$/),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      },
    );
  });

  it('uses the source-scoped get, test, history, and delete routes', async () => {
    fetchWithAuth.mockResolvedValue(okJson({}));

    await fetchLakehouseSource('source/1');
    await testLakehouseSource('source/1');
    await fetchLakehouseHistory('source/1');
    await deleteLakehouseSource('source/1');

    expect(fetchWithAuth.mock.calls).toEqual([
      [
        expect.stringMatching(/\/lakehouse-sources\/source%2F1$/),
        {
          signal: undefined,
        },
      ],
      [
        expect.stringMatching(/\/lakehouse-sources\/source%2F1\/test$/),
        {
          method: 'POST',
          signal: undefined,
        },
      ],
      [
        expect.stringMatching(/\/lakehouse-sources\/source%2F1\/history$/),
        {
          signal: undefined,
        },
      ],
      [
        expect.stringMatching(/\/lakehouse-sources\/source%2F1$/),
        {
          method: 'DELETE',
        },
      ],
    ]);
  });

  it('tests unsaved and existing source configurations without save requests', async () => {
    const signal = new AbortController().signal;
    const createPayload = {
      name: 'Events',
      format: 'delta' as const,
      storage: 's3-compatible' as const,
      endpoint: 'http://localhost:9000',
      bucket: 'fixtures',
      basePath: 'delta-events',
      credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
      },
    };
    const updatePayload = {
      name: 'Renamed',
      endpoint: null,
    };
    fetchWithAuth.mockResolvedValue(okJson({ success: true }));

    await testWorkspaceLakehouseSource('workspace/one', createPayload, signal);
    await testLakehouseSource('source/one', updatePayload, signal);

    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /\/workspaces\/workspace%2Fone\/lakehouse-sources\/test$/,
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
        signal,
      },
    );
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/lakehouse-sources\/source%2Fone\/test$/),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
        signal,
      },
    );
  });

  it('sends an optional time-travel point to the read route', async () => {
    const signal = new AbortController().signal;
    fetchWithAuth
      .mockResolvedValueOnce(okJson({ rows: [] }))
      .mockResolvedValueOnce(okJson({ rows: [] }));

    await readLakehouseSource('source-1', undefined, signal);
    await readLakehouseSource(
      'source-1',
      { kind: 'version', version: 3 },
      signal,
    );

    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/lakehouse-sources\/source-1\/read$/),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal,
      },
    );
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/lakehouse-sources\/source-1\/read$/),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asOf: { kind: 'version', version: 3 },
        }),
        signal,
      },
    );
  });
});
