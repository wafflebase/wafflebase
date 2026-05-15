import { describe, expect, it, vi } from 'vitest';
import type { Element } from '../../../model/element';
import type { SlidesStore } from '../../../store/store';
import {
  finalizeInsert,
  findSnapTarget,
  snappedEndpoint,
} from './insert-connector';

const rect = (id: string, x: number, y: number): Element => ({
  id,
  type: 'shape',
  frame: { x, y, w: 100, h: 100, rotation: 0 },
  data: { kind: 'rect' },
});

describe('findSnapTarget', () => {
  it('snaps to the nearest site within 12px', () => {
    const els = [rect('r1', 100, 100)];
    // r1 N site is at (150, 100).
    const hit = findSnapTarget({ x: 155, y: 105 }, els);
    expect(hit).toMatchObject({ elementId: 'r1', siteIndex: 0 });
  });

  it('returns null outside the snap radius', () => {
    const els = [rect('r1', 100, 100)];
    const hit = findSnapTarget({ x: 200, y: 300 }, els);
    expect(hit).toBeNull();
  });

  it('skips connector elements (no sites on connectors)', () => {
    const fakeConnector = { id: 'c1', type: 'connector' } as unknown as Element;
    const hit = findSnapTarget({ x: 0, y: 0 }, [fakeConnector]);
    expect(hit).toBeNull();
  });

  it('picks the closer site when multiple shapes are nearby', () => {
    const els = [rect('r1', 100, 100), rect('r2', 200, 100)];
    // r1 E site = (200, 150); r2 W site = (200, 150). Same coord. Either
    // is acceptable. Cursor at (198, 150) → both within snap radius.
    const hit = findSnapTarget({ x: 198, y: 150 }, els);
    expect(hit).not.toBeNull();
    expect(['r1', 'r2']).toContain(hit!.elementId);
  });
});

describe('snappedEndpoint', () => {
  it('returns free when no snap', () => {
    expect(snappedEndpoint({ x: 500, y: 500 }, [])).toEqual({
      kind: 'free',
      x: 500,
      y: 500,
    });
  });

  it('returns attached on snap', () => {
    const els = [rect('r1', 100, 100)];
    expect(snappedEndpoint({ x: 150, y: 100 }, els)).toEqual({
      kind: 'attached',
      elementId: 'r1',
      siteIndex: 0,
    });
  });
});

describe('finalizeInsert', () => {
  function makeStore(): { store: SlidesStore; calls: unknown[] } {
    const calls: unknown[] = [];
    const store = {
      addElement: vi.fn((slideId: string, init: unknown) => {
        calls.push({ slideId, init });
        return 'new-id';
      }),
    } as unknown as SlidesStore;
    return { store, calls };
  }

  it('returns null and skips the store call for a sub-threshold drag', () => {
    const { store } = makeStore();
    const id = finalizeInsert(
      store,
      's1',
      'line',
      { x: 100, y: 100 },
      { x: 102, y: 102 }, // hypot ≈ 2.83 < MIN_DRAG_DISTANCE (4)
      [],
    );
    expect(id).toBeNull();
    expect((store.addElement as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('creates a free-to-free line when no snap targets exist', () => {
    const { store, calls } = makeStore();
    const id = finalizeInsert(
      store,
      's1',
      'line',
      { x: 100, y: 100 },
      { x: 400, y: 400 },
      [],
    );
    expect(id).toBe('new-id');
    expect(calls).toHaveLength(1);
    const init = (calls[0] as { init: { type: string; start: unknown; end: unknown; arrowheads: object } }).init;
    expect(init.type).toBe('connector');
    expect(init.start).toEqual({ kind: 'free', x: 100, y: 100 });
    expect(init.end).toEqual({ kind: 'free', x: 400, y: 400 });
    // 'line' → no arrowheads.
    expect(init.arrowheads).toEqual({});
  });

  it('adds an end-side triangle arrowhead for the arrow variant', () => {
    const { store, calls } = makeStore();
    finalizeInsert(
      store,
      's1',
      'arrow',
      { x: 100, y: 100 },
      { x: 400, y: 400 },
      [],
    );
    const init = (calls[0] as { init: { arrowheads: { end?: { kind: string; size: string } } } }).init;
    expect(init.arrowheads.end).toEqual({ kind: 'triangle', size: 'md' });
  });

  it('snaps endpoints to nearby connection sites', () => {
    const { store, calls } = makeStore();
    const els = [rect('r1', 100, 100), rect('r2', 400, 100)];
    finalizeInsert(
      store,
      's1',
      'line',
      { x: 150, y: 100 }, // r1 N site
      { x: 450, y: 100 }, // r2 N site
      els,
    );
    const init = (calls[0] as { init: { start: unknown; end: unknown } }).init;
    expect(init.start).toEqual({ kind: 'attached', elementId: 'r1', siteIndex: 0 });
    expect(init.end).toEqual({ kind: 'attached', elementId: 'r2', siteIndex: 0 });
  });
});
