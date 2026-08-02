import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithAuth = vi.fn();
vi.mock('@/api/auth', () => ({ fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a) }));

import { HttpError } from './http-error';
import { importMiroBoard, MiroImportStreamError, type MiroImportProgress } from './miro';

const encoder = new TextEncoder();

/**
 * A streamed 200, delivered as the caller-chosen byte chunks.
 *
 * Chunk boundaries are supplied explicitly because they are the interesting
 * variable — a real transport splits wherever it likes, including mid-line.
 */
function streamed(chunks: (string | Uint8Array)[]) {
  const queue = chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c));
  let i = 0;
  let cancelled = false;
  const reader = {
    read: async () =>
      i < queue.length ? { done: false, value: queue[i++] } : { done: true, value: undefined },
    cancel: async () => {
      cancelled = true;
    },
  };
  return {
    res: {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      body: { getReader: () => reader },
    },
    wasCancelled: () => cancelled,
  };
}

/** The whole NDJSON body as one string, for the common case. */
function ndjson(...events: unknown[]) {
  return events.map((e) => `${JSON.stringify(e)}\n`).join('');
}

const RESULT = { type: 'result', items: [{ id: 'a' }], connectors: [], notes: [] };

describe('importMiroBoard', () => {
  beforeEach(() => fetchWithAuth.mockReset());

  it('posts the token and board url to the workspace-scoped endpoint', async () => {
    fetchWithAuth.mockResolvedValue(streamed([ndjson(RESULT)]).res);

    await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'https://miro.com/app/board/B=/' });

    const [url, init] = fetchWithAuth.mock.calls[0];
    expect(String(url)).toContain('/workspaces/ws-1/miro/import');
    expect((init as RequestInit).method).toBe('POST');
    // Still exactly one request, with the token in the BODY — the whole reason
    // progress is streamed instead of polled.
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      token: 'tok',
      boardUrl: 'https://miro.com/app/board/B=/',
    });
  });

  it('resolves with the terminal result, minus the envelope tag', async () => {
    fetchWithAuth.mockResolvedValue(
      streamed([ndjson({ type: 'progress', stage: 'items', done: 50 }, RESULT)]).res,
    );

    const result = await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'B=' });

    // The shape `mapMiroItems` consumes is unchanged by the streaming rework.
    expect(result).toEqual({ items: [{ id: 'a' }], connectors: [], notes: [] });
    expect(result).not.toHaveProperty('type');
  });

  it('invokes onProgress once per progress line, in order, and not for the result', async () => {
    fetchWithAuth.mockResolvedValue(
      streamed([
        ndjson(
          { type: 'progress', stage: 'items', done: 50 },
          { type: 'progress', stage: 'items', done: 1250 },
          { type: 'progress', stage: 'connectors', done: 40 },
          { type: 'progress', stage: 'images', done: 0, total: 12 },
          { type: 'progress', stage: 'images', done: 3, total: 12 },
          RESULT,
        ),
      ]).res,
    );

    const seen: MiroImportProgress[] = [];
    await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'B=' }, (p) => seen.push(p));

    expect(seen).toEqual([
      { stage: 'items', done: 50, total: undefined },
      { stage: 'items', done: 1250, total: undefined },
      { stage: 'connectors', done: 40, total: undefined },
      { stage: 'images', done: 0, total: 12 },
      { stage: 'images', done: 3, total: 12 },
    ]);
  });

  it('reports progress AS IT ARRIVES rather than after the body is drained', async () => {
    // The failure this guards: buffering the whole stream and then replaying
    // the callbacks. Every tick would fire at once, at the very end, and the
    // dialog would sit on "Reading board…" for the entire import — the exact
    // bug the streaming was added to fix.
    const seenBeforeLastChunk: MiroImportProgress[] = [];
    let reads = 0;
    const chunks = [
      `${JSON.stringify({ type: 'progress', stage: 'items', done: 50 })}\n`,
      `${JSON.stringify({ type: 'progress', stage: 'images', done: 1, total: 2 })}\n`,
      ndjson(RESULT),
    ].map((c) => encoder.encode(c));

    const seen: MiroImportProgress[] = [];
    fetchWithAuth.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      body: {
        getReader: () => ({
          read: async () => {
            // Snapshot what the caller had been told BEFORE the final chunk
            // is handed over.
            if (reads === chunks.length - 1) seenBeforeLastChunk.push(...seen);
            return reads < chunks.length
              ? { done: false, value: chunks[reads++] }
              : { done: true, value: undefined };
          },
        }),
      },
    });

    await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'B=' }, (p) => seen.push(p));

    expect(seenBeforeLastChunk).toHaveLength(2);
    expect(seen).toHaveLength(2);
  });

  it('reassembles a line split across chunk boundaries', async () => {
    const body = ndjson({ type: 'progress', stage: 'items', done: 7 }, RESULT);
    const bytes = encoder.encode(body);
    fetchWithAuth.mockResolvedValue(
      streamed([bytes.subarray(0, 13), bytes.subarray(13, 60), bytes.subarray(60)]).res,
    );

    const seen: MiroImportProgress[] = [];
    const result = await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'B=' }, (p) =>
      seen.push(p),
    );

    expect(seen).toEqual([{ stage: 'items', done: 7, total: undefined }]);
    expect(result.items).toEqual([{ id: 'a' }]);
  });

  it('accepts a terminal result with no trailing newline', async () => {
    fetchWithAuth.mockResolvedValue(
      streamed([
        `${JSON.stringify({ type: 'progress', stage: 'items', done: 1 })}\n`,
        JSON.stringify(RESULT),
      ]).res,
    );

    const result = await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'B=' });
    expect(result.items).toEqual([{ id: 'a' }]);
  });

  it('rejects on an in-band error line, exactly like a thrown request failure', async () => {
    // The response is already a 200 by the time this arrives, so `assertOk`
    // cannot see it. It must still reject, or the dialog would close on a
    // failed import and navigate to an empty board.
    const stream = streamed([
      ndjson(
        { type: 'progress', stage: 'items', done: 50 },
        { type: 'error', message: 'Miro rate limit reached — try again in a minute' },
      ),
    ]);
    fetchWithAuth.mockResolvedValue(stream.res);

    const seen: MiroImportProgress[] = [];
    const err = await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'B=' }, (p) =>
      seen.push(p),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MiroImportStreamError);
    expect((err as Error).message).toMatch(/rate limit/i);
    // Progress delivered before the failure still counts; the caller is not
    // left thinking nothing happened.
    expect(seen).toHaveLength(1);
    // The socket is handed back rather than left draining.
    expect(stream.wasCancelled()).toBe(true);
  });

  it('rejects when the stream ends without a result line', async () => {
    // A dropped socket / proxy timeout mid-import. Resolving with nothing
    // would create an empty board and report it as a success.
    fetchWithAuth.mockResolvedValue(
      streamed([ndjson({ type: 'progress', stage: 'items', done: 50 })]).res,
    );

    await expect(
      importMiroBoard('ws-1', { token: 'tok', boardUrl: 'B=' }),
    ).rejects.toThrow(/ended before it finished/i);
  });

  it('ignores an unparseable line rather than failing a good import', async () => {
    fetchWithAuth.mockResolvedValue(streamed([`not json\n${ndjson(RESULT)}`]).res);

    const result = await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'B=' });
    expect(result.items).toEqual([{ id: 'a' }]);
  });

  it('falls back to reading the whole body when the response has no stream', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      text: async () => ndjson({ type: 'progress', stage: 'items', done: 3 }, RESULT),
    });

    const seen: MiroImportProgress[] = [];
    const result = await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'B=' }, (p) =>
      seen.push(p),
    );

    expect(result.items).toEqual([{ id: 'a' }]);
    expect(seen).toHaveLength(1);
  });

  it('throws with the server message on a PRE-stream failure', async () => {
    // Nothing has been written yet at this point, so the server can still pick
    // a status — and this path must keep going through `assertOk`.
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
