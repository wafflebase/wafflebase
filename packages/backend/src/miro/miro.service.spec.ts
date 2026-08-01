import { MiroService } from './miro.service';
import type { ImageService } from '../image/image.service';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeService() {
  const imageService = { upload: jest.fn() };
  const service = new MiroService(imageService as unknown as ImageService);
  return { service, imageService };
}

describe('MiroService.importBoard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('paginates items via cursor and fetches connectors separately', async () => {
    const fetchMock = jest.fn()
      // items page 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: '1', type: 'shape' }],
        cursor: 'CUR1',
      }))
      // items page 2 (no cursor -> last)
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: '2', type: 'text' }],
      }))
      // connectors page 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'c1', startItem: { id: '1' }, endItem: { id: '2' } }],
      }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service } = makeService();
    const result = await service.importBoard('tok', 'https://miro.com/app/board/B=/', 'ws-1');

    expect(result.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(result.connectors.map((c) => c.id)).toEqual(['c1']);

    // Requests: 2 item pages + 1 connector page.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(String(firstUrl)).toContain('/v2/boards/B%3D/items');
    expect(String(firstUrl)).toContain('limit=50');
    expect((firstInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok',
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=CUR1');
    expect(String(fetchMock.mock.calls[2][0])).toContain('/connectors');
  });

  it('maps a 401 from Miro to an unauthorized error mentioning the token', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ message: 'nope' }, 401)) as unknown as typeof fetch;
    const { service } = makeService();
    await expect(
      service.importBoard('bad', 'https://miro.com/app/board/B=/', 'ws-1'),
    ).rejects.toThrow(/token/i);
  });

  it('maps a 404 from Miro to a not-found error', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;
    const { service } = makeService();
    await expect(
      service.importBoard('tok', 'https://miro.com/app/board/B=/', 'ws-1'),
    ).rejects.toThrow(/not found|no access/i);
  });

  it('stops at the item ceiling and reports the truncation', async () => {
    // Every page returns 50 items and a cursor, so only the ceiling stops it.
    const page = {
      data: Array.from({ length: 50 }, (_, i) => ({ id: `i${i}`, type: 'shape' })),
      cursor: 'MORE',
    };
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(page)) as unknown as typeof fetch;

    const { service } = makeService();
    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(result.items.length).toBe(MiroService.MAX_ITEMS);
    // Both feeds truncate here, so each note must name the feed it covers.
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'truncated', itemType: 'items' }),
    );
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'truncated', itemType: 'connectors' }),
    );
  });

  it('stops when a page is empty but still advertises a cursor', async () => {
    // A stuck cursor: every page claims there is more but delivers nothing.
    // Without a no-forward-progress guard the item ceiling never trips
    // (`out.length` stays 0) and the loop would fetch forever.
    let calls = 0;
    const fetchMock = jest.fn().mockImplementation(() => {
      calls += 1;
      // Safety valve: if the guard regresses, the loop still terminates and
      // the call-count assertion below fails loudly, instead of hanging the
      // whole suite on a starved event loop.
      if (calls > 100) return Promise.resolve(jsonResponse({ data: [] }));
      return Promise.resolve(jsonResponse({ data: [], cursor: 'SAME' }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service } = makeService();
    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(result.items).toEqual([]);
    expect(result.connectors).toEqual([]);
    // Exactly one request per feed — the stalled cursor is not followed.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'stalled', itemType: 'items' }),
    );
  });

  it('never includes the token in the result', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ data: [] })) as unknown as typeof fetch;
    const { service } = makeService();
    const result = await service.importBoard('SECRET-TOKEN', 'B=', 'ws-1');
    expect(JSON.stringify(result)).not.toContain('SECRET-TOKEN');
  });
});
