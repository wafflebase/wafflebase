import { describe, expect, it, vi } from 'vitest';
import type { Element } from '../../../../src/model/element';
import type { SlidesStore } from '../../../../src/store/store';
import { MemSlidesStore } from '../../../../src/store/memory';
import {
  buildConnectorInit,
  finalizeInsert,
  findSnapTarget,
  snappedEndpoint,
} from '../../../../src/view/editor/interactions/insert-connector';
import { snapEndpointAngle } from '../../../../src/view/editor/interactions/constraints';

const rect = (id: string, x: number, y: number): Element => ({
  id,
  type: 'shape',
  frame: { x, y, w: 100, h: 100, rotation: 0 },
  data: { kind: 'rect' },
});

describe('findSnapTarget', () => {
  it('snaps to the nearest site within 12px at zoom=1', () => {
    const els = [rect('r1', 100, 100)];
    // r1 N site is at (150, 100).
    const hit = findSnapTarget({ x: 155, y: 105 }, els, 1);
    expect(hit).toMatchObject({ elementId: 'r1', siteIndex: 0 });
  });

  it('returns null outside the snap radius at zoom=1', () => {
    const els = [rect('r1', 100, 100)];
    const hit = findSnapTarget({ x: 200, y: 300 }, els, 1);
    expect(hit).toBeNull();
  });

  it('skips connector elements (no sites on connectors)', () => {
    const fakeConnector = { id: 'c1', type: 'connector' } as unknown as Element;
    const hit = findSnapTarget({ x: 0, y: 0 }, [fakeConnector], 1);
    expect(hit).toBeNull();
  });

  it('picks the closer site when multiple shapes are nearby', () => {
    const els = [rect('r1', 100, 100), rect('r2', 200, 100)];
    // r1 E site = (200, 150); r2 W site = (200, 150). Same coord. Either
    // is acceptable. Cursor at (198, 150) → both within snap radius.
    const hit = findSnapTarget({ x: 198, y: 150 }, els, 1);
    expect(hit).not.toBeNull();
    expect(['r1', 'r2']).toContain(hit!.elementId);
  });

  // Zoom mismatch regression (slides-connectors PR1): the constant
  // SITE_SNAP_RADIUS is screen pixels, so the slide-logical threshold
  // shrinks as zoom grows. At zoom=2, 1 logical = 2 screen px → the
  // 12-screen-px snap window equals 6 logical units. At zoom=0.5,
  // 1 logical = 0.5 screen px → the window equals 24 logical units.
  // These two tests lock in that semantic so the snap rule stays in
  // sync with the overlay highlight rule (overlay.ts also divides by
  // zoom).
  it('does not snap at zoom=2 when distance > 12 screen px', () => {
    const els = [rect('r1', 100, 100)];
    // r1 N site at (150, 100); cursor 8 logical units away. At zoom=2
    // that's 16 screen px — outside the 12 screen px snap window.
    const hit = findSnapTarget({ x: 158, y: 100 }, els, 2);
    expect(hit).toBeNull();
  });

  it('snaps at zoom=2 when distance < 12 screen px', () => {
    const els = [rect('r1', 100, 100)];
    // r1 N site at (150, 100); cursor 5 logical units away. At zoom=2
    // that's 10 screen px — inside the 12 screen px snap window.
    const hit = findSnapTarget({ x: 155, y: 100 }, els, 2);
    expect(hit).toMatchObject({ elementId: 'r1', siteIndex: 0 });
  });

  it('snaps at zoom=0.5 when within the widened logical window', () => {
    const els = [rect('r1', 100, 100)];
    // r1 N site at (150, 100); cursor 20 logical units away. At
    // zoom=0.5 that's 10 screen px — well inside the 12-screen-px
    // snap window, which corresponds to 24 logical at this zoom.
    const hit = findSnapTarget({ x: 170, y: 100 }, els, 0.5);
    expect(hit).toMatchObject({ elementId: 'r1', siteIndex: 0 });
  });
});

