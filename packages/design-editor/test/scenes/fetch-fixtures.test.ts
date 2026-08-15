// @vitest-environment jsdom
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyFixtureTable,
  installFetchGuard,
  setFixtures,
} from '../../src/scenes/fetch-fixtures.ts';
import { BASE } from '../../src/base.ts';

/**
 * The guard is INSTALL-ONCE by design: it binds the real `fetch` at install time and
 * a second call only swaps the fixture table. So the passthrough spy has to be in
 * place BEFORE the single install, and must never be reassigned afterwards —
 * reassigning `window.fetch` per test replaces the guard's own wrapper with the bare
 * spy, and the re-install then returns early without re-wrapping, so no fixture
 * resolves. (That was this file's first harness, and it failed seven tests.)
 */
const real = window.fetch;
const passthrough = vi.fn(async () => new Response('real', { status: 200 }));
window.fetch = passthrough as unknown as typeof window.fetch;

let misses: { url: string; method: string }[] = [];
installFetchGuard({ fixtures: {}, onMiss: (url, method) => misses.push({ url, method }) });
const guarded = window.fetch;

beforeEach(() => {
  misses = [];
  passthrough.mockClear();
  setFixtures({});
});

describe('installFetchGuard', () => {
  it('answers a fixture as JSON with a 200', async () => {
    setFixtures({ '/api/documents': [{ id: 'a' }] });
    const res = await window.fetch('http://scene.invalid/api/documents');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    await expect(res.json()).resolves.toEqual([{ id: 'a' }]);
  });

  it('matches on pathname, so fixtures need not know the API origin', async () => {
    setFixtures({ '/api/me': { id: 1 } });
    for (const url of ['http://scene.invalid/api/me', '/api/me']) {
      await expect((await window.fetch(url)).json()).resolves.toEqual({ id: 1 });
    }
  });

  it('prefers a fixture keyed with a query string over the bare path', async () => {
    setFixtures({ '/api/docs': ['bare'], '/api/docs?folder=x': ['scoped'] });
    await expect((await window.fetch('/api/docs?folder=x')).json()).resolves.toEqual(['scoped']);
    await expect((await window.fetch('/api/docs')).json()).resolves.toEqual(['bare']);
  });

  it('falls back to the bare path when the query is not keyed', async () => {
    setFixtures({ '/api/docs': ['bare'] });
    await expect((await window.fetch('/api/docs?page=2')).json()).resolves.toEqual(['bare']);
  });

  it('clones a Response fixture, so an odd-status test is reusable', async () => {
    setFixtures({ '/api/gone': new Response('nope', { status: 404 }) });
    const a = await window.fetch('/api/gone');
    const b = await window.fetch('/api/gone');
    expect([a.status, b.status]).toEqual([404, 404]);
    await expect(a.text()).resolves.toBe('nope');
    await expect(b.text()).resolves.toBe('nope');
  });

  it('lets Vite’s own dev traffic through untouched', async () => {
    // Or the frame cannot hot-update itself.
    for (const url of ['/@vite/client', '/@fs/x/y.tsx', '/node_modules/.vite/deps/react.js']) {
      await window.fetch(url);
    }
    expect(passthrough).toHaveBeenCalledTimes(3);
    expect(misses).toEqual([]);
  });

  it('lets the editor’s own mount through, derived from BASE', async () => {
    // The prototype hardcoded `/__design-sdk/`, a namespace the shipped plugin does
    // not serve — so every request to the editor's own routes fell through to the
    // miss path and THREW instead of passing through.
    await window.fetch(`${BASE}/api/health`);
    expect(passthrough).toHaveBeenCalledTimes(1);
    expect(misses).toEqual([]);
    expect(BASE).not.toContain('design-sdk');
  });

  it('lets Vite’s HMR ping through, which is not a module request', async () => {
    // `waitForSuccessfulPing` fetches this whenever the HMR socket drops — every dev
    // server restart. It matches none of the prefixes, so it hit the miss path and
    // fired `onMiss`, whose contract is a hard `wb:error kind:'fetch'` naming the URL.
    // Vite swallows the throw and HMR recovers, which is what kept it quiet: the
    // designer just gets told their scene made an unmocked request.
    for (const url of ['/__vite_ping', '/__open-in-editor?file=x']) {
      await window.fetch(url);
    }
    expect(passthrough).toHaveBeenCalledTimes(2);
    expect(misses).toEqual([]);
  });

  it('does not answer a mutation with the collection’s GET fixture', async () => {
    // Keyed on path alone, `POST /api/documents` resolved to the LIST fixture with a
    // 200, so the product's success branch ran against a body of entirely the wrong
    // shape and the designer watched a create "succeed".
    setFixtures({ '/api/documents': [{ id: 'a' }] });
    await expect(window.fetch('/api/documents', { method: 'POST' })).rejects.toThrow(
      /unmocked request: POST \/api\/documents/,
    );
    // The read on the same path is unaffected.
    await expect((await window.fetch('/api/documents')).json()).resolves.toEqual([{ id: 'a' }]);
  });

  it('answers a mutation from a method-keyed fixture', async () => {
    setFixtures({ '/api/documents': [{ id: 'a' }], 'POST /api/documents': { id: 'new' } });
    await expect((await window.fetch('/api/documents', { method: 'post' })).json()).resolves.toEqual(
      { id: 'new' },
    );
  });

  it('keeps a null fixture body distinguishable from no fixture', async () => {
    // The lookup uses `in`, not `??`: `null` is a legitimate response body, and
    // reading it as absent would throw on a fixture the scene deliberately set.
    setFixtures({ '/api/nothing': null });
    await expect((await window.fetch('/api/nothing')).json()).resolves.toBeNull();
    expect(misses).toEqual([]);
  });

  it('throws loudly on a miss, naming the URL and the method', async () => {
    // A quiet passthrough fails as a 401, and an auth wrapper answers a 401 by
    // assigning `window.location.href` — which navigates the FRAME off the scene
    // document. That is indistinguishable from a broken scene.
    await expect(window.fetch('/api/unmocked', { method: 'POST' })).rejects.toThrow(
      /unmocked request: POST \/api\/unmocked/,
    );
    expect(misses).toEqual([{ url: '/api/unmocked', method: 'POST' }]);
    expect(passthrough).not.toHaveBeenCalled();
  });

  it('reads the method off a Request when init omits it', async () => {
    await expect(
      window.fetch(new Request('http://scene.invalid/api/x', { method: 'DELETE' })),
    ).rejects.toThrow();
    expect(misses).toEqual([{ url: '/api/x', method: 'DELETE' }]);
  });

  it('is idempotent, so a fast refresh does not stack a wrapper', async () => {
    // Wrapping a wrapper would stack a new guard on every keystroke.
    installFetchGuard({ fixtures: { '/api/x': 1 }, onMiss: () => {} });
    expect(window.fetch).toBe(guarded);
    // The second call still swaps the table, which is how a scene switch works.
    await expect((await window.fetch('/api/x')).json()).resolves.toBe(1);
  });
});

describe('emptyFixtureTable', () => {
  it('empties every array reachable from a fixture, recursively', () => {
    // The Mock Data toggle. Generic rather than a hand-maintained `*/empty` variant
    // per scene, because a fixture already IS a plain JSON value.
    expect(
      emptyFixtureTable({
        '/a': [1, 2, 3],
        '/b': { items: [{ id: 1 }], meta: { tags: ['x'], total: 3 } },
      }),
    ).toEqual({ '/a': [], '/b': { items: [], meta: { tags: [], total: 3 } } });
  });

  it('leaves a Response fixture alone', () => {
    // There is no "empty" reading of a 404.
    const res = new Response('x', { status: 404 });
    expect(emptyFixtureTable({ '/a': res })['/a']).toBe(res);
  });

  it('leaves scalars and null alone', () => {
    expect(emptyFixtureTable({ '/a': 1, '/b': null, '/c': 'x' })).toEqual({
      '/a': 1,
      '/b': null,
      '/c': 'x',
    });
  });
});

// Restore, so a later file in the same worker gets a real `fetch`.
afterAll(() => {
  window.fetch = real;
});
