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
    const fetchMock = jest
      .fn()
      // items page 1
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: '1', type: 'shape' }],
          cursor: 'CUR1',
        }),
      )
      // items page 2 (no cursor -> last)
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: '2', type: 'text' }],
        }),
      )
      // connectors page 1
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'c1', startItem: { id: '1' }, endItem: { id: '2' } }],
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service } = makeService();
    const result = await service.importBoard(
      'tok',
      'https://miro.com/app/board/B=/',
      'ws-1',
    );

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
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: 'nope' }, 401),
      ) as unknown as typeof fetch;
    const { service } = makeService();
    await expect(
      service.importBoard('bad', 'https://miro.com/app/board/B=/', 'ws-1'),
    ).rejects.toThrow(/token/i);
  });

  it('maps a 404 from Miro to a not-found error', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;
    const { service } = makeService();
    await expect(
      service.importBoard('tok', 'https://miro.com/app/board/B=/', 'ws-1'),
    ).rejects.toThrow(/not found|no access/i);
  });

  it('stops at the item ceiling and reports the truncation', async () => {
    // Every page returns 50 items and a cursor, so only the ceiling stops it.
    const page = {
      data: Array.from({ length: 50 }, (_, i) => ({
        id: `i${i}`,
        type: 'shape',
      })),
      cursor: 'MORE',
    };
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(page)) as unknown as typeof fetch;

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

  it('gives every feed request a deadline and names a timeout as one', async () => {
    // Node's fetch applies NO overall deadline, so a connection that is
    // accepted and then stalls would hold the request worker forever. The
    // signal is the fix; the message must not read as an unreachable host.
    const timeout = Object.assign(new Error('The operation was aborted'), {
      name: 'TimeoutError',
    });
    const fetchMock = jest.fn().mockRejectedValue(timeout);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service } = makeService();
    await expect(service.importBoard('tok', 'B=', 'ws-1')).rejects.toThrow(
      /did not respond in time/i,
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeDefined();
  });

  it('treats an AbortError from the feed fetch as a timeout too', async () => {
    // Older runtimes surface `AbortSignal.timeout` as a plain AbortError. The
    // feed fetch carries no other abort source, so an abort IS the deadline.
    const aborted = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    });
    global.fetch = jest
      .fn()
      .mockRejectedValue(aborted) as unknown as typeof fetch;

    const { service } = makeService();
    await expect(service.importBoard('tok', 'B=', 'ws-1')).rejects.toThrow(
      /did not respond in time/i,
    );
  });

  it('still reports a transport failure as an unreachable API', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new TypeError('fetch failed'),
      ) as unknown as typeof fetch;

    const { service } = makeService();
    await expect(service.importBoard('tok', 'B=', 'ws-1')).rejects.toThrow(
      /could not reach the miro api/i,
    );
  });

  it('never includes the token in the result', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: [] })) as unknown as typeof fetch;
    const { service } = makeService();
    const result = await service.importBoard('SECRET-TOKEN', 'B=', 'ws-1');
    expect(JSON.stringify(result)).not.toContain('SECRET-TOKEN');
  });
});