describe('snappedEndpoint', () => {
  it('returns free when no snap', () => {
    expect(snappedEndpoint({ x: 500, y: 500 }, [], 1)).toEqual({
      kind: 'free',
      x: 500,
      y: 500,
    });
  });

  it('returns attached on snap', () => {
    const els = [rect('r1', 100, 100)];
    expect(snappedEndpoint({ x: 150, y: 100 }, els, 1)).toEqual({
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
      // `finalizeInsert` now owns the `store.batch(...)` wrap, so the
      // mock has to forward through it. The forwarding wrapper keeps
      // the test focused on `addElement` payload while exercising the
      // real call site.
      batch: vi.fn((fn: () => void) => { fn(); }),
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
      1,
    );
    expect(id).toBeNull();
    expect((store.addElement as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    // Critical: the batch must be skipped too, otherwise a no-op
    // undo entry gets snapshotted (see undo-hygiene regression below).
    expect((store.batch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
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
      1,
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
      1,
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
      1,
    );
    const init = (calls[0] as { init: { start: unknown; end: unknown } }).init;
    expect(init.start).toEqual({ kind: 'attached', elementId: 'r1', siteIndex: 0 });
    expect(init.end).toEqual({ kind: 'attached', elementId: 'r2', siteIndex: 0 });
  });
});

describe('finalizeInsert deadband at non-1 zoom', () => {
  // Pre-fix the threshold was raw slide-logical (MIN_DRAG_DISTANCE = 4
  // logical), which decoupled from the sibling screen-pixel constants
  // (SHAPE_HOVER_RADIUS, SITE_SNAP_RADIUS) at zoom != 1. After the fix
  // 4 is interpreted as screen pixels: the logical threshold scales
  // with `/ zoom`, matching the snap radii.

  it('zoom=0.5 — a 5-logical-px (2.5-screen-px) drag cancels (pre-fix would commit)', () => {
    // This is the load-bearing regression case. Pre-fix the raw
    // threshold was 4 *logical*, so a 5-logical drag committed even at
    // zoom=0.5 (where 5 logical = only 2.5 screen px — invisible to
    // the user). Post-fix the threshold scales: at zoom=0.5 it's
    // 4/0.5 = 8 logical, so 5 logical correctly cancels.
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => { slideId = store.addSlide('blank'); });
    const elements = store.read().slides[0].elements;
    const id = finalizeInsert(
      store,
      slideId,
      'line',
      { x: 100, y: 100 },
      { x: 105, y: 100 }, // 5 logical = 2.5 screen px at zoom=0.5
      elements,
      0.5,
    );
    expect(id).toBeNull();
  });

  it('zoom=0.5 — a 12-logical-px (6-screen-px) drag commits', () => {
    // Above the scaled threshold (8 logical at zoom=0.5).
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => { slideId = store.addSlide('blank'); });
    const elements = store.read().slides[0].elements;
    const id = finalizeInsert(
      store,
      slideId,
      'line',
      { x: 100, y: 100 },
      { x: 112, y: 100 },
      elements,
      0.5,
    );
    expect(id).not.toBeNull();
  });

  it('zoom=2 — a 3-logical-px (6-screen-px) drag commits (post-fix)', () => {
    // The matching positive case. At zoom=2 the threshold shrinks to
    // 4/2 = 2 logical, so 3 logical (6 screen px) clearly commits.
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => { slideId = store.addSlide('blank'); });
    const elements = store.read().slides[0].elements;
    const id = finalizeInsert(
      store,
      slideId,
      'line',
      { x: 100, y: 100 },
      { x: 103, y: 100 },
      elements,
      2,
    );
    expect(id).not.toBeNull();
  });
});

describe('finalizeInsert undo hygiene', () => {
  it('sub-threshold drag does not grow the undo stack', () => {
    // Real `MemSlidesStore` so we exercise the actual batch/undo
    // semantics: `batch` unconditionally snapshots when `batchDepth`
    // is 0, so the threshold gate has to live OUTSIDE the batch.
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
    });
    // Baseline: exactly one undo entry from the slide creation above.
    expect(store.canUndo()).toBe(true);
    let undoDepth = 0;
    while (store.canUndo()) {
      store.undo();
      undoDepth++;
    }
    expect(undoDepth).toBe(1);
    // Replay to restore the slide so we can poke at it.
    while (store.canRedo()) store.redo();
    expect(store.canUndo()).toBe(true);

    const elements = store.read().slides[0].elements;
    const id = finalizeInsert(
      store,
      slideId,
      'line',
      { x: 100, y: 100 },
      { x: 102, y: 100 }, // 2px < MIN_DRAG_DISTANCE (4)
      elements,
      1,
    );
    expect(id).toBeNull();

    // Undo state must be unchanged: still exactly one entry (the
    // initial addSlide). If the batch had fired we'd see two.
    let depthAfter = 0;
    while (store.canUndo()) {
      store.undo();
      depthAfter++;
    }
    expect(depthAfter).toBe(1);
  });

  it('above-threshold drag adds exactly one undo entry', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
    });
    const elements = store.read().slides[0].elements;
    const id = finalizeInsert(
      store,
      slideId,
      'line',
      { x: 100, y: 100 },
      { x: 400, y: 100 }, // 300px well above threshold
      elements,
      1,
    );
    expect(id).not.toBeNull();
    // Two undo entries: addSlide + finalizeInsert.
    let depth = 0;
    while (store.canUndo()) {
      store.undo();
      depth++;
    }
    expect(depth).toBe(2);
  });
});

describe('connector insert + Shift snaps endpoint to 15°', () => {
  it('snaps a (0,0) -> (100, 30) drag toward 15°', () => {
    const start = { x: 0, y: 0 };
    const rawEnd = { x: 100, y: 30 };
    const end = snapEndpointAngle(start, rawEnd);
    // 100/30 → atan2 ≈ 16.7° → snaps to 15° = π/12.
    const angle = Math.atan2(end.y, end.x);
    expect(angle).toBeCloseTo(Math.PI / 12);

    // The connector init derives its frame from start/end — make sure
    // the snapped end is what flows through.
    const init = buildConnectorInit('line', start, end, [], 1);
    expect(init).toBeTruthy();
  });

  it('snaps a (0,0) -> (50, 50) drag to exactly 45°', () => {
    const start = { x: 0, y: 0 };
    const end = snapEndpointAngle(start, { x: 50, y: 50 });
    expect(Math.atan2(end.y, end.x)).toBeCloseTo(Math.PI / 4);
  });
});
