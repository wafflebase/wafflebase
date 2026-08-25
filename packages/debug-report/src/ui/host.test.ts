import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDevHost,
  DRAFT_ENDPOINT,
  REPORT_ENDPOINT,
} from './host';
import type { Bundle } from '../index';

/**
 * The dev `HostAdapter`.
 *
 * Everything here is about the WIRE: what is posted, and what each answer is
 * turned into. The panel renders an outcome for every branch below, and getting
 * one wrong means the reporter is told the wrong thing about reports they can no
 * longer see — which is why this file exists rather than being covered by the
 * panel's tests alone.
 */

const bundle = { schema: 1, sessionId: 'wb-1', items: [] } as unknown as Bundle;

/** One `fetch` answer, without a network. */
const answering = (
  status: number,
  body: unknown,
  opts: { delayMs?: number } = {},
) =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const settle = () =>
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
          } as Response);
        if (opts.delayMs === undefined) return settle();
        const timer = setTimeout(settle, opts.delayMs);
        // A real `fetch` rejects with an AbortError when the signal fires; the
        // timeout branch is only reachable if this stub does the same.
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }),
  );

const host = () => createDevHost({ route: () => '/s/:id' });

beforeEach(() => {
  document.documentElement.dataset.theme = 'light';
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
});

describe('createDevHost · send', () => {
  it('posts the bundle and the captures to the report endpoint as JSON', async () => {
    const fetchMock = answering(200, { ref: '.wb-reports/wb-1/bundle.json' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await host().send(bundle, [{ id: 'c1', dataUrl: 'data:image/png;base64,AA' }]);

    expect(result).toEqual({ ok: true, ref: '.wb-reports/wb-1/bundle.json' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(REPORT_ENDPOINT);
    // `application/json` is half the CSRF guard on the endpoint: it forces a
    // preflight a cross-origin page will not be granted.
    expect((init.headers as Record<string, string>)['Content-Type']).toMatch(/application\/json/);
    expect(JSON.parse(String(init.body))).toEqual({
      bundle,
      captures: [{ id: 'c1', dataUrl: 'data:image/png;base64,AA' }],
    });
  });

  it('refuses a 200 that does not say where it wrote', async () => {
    // A success with no `ref` would clear the session and leave nothing to point
    // an agent at — worse than a failure, because the reports are gone.
    vi.stubGlobal('fetch', answering(200, { captures: [] }));
    const result = await host().send(bundle, []);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/did not say where/);
  });

  it('reports a refused capture as a failed send, not a partial one', async () => {
    vi.stubGlobal('fetch', answering(200, { ref: 'r', refused: ['c1'] }));
    const result = await host().send(bundle, []);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/refused 1 capture/);
  });

  it('carries the server’s error and detail into the failure', async () => {
    vi.stubGlobal(
      'fetch',
      answering(400, { error: 'the bundle is not valid', detail: 'bundle.items: expected an array' }),
    );
    const result = await host().send(bundle, []);
    expect(result).toMatchObject({
      ok: false,
      error: 'the bundle is not valid: bundle.items: expected an array',
    });
  });

  it('falls back to the status when the body carries no message', async () => {
    vi.stubGlobal('fetch', answering(503, 'not json at all'));
    const result = await host().send(bundle, []);
    expect(result).toMatchObject({ ok: false, error: 'HTTP 503' });
  });

  it('gives up rather than leaving the panel on “Sending…” forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', answering(200, { ref: 'r' }, { delayMs: 10 * 60_000 }));

    const pending = host().send(bundle, []);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const result = await pending;

    expect(result).toMatchObject({ ok: false });
    // The message must name the timeout: "failed" alone would read as a
    // rejected bundle, and the reporter would edit rather than retry.
    if (!result.ok) expect(result.error).toMatch(/no answer within/);
  });

  it('turns a transport failure into a typed outcome, not an exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const result = await host().send(bundle, []);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/ECONNREFUSED/);
  });
});

describe('createDevHost · draft', () => {
  it('posts the items and the environment, and returns the answer RAW', async () => {
    const raw = { drafts: [{ itemId: 'i1' }], proposedGroups: [] };
    const fetchMock = answering(200, raw);
    vi.stubGlobal('fetch', fetchMock);

    const items = [{ id: 'i1', note: 'cramped' }] as never;
    const answer = await host().draft(items);

    // RAW, not parsed: `parseDraftResult` is the only thing allowed to interpret
    // a model's answer, and a host that pre-shaped it would hide a malformed one.
    expect(answer).toEqual(raw);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DRAFT_ENDPOINT);
    const body = JSON.parse(String(init.body));
    expect(body.bundle.items).toEqual(items);
    expect(body.bundle.env).toMatchObject({ route: '/s/:id', theme: 'light' });
  });

  it('throws so the panel can render “drafting unavailable”', async () => {
    // Returned rather than thrown, this became a draft the reporter could not
    // tell apart from an empty one.
    vi.stubGlobal('fetch', answering(503, { error: 'not-configured', detail: 'no key' }));
    await expect(host().draft([] as never)).rejects.toThrow(/not-configured/);
  });
});

describe('createDevHost · environment', () => {
  it('reports an absent build SHA as absent rather than guessing', () => {
    expect(host().buildSha()).toBeUndefined();
    expect(host().environment().buildSha).toBeUndefined();
  });

  it('reads the theme that was actually painted', () => {
    document.documentElement.dataset.theme = 'dark';
    expect(host().theme()).toBe('dark');
  });

  it('takes the route from the mount, which is the only thing that knows it', () => {
    expect(createDevHost({ route: () => '/d/:id' }).route()).toBe('/d/:id');
  });
});

describe('createDevHost · locate', () => {
  it('cannot name a canvas point without a host locator', async () => {
    await expect(host().locate({ x: 1, y: 1 })).resolves.toBeUndefined();
  });

  it('answers with whatever the host locator says', async () => {
    const target = {
      kind: 'canvas' as const,
      surface: 'sheet',
      address: 'Sheet1!C7',
      rect: { x: 0, y: 0, w: 80, h: 21 },
    };
    const adapter = createDevHost({ route: () => '/s/:id', locateOnCanvas: () => target });
    await expect(adapter.locate({ x: 1, y: 1 })).resolves.toEqual(target);
  });
});
