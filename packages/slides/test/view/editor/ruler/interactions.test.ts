// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GUIDE_HIT_PX,
  hitTestGuide,
  startGuideMove,
  startRulerDragOut,
  type GuideDragHost,
} from '../../../../src/view/editor/ruler/interactions';
import type { Guide } from '../../../../src/model/presentation';

function makeHost(initialGuides: Guide[] = []): {
  host: GuideDragHost;
  state: {
    pendingGuide: { id?: string; axis: 'x' | 'y'; position: number } | null;
    guides: Guide[];
    cursor: string | null;
    isInside: boolean;
    overRuler: 'h' | 'v' | null;
    /** Per-deck logical slide height fed to the guide clamp. */
    slideHeight: number;
    /** Last (x, y) returned by clientToLogical; tests override via the
     * `cursor*` helpers below by mutating this directly. */
    logical: { x: number; y: number };
  };
  addGuide: ReturnType<typeof vi.fn>;
  moveGuide: ReturnType<typeof vi.fn>;
  removeGuide: ReturnType<typeof vi.fn>;
} {
  const state = {
    pendingGuide: null as
      | { id?: string; axis: 'x' | 'y'; position: number }
      | null,
    // Deep-clone each guide so per-test mutations (moveGuide writes
    // `g.position`) cannot leak into the shared `seed` fixtures across
    // tests in this file.
    guides: initialGuides.map((g) => ({ ...g })),
    cursor: null as string | null,
    isInside: true,
    overRuler: null as 'h' | 'v' | null,
    slideHeight: 1080,
    logical: { x: 0, y: 0 },
  };
  const addGuide = vi.fn((axis: 'x' | 'y', position: number) => {
    state.guides.push({ id: `g${state.guides.length + 1}`, axis, position });
  });
  const moveGuide = vi.fn((id: string, position: number) => {
    const g = state.guides.find((g) => g.id === id);
    if (g) g.position = position;
  });
  const removeGuide = vi.fn((id: string) => {
    state.guides = state.guides.filter((g) => g.id !== id);
  });
  const host: GuideDragHost = {
    setPendingGuide: (g) => {
      state.pendingGuide = g;
    },
    commitAddGuide: (axis, position) => addGuide(axis, position),
    commitMoveGuide: (id, position) => moveGuide(id, position),
    commitRemoveGuide: (id) => removeGuide(id),
    readGuides: () => state.guides,
    clientToLogical: () => ({ ...state.logical }),
    isOverRuler: () => state.overRuler,
    isInsideSlide: () => state.isInside,
    slideHeight: () => state.slideHeight,
    setBodyCursor: (c) => {
      state.cursor = c;
    },
  };
  return { host, state, addGuide, moveGuide, removeGuide };
}

function pointerEvent(
  type: string,
  client: { x: number; y: number },
): PointerEvent {
  // jsdom does not implement the PointerEvent constructor in some
  // versions; fall back to MouseEvent and cast — startRulerDragOut /
  // startGuideMove only read `clientX` / `clientY` / `preventDefault`.
  const ctor = (globalThis as { PointerEvent?: typeof PointerEvent })
    .PointerEvent;
  if (ctor) {
    return new ctor(type, { clientX: client.x, clientY: client.y, bubbles: true });
  }
  return new MouseEvent(type, {
    clientX: client.x,
    clientY: client.y,
    bubbles: true,
  }) as unknown as PointerEvent;
}

describe('hitTestGuide', () => {
  const guides: Guide[] = [
    { id: 'a', axis: 'x', position: 400 },
    { id: 'b', axis: 'y', position: 300 },
  ];

  it('returns the vertical guide when the pointer is within 4 px on x', () => {
    expect(hitTestGuide(guides, { x: 402, y: 0 })).toMatchObject({ id: 'a' });
    expect(hitTestGuide(guides, { x: 396, y: 0 })).toMatchObject({ id: 'a' });
  });

  it('returns the horizontal guide when the pointer is within 4 px on y', () => {
    expect(hitTestGuide(guides, { x: 0, y: 302 })).toMatchObject({ id: 'b' });
  });

  it('returns null when the pointer is past the 4-px zone', () => {
    expect(hitTestGuide(guides, { x: 405, y: 305 })).toBeNull();
  });

  it('honors the exact GUIDE_HIT_PX boundary', () => {
    expect(hitTestGuide(guides, { x: 400 + GUIDE_HIT_PX, y: 0 })).not.toBeNull();
    expect(
      hitTestGuide(guides, { x: 400 + GUIDE_HIT_PX + 1, y: 0 }),
    ).toBeNull();
  });
});