describe('MiroService image re-hosting', () => {
  afterEach(() => jest.restoreAllMocks());

  function imagePage(imageUrl: string) {
    return {
      data: [{ id: 'img1', type: 'image', data: { imageUrl } }],
    };
  }

  it('downloads image bytes with the token and rewrites the URL to a workspace-scoped one', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          imagePage(
            'https://api.miro.com/v2/boards/B/resources/r1?format=preview',
          ),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // connectors
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) =>
            h.toLowerCase() === 'content-type' ? 'image/png' : null,
        },
        arrayBuffer: async () => bytes,
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    imageService.upload.mockResolvedValue({ id: 'new-id', url: '/images/x' });

    const result = await service.importBoard('tok', 'B=', 'ws-1');

    // Downloaded with auth, asking for the original bytes.
    const downloadCall = fetchMock.mock.calls[2];
    expect(String(downloadCall[0])).toContain('format=original');
    expect((downloadCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok',
    });

    // Uploaded as a Buffer under the workspace prefix.
    expect(imageService.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png',
      expect.any(String),
      'ws-1',
    );

    expect(result.items[0].data).toMatchObject({
      imageUrl: '/api/v1/workspaces/ws-1/images/new-id',
    });
  });

  /** A download response with only the pieces `rehostImages` reads. */
  function downloadResponse(opts: {
    contentType?: string;
    contentLength?: string;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    body?: unknown;
  }) {
    const headers: Record<string, string | undefined> = {
      'content-type': opts.contentType,
      'content-length': opts.contentLength,
    };
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
      body: opts.body,
      arrayBuffer:
        opts.arrayBuffer ??
        (async () => {
          throw new Error('arrayBuffer() should not have been called');
        }),
    } as unknown as Response;
  }

  it('accepts a mixed-case content-type and reads the body as a stream', async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          imagePage('https://api.miro.com/v2/boards/B/resources/r1'),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        downloadResponse({
          contentType: 'Image/PNG',
          body: {
            getReader: () => {
              let i = 0;
              return {
                read: async () =>
                  i < chunks.length
                    ? { done: false, value: chunks[i++] }
                    : { done: true },
                cancel: async () => {},
              };
            },
          },
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    imageService.upload.mockResolvedValue({ id: 'new-id', url: '/images/x' });

    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(imageService.upload).toHaveBeenCalledWith(
      Buffer.from([1, 2, 3]),
      'image/png',
      expect.any(String),
      'ws-1',
    );
    expect(result.items[0].data).toMatchObject({
      imageUrl: '/api/v1/workspaces/ws-1/images/new-id',
    });
    expect(result.notes).toEqual([]);
  });

  it('refuses a non-Miro image host without fetching it or leaking the token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(imagePage('https://169.254.169.254/latest/meta-data/')),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    const result = await service.importBoard('SECRET-TOKEN', 'B=', 'ws-1');

    // Only the two api.miro.com feed calls happened — the metadata endpoint was
    // never contacted, so the token was never offered to it.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain('169.254.169.254');
      expect(new URL(String(url)).hostname).toBe('api.miro.com');
    }
    expect(imageService.upload).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(0);
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'image-failed', count: 1 }),
    );
  });

  it('refuses a plaintext http image URL even on a Miro host', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(imagePage('http://api.miro.com/v2/boards/B/resources/r1')),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url).startsWith('https://')).toBe(true);
    }
    expect(imageService.upload).not.toHaveBeenCalled();
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'image-failed', count: 1 }),
    );
  });

  it('refuses a download whose content-length exceeds the cap', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          imagePage('https://api.miro.com/v2/boards/B/resources/r1'),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        downloadResponse({
          contentType: 'image/png',
          contentLength: String(11 * 1024 * 1024),
          // Deliberately cheap to read: the declared length alone must be
          // enough to refuse, so this must never be consumed.
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(imageService.upload).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(0);
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'image-failed', count: 1 }),
    );
  });

  it('refuses a body that streams past the cap even without a content-length', async () => {
    // A lying (absent) content-length must not buy an unbounded read.
    const chunk = new Uint8Array(4 * 1024 * 1024);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          imagePage('https://api.miro.com/v2/boards/B/resources/r1'),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        downloadResponse({
          contentType: 'image/png',
          body: {
            async *[Symbol.asyncIterator]() {
              for (let i = 0; i < 5; i++) yield chunk;
            },
          },
          // A tiny buffer here: if the body is ever slurped via arrayBuffer()
          // instead of read in chunks, the upload would wrongly succeed.
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(imageService.upload).not.toHaveBeenCalled();
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'image-failed', count: 1 }),
    );
  });

  it('counts an image whose download times out as a failure, not an import error', async () => {
    // The download carries a deadline as well as the size-cap controller. A
    // deadline abort must degrade exactly like any other broken asset.
    const timeout = Object.assign(new Error('The operation was aborted'), {
      name: 'TimeoutError',
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          imagePage('https://api.miro.com/v2/boards/B/resources/r1'),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockRejectedValueOnce(timeout);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(imageService.upload).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(0);
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'image-failed', count: 1 }),
    );
    // The download got a signal of its own — the size cap alone is not a clock.
    expect((fetchMock.mock.calls[2][1] as RequestInit).signal).toBeDefined();
  });

  /** A feed of `count` image items, all on an allowlisted host. */
  function imagesPage(count: number) {
    return {
      data: Array.from({ length: count }, (_, i) => ({
        id: `img${i}`,
        type: 'image',
        data: { imageUrl: `https://api.miro.com/v2/boards/B/resources/r${i}` },
      })),
    };
  }

  /** Route the two feed calls, and answer every other call with `download`. */
  function routeFetch(items: unknown, download: () => Response) {
    return jest.fn().mockImplementation((url: unknown) => {
      const target = String(url);
      if (target.includes('/items'))
        return Promise.resolve(jsonResponse(items));
      if (target.includes('/connectors')) {
        return Promise.resolve(jsonResponse({ data: [] }));
      }
      return Promise.resolve(download());
    });
  }

  it('stops re-hosting at the image-count ceiling and reports the remainder', async () => {
    const extra = 3;
    const total = MiroService.MAX_REHOSTED_IMAGES + extra;
    const fetchMock = routeFetch(imagesPage(total), () =>
      downloadResponse({
        contentType: 'image/png',
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    imageService.upload.mockResolvedValue({ id: 'new-id', url: '/images/x' });

    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(imageService.upload).toHaveBeenCalledTimes(
      MiroService.MAX_REHOSTED_IMAGES,
    );
    expect(result.items).toHaveLength(MiroService.MAX_REHOSTED_IMAGES);
    // 2 feed calls + one download each: the skipped remainder never went out.
    expect(fetchMock).toHaveBeenCalledTimes(
      2 + MiroService.MAX_REHOSTED_IMAGES,
    );
    // Distinct from `image-failed` — nothing broke, we ran out of budget.
    expect(result.notes).toContainEqual({
      reason: 'image-budget',
      itemType: 'image',
      count: extra,
    });
    expect(result.notes.some((n) => n.reason === 'image-failed')).toBe(false);
  });

  it('stops re-hosting at the total-bytes ceiling and reports the remainder', async () => {
    const per = 8 * 1024 * 1024;
    const affordable = Math.ceil(MiroService.MAX_TOTAL_IMAGE_BYTES / per);
    const extra = 2;
    const fetchMock = routeFetch(imagesPage(affordable + extra), () =>
      downloadResponse({
        contentType: 'image/png',
        arrayBuffer: async () => new Uint8Array(per).buffer,
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    imageService.upload.mockResolvedValue({ id: 'new-id', url: '/images/x' });

    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(imageService.upload).toHaveBeenCalledTimes(affordable);
    expect(fetchMock).toHaveBeenCalledTimes(2 + affordable);
    expect(result.notes).toContainEqual({
      reason: 'image-budget',
      itemType: 'image',
      count: extra,
    });
  });

  it('drops the image and reports it when the download fails', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          imagePage('https://api.miro.com/v2/boards/B/resources/r1'),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service } = makeService();
    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(result.items).toHaveLength(0);
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'image-failed', count: 1 }),
    );
  });
});
