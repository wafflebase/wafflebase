import { describe, expect, it, vi } from 'vitest';
import {
  createBlobBackend,
  createStore,
  dataUrlBytes,
  localStorageMeta,
  memoryBlobs,
  memoryMeta,
  STORE_SCHEMA,
  type BlobBackend,
  type CaptureStore,
} from './store';
import type { Capture, DebugItem } from './types';

const jpeg = (bytes: number) =>
  // base64 of length n decodes to ~3n/4 bytes; pad up so the payload is exact.
  `data:image/jpeg;base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`;

function item(id: string, capture?: Capture): DebugItem {
  return {
    id,
    createdAt: 1,
    note: `note for ${id}`,
    target: { kind: 'viewport', rect: { x: 0, y: 0, w: 10, h: 10 } },
    ...(capture ? { capture } : {}),
    disposition: 'verify',
    agentCandidate: false,
  };
}

function store(
  overrides: { blobs?: BlobBackend; budgetBytes?: number } = {},
): { store: CaptureStore; blobs: BlobBackend; meta: ReturnType<typeof memoryMeta> } {
  const blobs = overrides.blobs ?? memoryBlobs();
  const meta = memoryMeta();
  let id = 0;
  let clock = 0;
  return {
    store: createStore({
      blobs,
      meta,
      ...(overrides.budgetBytes !== undefined
        ? { budgetBytes: overrides.budgetBytes }
        : {}),
      newId: () => `cap${(id += 1)}`,
      now: () => (clock += 1),
    }),
    blobs,
    meta,
  };
}

describe('dataUrlBytes', () => {
  it('measures the decoded payload of a base64 data URL, not its text length', () => {
    const bytes = dataUrlBytes(jpeg(3_000));
    expect(bytes).toBeGreaterThan(2_900);
    expect(bytes).toBeLessThan(3_100);
  });

  it('accounts for base64 padding', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/jpeg;base64,AA==')).toBe(1);
  });

  it('falls back to payload length for a non-base64 URL', () => {
    expect(dataUrlBytes('data:text/plain,hello')).toBe(5);
  });
});