describe('startRulerDragOut', () => {
  let env: ReturnType<typeof makeHost>;
  beforeEach(() => {
    env = makeHost();
    env.state.logical = { x: 500, y: 0 };
  });

  it('seeds the pending guide on mousedown', () => {
    startRulerDragOut(env.host, 'x', pointerEvent('pointerdown', { x: 500, y: 0 }));
    expect(env.state.pendingGuide).toEqual({ axis: 'x', position: 500 });
  });

  it('commits addGuide on mouseup inside the slide', () => {
    startRulerDragOut(env.host, 'x', pointerEvent('pointerdown', { x: 500, y: 0 }));
    env.state.logical = { x: 600, y: 0 };
    document.dispatchEvent(pointerEvent('pointermove', { x: 600, y: 0 }));
    expect(env.state.pendingGuide).toEqual({ axis: 'x', position: 600 });
    env.state.isInside = true;
    env.state.logical = { x: 600, y: 0 };
    document.dispatchEvent(pointerEvent('pointerup', { x: 600, y: 0 }));
    expect(env.addGuide).toHaveBeenCalledWith('x', 600);
    expect(env.state.pendingGuide).toBeNull();
  });

  it('cancels on mouseup outside the slide', () => {
    startRulerDragOut(env.host, 'y', pointerEvent('pointerdown', { x: 0, y: 50 }));
    env.state.isInside = false;
    document.dispatchEvent(pointerEvent('pointerup', { x: 9999, y: 9999 }));
    expect(env.addGuide).not.toHaveBeenCalled();
    expect(env.state.pendingGuide).toBeNull();
  });

  it('clears the body cursor on mouseup', () => {
    startRulerDragOut(env.host, 'x', pointerEvent('pointerdown', { x: 50, y: 0 }));
    expect(env.state.cursor).toBe('col-resize');
    env.state.logical = { x: 50, y: 0 };
    document.dispatchEvent(pointerEvent('pointerup', { x: 50, y: 0 }));
    expect(env.state.cursor).toBeNull();
  });
});

describe('startGuideMove', () => {
  const seed: Guide = { id: 'a', axis: 'x', position: 400 };

  it('moves the guide on mouseup over the slide', () => {
    const env = makeHost([seed]);
    env.state.logical = { x: 400, y: 0 };
    startGuideMove(env.host, seed, pointerEvent('pointerdown', { x: 400, y: 0 }));
    env.state.logical = { x: 550, y: 0 };
    document.dispatchEvent(pointerEvent('pointermove', { x: 550, y: 0 }));
    expect(env.state.pendingGuide).toMatchObject({ id: 'a', position: 550 });
    env.state.overRuler = null;
    document.dispatchEvent(pointerEvent('pointerup', { x: 550, y: 0 }));
    expect(env.moveGuide).toHaveBeenCalledWith('a', 550);
    expect(env.removeGuide).not.toHaveBeenCalled();
    expect(env.state.pendingGuide).toBeNull();
  });

  it('deletes the guide on mouseup over a ruler', () => {
    const env = makeHost([seed]);
    env.state.logical = { x: 400, y: 0 };
    startGuideMove(env.host, seed, pointerEvent('pointerdown', { x: 400, y: 0 }));
    env.state.overRuler = 'h';
    document.dispatchEvent(pointerEvent('pointerup', { x: 200, y: 5 }));
    expect(env.removeGuide).toHaveBeenCalledWith('a');
    expect(env.moveGuide).not.toHaveBeenCalled();
  });

  it('skips moveGuide when the position is unchanged', () => {
    const env = makeHost([seed]);
    env.state.logical = { x: 400, y: 0 };
    startGuideMove(env.host, seed, pointerEvent('pointerdown', { x: 400, y: 0 }));
    document.dispatchEvent(pointerEvent('pointerup', { x: 400, y: 0 }));
    expect(env.moveGuide).not.toHaveBeenCalled();
  });

  it('clamps the new position into the slide extent', () => {
    const env = makeHost([seed]);
    env.state.logical = { x: 400, y: 0 };
    startGuideMove(env.host, seed, pointerEvent('pointerdown', { x: 400, y: 0 }));
    env.state.logical = { x: 9999, y: 0 };
    document.dispatchEvent(pointerEvent('pointermove', { x: 9999, y: 0 }));
    expect(env.state.pendingGuide?.position).toBe(1920);
    document.dispatchEvent(pointerEvent('pointerup', { x: 9999, y: 0 }));
    expect(env.moveGuide).toHaveBeenCalledWith('a', 1920);
  });

  it('clamps a horizontal guide to the per-deck height, not a fixed 1080', () => {
    // A 4:3 deck is 1440 logical px tall. Dragging a y-guide past the
    // bottom clamps to 1440 — the old fixed-1080 clamp would cut it short.
    const ySeed: Guide = { id: 'y', axis: 'y', position: 200 };
    const env = makeHost([ySeed]);
    env.state.slideHeight = 1440;
    env.state.logical = { x: 0, y: 200 };
    startGuideMove(env.host, ySeed, pointerEvent('pointerdown', { x: 0, y: 200 }));
    env.state.logical = { x: 0, y: 9999 };
    document.dispatchEvent(pointerEvent('pointermove', { x: 0, y: 9999 }));
    expect(env.state.pendingGuide?.position).toBe(1440);
  });
});
