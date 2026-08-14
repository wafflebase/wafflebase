import { describe, expect, it } from 'vitest';
import { createBridgeClient, type FetchLike } from '../../src/client/bridge.ts';
import { API_BASE } from '../../src/base.ts';

/** Records every call and answers with a JSON body at the given status. */
function recorder(status = 200, body: unknown = { ok: true }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { calls, fetch };
}

const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body ?? 'null'));

describe('createBridgeClient — addressing', () => {
  it('defaults to the plugin\'s own mount', async () => {
    const r = recorder();
    await createBridgeClient({ fetch: r.fetch }).health();
    expect(r.calls[0].url).toBe(`${API_BASE}/health`);
  });

  it('strips one trailing slash so the path never doubles it', async () => {
    // `base: 'http://host/api/'` is what a consumer writes by hand, and
    // `http://host/api//health` is not the same route on every server.
    const r = recorder();
    await createBridgeClient({ base: 'http://host/api/', fetch: r.fetch }).health();
    expect(r.calls[0].url).toBe('http://host/api/health');
  });

  it.each([
    ['health', (c: ReturnType<typeof createBridgeClient>) => c.health(), 'GET', '/health'],
    ['tokens', (c: ReturnType<typeof createBridgeClient>) => c.tokens(), 'GET', '/tokens'],
    ['transactions', (c: ReturnType<typeof createBridgeClient>) => c.transactions(), 'GET', '/transactions'],
    ['undo', (c: ReturnType<typeof createBridgeClient>) => c.undo(), 'POST', '/undo'],
    ['redo', (c: ReturnType<typeof createBridgeClient>) => c.redo(), 'POST', '/redo'],
    ['validate', (c: ReturnType<typeof createBridgeClient>) => c.validate([]), 'POST', '/validate'],
    ['commit', (c: ReturnType<typeof createBridgeClient>) => c.commit([]), 'POST', '/commit'],
    ['previewTokens', (c: ReturnType<typeof createBridgeClient>) => c.previewTokens([]), 'POST', '/preview-tokens'],
  ])('%s hits %s %s', async (_name, run, method, path) => {
    const r = recorder();
    await run(createBridgeClient({ base: '/api', fetch: r.fetch }));
    expect(r.calls[0].url).toBe(`/api${path}`);
    expect(r.calls[0].init?.method ?? 'GET').toBe(method);
  });
});

describe('createBridgeClient — failure is data, never a throw', () => {
  it('reports an unreachable server instead of rejecting', async () => {
    // The ordinary case, not an exception: the editor outlives dev-server restarts.
    const client = createBridgeClient({
      fetch: () => Promise.reject(new Error('fetch failed')),
    });
    await expect(client.health()).resolves.toEqual({ ok: false, error: 'fetch failed' });
  });

  it('survives a rejection that is not an Error', async () => {
    const client = createBridgeClient({ fetch: () => Promise.reject('nope') });
    await expect(client.health()).resolves.toEqual({ ok: false, error: 'bridge unreachable' });
  });

  it('names the status when the answer is not JSON', async () => {
    // A dev server that is up but has no plugin installed answers HTML with a 404.
    // Measured against a live server: this is the exact path that produced it.
    const fetch: FetchLike = () => Promise.resolve(new Response('<!doctype html>', { status: 404 }));
    await expect(createBridgeClient({ fetch }).health()).resolves.toEqual({
      ok: false,
      error: 'unexpected response (404)',
    });
  });

  it('keeps a non-2xx BODY, because that is the part the editor renders', async () => {
    // `/commit` answers 409 with per-intent results. Treating a bad status as a
    // failure would discard exactly what the user needs to see.
    const r = recorder(409, {
      ok: false,
      error: '1 of 2 intents could not be applied',
      results: [{ located: true }, { located: false, reason: 'not found' }],
    });
    const out = await createBridgeClient({ fetch: r.fetch }).commit([]);
    expect(out.ok).toBe(false);
    expect(out.results).toHaveLength(2);
    expect(out.error).toContain('1 of 2');
  });
});

describe('createBridgeClient — request bodies', () => {
  it('sends dryRun alongside the intent, not nested inside it', async () => {
    const r = recorder();
    const intent = { kind: 'palette-value', file: 'p.ts', path: ['a'], tokenValue: '#fff' } as never;
    await createBridgeClient({ fetch: r.fetch }).mutate(intent, { dryRun: true });
    expect(bodyOf(r.calls[0].init)).toEqual({
      kind: 'palette-value',
      file: 'p.ts',
      path: ['a'],
      tokenValue: '#fff',
      dryRun: true,
    });
  });

  it('keeps dryRun set on the intent when no options are passed', async () => {
    // `dryRun` is part of `MutateRequest`, so this call typechecks. Overwriting it
    // with `opts?.dryRun` dropped the key from the JSON and the server defaulted to a
    // real write — a requested dry run editing the repository. Found in review.
    const r = recorder();
    const intent = { kind: 'palette-value', file: 'p.ts', path: ['a'], tokenValue: '#fff', dryRun: true } as never;
    await createBridgeClient({ fetch: r.fetch }).mutate(intent);
    expect(bodyOf(r.calls[0].init).dryRun).toBe(true);
  });

  it('lets the option override the intent', async () => {
    const r = recorder();
    const intent = { kind: 'palette-value', file: 'p.ts', path: ['a'], tokenValue: '#fff', dryRun: true } as never;
    await createBridgeClient({ fetch: r.fetch }).mutate(intent, { dryRun: false });
    expect(bodyOf(r.calls[0].init).dryRun).toBe(false);
  });

  it('wraps commit intents and carries dryRun beside them', async () => {
    const r = recorder();
    await createBridgeClient({ fetch: r.fetch }).commit([], { dryRun: true });
    expect(bodyOf(r.calls[0].init)).toEqual({ intents: [], dryRun: true });
  });

  it('sends the frame side with the plan', async () => {
    const r = recorder();
    await createBridgeClient({ fetch: r.fetch }).plan('before', []);
    expect(bodyOf(r.calls[0].init)).toEqual({ side: 'before', intents: [] });
  });

  it('does not call the server for an empty candidate list', async () => {
    // The editor calls this on every render; the bridge would answer a no-op anyway.
    const r = recorder();
    await expect(createBridgeClient({ fetch: r.fetch }).candidates([])).resolves.toEqual({
      ok: true,
      added: [],
    });
    expect(r.calls).toHaveLength(0);
  });

  it('posts a non-empty candidate list', async () => {
    const r = recorder();
    await createBridgeClient({ fetch: r.fetch }).candidates(['hover:bg-primary/70']);
    expect(bodyOf(r.calls[0].init)).toEqual({ classes: ['hover:bg-primary/70'] });
  });
});

describe('createBridgeClient — fetch resolution', () => {
  it('reads the global fetch at call time, not at construction', async () => {
    // A page whose polyfill loads late, and a test that installs a fake afterwards,
    // both depend on this. Capturing at construction would bind the wrong one.
    const client = createBridgeClient();
    const original = globalThis.fetch;
    const calls: string[] = [];
    try {
      globalThis.fetch = ((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('{"ok":true}'));
      }) as typeof globalThis.fetch;
      await client.health();
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toEqual([`${API_BASE}/health`]);
  });
});