describe('store', () => {
  it('stores a capture and reads it back', async () => {
    const { store: s } = store();
    const result = await s.putCapture({ dataUrl: jpeg(100), w: 340, h: 220, layers: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.layers).toBe(2);
    expect(result.capture.mime).toBe('image/jpeg');
    expect(await s.getCapture(result.capture.id)).toBe(jpeg(100));
  });

  it('round-trips metadata through save and load', async () => {
    const { store: s } = store();
    const put = await s.putCapture({ dataUrl: jpeg(100), w: 10, h: 10, layers: 1 });
    if (!put.ok) throw new Error('capture should have been stored');
    const items = [item('a', put.capture), item('b')];
    expect(s.save('session-1', items).persisted).toBe(true);

    const loaded = await s.load();
    expect(loaded?.sessionId).toBe('session-1');
    expect(loaded?.items).toEqual(items);
    expect(loaded?.droppedCaptures).toEqual([]);
  });

  it('returns undefined when nothing was ever saved', async () => {
    expect(await store().store.load()).toBeUndefined();
  });

  describe('the budget guard', () => {
    it('evicts the oldest capture first and names what it dropped', async () => {
      const { store: s } = store({ budgetBytes: 1_000 });
      const first = await s.putCapture({ dataUrl: jpeg(400), w: 1, h: 1, layers: 1 });
      const second = await s.putCapture({ dataUrl: jpeg(400), w: 1, h: 1, layers: 1 });
      if (!first.ok || !second.ok) throw new Error('setup failed');

      const third = await s.putCapture({ dataUrl: jpeg(400), w: 1, h: 1, layers: 1 });
      expect(third.ok).toBe(true);
      if (!third.ok) return;
      expect(third.evicted).toEqual([first.capture.id]);
      expect(await s.getCapture(first.capture.id)).toBeUndefined();
      expect(await s.getCapture(second.capture.id)).toBeDefined();
    });

    it('refuses a capture larger than the whole budget instead of clearing house', async () => {
      const { store: s } = store({ budgetBytes: 1_000 });
      const kept = await s.putCapture({ dataUrl: jpeg(400), w: 1, h: 1, layers: 1 });
      if (!kept.ok) throw new Error('setup failed');

      const huge = await s.putCapture({ dataUrl: jpeg(5_000), w: 1, h: 1, layers: 1 });
      expect(huge.ok).toBe(false);
      if (huge.ok) return;
      expect(huge.reason).toBe('too-large');
      // Trading many reports for one would be the wrong bargain.
      expect(huge.evicted).toEqual([]);
      expect(await s.getCapture(kept.capture.id)).toBeDefined();
    });

    it('reports evictions that happened before a failed write', async () => {
      const blobs = memoryBlobs();
      const { store: s } = store({ blobs, budgetBytes: 1_000 });
      const first = await s.putCapture({ dataUrl: jpeg(900), w: 1, h: 1, layers: 1 });
      if (!first.ok) throw new Error('setup failed');
      vi.spyOn(blobs, 'put').mockRejectedValueOnce(new Error('quota'));

      const second = await s.putCapture({ dataUrl: jpeg(900), w: 1, h: 1, layers: 1 });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.reason).toBe('write-failed');
      // Those captures are gone whether or not the new one arrived, so the
      // panel has to be told either way.
      expect(second.evicted).toEqual([first.capture.id]);
    });
  });

  describe('reconciliation on load', () => {
    it('keeps an item whose capture is gone, and names it', async () => {
      const { store: s, blobs } = store();
      const put = await s.putCapture({ dataUrl: jpeg(100), w: 10, h: 10, layers: 1 });
      if (!put.ok) throw new Error('setup failed');
      s.save('session-1', [item('a', put.capture), item('b')]);
      await blobs.delete([put.capture.id]);

      const loaded = await s.load();
      // The sentence is what carries the report; the pixels are an aid.
      expect(loaded?.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(loaded?.items[0].capture).toBeUndefined();
      expect(loaded?.droppedCaptures).toEqual(['a']);
    });

    it('keeps the sentences when the blob store is unreachable', async () => {
      const blobs = memoryBlobs();
      const { store: s } = store({ blobs });
      const put = await s.putCapture({ dataUrl: jpeg(100), w: 1, h: 1, layers: 1 });
      if (!put.ok) throw new Error('setup failed');
      s.save('session-1', [item('a', put.capture)]);
      vi.spyOn(blobs, 'stats').mockRejectedValueOnce(new Error('blocked'));

      const loaded = await s.load();
      expect(loaded?.items).toHaveLength(1);
      expect(loaded?.droppedCaptures).toEqual(['a']);
    });

    it('discards metadata from an unrecognised schema rather than re-reading it', async () => {
      const { store: s, meta } = store();
      meta.write(JSON.stringify({ schema: STORE_SCHEMA + 1, items: [] }));
      expect(await s.load()).toBeUndefined();
      expect(meta.read()).toBeNull();
    });

    it('discards metadata that is not JSON', async () => {
      const { store: s, meta } = store();
      meta.write('{ truncated');
      expect(await s.load()).toBeUndefined();
      expect(meta.read()).toBeNull();
    });
  });

  it('reports a metadata write that did not survive', () => {
    const blobs = memoryBlobs();
    const refusing = { read: () => null, write: () => {}, clear: () => {} };
    const s = createStore({ blobs, meta: refusing });
    // A browser blocking site data must not be reported as a persisted
    // session: the reporter would lose the batch on reload believing it saved.
    expect(s.save('session-1', [item('a')]).persisted).toBe(false);
  });

  it('reports a write refused AFTER an earlier one succeeded', () => {
    // THE STALE CASE, and the common one: quota is reached exactly as the item
    // list grows, so by the time a write is refused the key already holds an
    // older payload. `read() !== null` was true then, so `save` claimed the
    // session would survive a reload and the reporter got the earlier list
    // back. The read-back has to be compared to the value, not to null.
    const blobs = memoryBlobs();
    let stored: string | null = null;
    let accept = true;
    const meta = {
      read: () => stored,
      write: (v: string) => {
        if (accept) stored = v;
      },
      clear: () => {
        stored = null;
      },
    };
    const s = createStore({ blobs, meta });

    expect(s.save('session-1', [item('a')]).persisted).toBe(true);
    accept = false;
    expect(s.save('session-1', [item('a'), item('b')]).persisted).toBe(false);
    // The old payload is still there — which is why presence proves nothing.
    expect(meta.read()).not.toBeNull();
  });

  it('refuses to overwrite another tab\'s reports', () => {
    // ONE FIXED KEY, so two tabs share it, and `save` replaces the whole
    // payload — the second writer silently destroyed the first tab's reports.
    const blobs = memoryBlobs();
    let stored: string | null = null;
    const meta = {
      read: () => stored,
      write: (v: string) => {
        stored = v;
      },
      clear: () => {
        stored = null;
      },
    };
    // Tab A saves.
    createStore({ blobs, meta }).save('tab-a', [item('a')]);
    // Tab B is a different store instance that never loaded this payload.
    const b = createStore({ blobs, meta });
    const result = b.save('tab-b', [item('b')]);
    expect(result.persisted).toBe(false);
    expect(result.foreign).toEqual({ sessionId: 'tab-a', items: 1 });
    // A's reports are still there.
    expect(JSON.parse(stored!).sessionId).toBe('tab-a');
  });

  it('may replace a payload it restored across a reload', async () => {
    // The refusal must not break the reload case: a new page has a new session
    // id, and the payload it just restored is its own to replace.
    const blobs = memoryBlobs();
    let stored: string | null = null;
    const meta = {
      read: () => stored,
      write: (v: string) => {
        stored = v;
      },
      clear: () => {
        stored = null;
      },
    };
    createStore({ blobs, meta }).save('before-reload', [item('a')]);
    const after = createStore({ blobs, meta });
    await after.load();
    expect(after.save('after-reload', [item('a'), item('b')]).persisted).toBe(true);
  });

  it('refuses a payload whose items are not items', async () => {
    // `items: [null]` passed the array check and then threw on `item.capture`
    // inside `load()`. That rejected the promise the rehydrate hook awaits, and
    // a rejected rehydrate wedged every later save.
    const blobs = memoryBlobs();
    let stored: string | null = JSON.stringify({
      schema: 1,
      sessionId: 's',
      savedAt: 1,
      items: [null],
    });
    const meta = {
      read: () => stored,
      write: (v: string) => {
        stored = v;
      },
      clear: () => {
        stored = null;
      },
    };
    const s = createStore({ blobs, meta });
    await expect(s.load()).resolves.toBeUndefined();
    // Refused AND cleared, so it is not re-read and re-refused on every load.
    expect(stored).toBeNull();
  });

  it('sweeps blobs no persisted item references', async () => {
    const { store: s } = store();
    const kept = await s.putCapture({ dataUrl: jpeg(100), w: 1, h: 1, layers: 1 });
    const orphan = await s.putCapture({ dataUrl: jpeg(100), w: 1, h: 1, layers: 1 });
    if (!kept.ok || !orphan.ok) throw new Error('setup failed');
    s.save('session-1', [item('a', kept.capture)]);

    expect(await s.sweep()).toEqual([orphan.capture.id]);
    expect(await s.getCapture(kept.capture.id)).toBeDefined();
    expect(await s.getCapture(orphan.capture.id)).toBeUndefined();
  });

  it('clears metadata and every blob after a handover', async () => {
    const { store: s, meta, blobs } = store();
    const put = await s.putCapture({ dataUrl: jpeg(100), w: 1, h: 1, layers: 1 });
    if (!put.ok) throw new Error('setup failed');
    s.save('session-1', [item('a', put.capture)]);

    await s.clear();
    expect(meta.read()).toBeNull();
    expect(await blobs.stats()).toEqual([]);
  });

  it('survives a blob store that throws while clearing', async () => {
    const blobs = memoryBlobs();
    const { store: s, meta } = store({ blobs });
    s.save('session-1', [item('a')]);
    vi.spyOn(blobs, 'stats').mockRejectedValueOnce(new Error('blocked'));
    await expect(s.clear()).resolves.toBeUndefined();
    expect(meta.read()).toBeNull();
  });
});

describe('localStorageMeta', () => {
  it('reads back what it writes', () => {
    const meta = localStorageMeta('wb.test.meta');
    meta.write('value');
    expect(meta.read()).toBe('value');
    meta.clear();
    expect(meta.read()).toBeNull();
  });

  it('degrades to null when storage throws on access', () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('site data blocked');
      },
    });
    try {
      const meta = localStorageMeta('wb.test.meta');
      // A blocked profile loses persistence, not the app.
      expect(() => meta.write('value')).not.toThrow();
      expect(meta.read()).toBeNull();
      expect(() => meta.clear()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
        writable: true,
      });
    }
  });
});

describe('createBlobBackend', () => {
  it('falls back to memory, and says so, when IndexedDB is absent', async () => {
    // jsdom has no IndexedDB, which is also what a locked-down profile looks
    // like: reporting still works, captures just do not survive a reload.
    expect(globalThis.indexedDB).toBeUndefined();
    const { backend, persistent } = createBlobBackend();
    expect(persistent).toBe(false);
    await backend.put({ id: 'a', dataUrl: jpeg(10), bytes: 10, createdAt: 1 });
    expect(await backend.get('a')).toBe(jpeg(10));
  });

  it('reports persistence when IndexedDB is present', () => {
    // The real database is exercised by the browser lane and the manual smoke;
    // what is checked here is the choice, which is the part with a fallback.
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open: () => ({}) },
    });
    try {
      expect(createBlobBackend().persistent).toBe(true);
    } finally {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });
});
