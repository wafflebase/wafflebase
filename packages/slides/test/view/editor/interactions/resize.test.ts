import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../../src/model/element';
import { resizeFrame, resizeFrameWorld } from '../../../../src/view/editor/interactions/resize';

const f = (x: number, y: number, w: number, h: number, rotation = 0): Frame => ({
  x, y, w, h, rotation,
});

// Anchor of a handle = opposite corner / edge midpoint, expressed in
// the frame's LOCAL coords (0,0 = top-left, w,h = bottom-right).
function anchorLocal(handle: 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w', w: number, h: number) {
  switch (handle) {
    case 'nw': return { x: w,     y: h };
    case 'n':  return { x: w / 2, y: h };
    case 'ne': return { x: 0,     y: h };
    case 'e':  return { x: 0,     y: h / 2 };
    case 'se': return { x: 0,     y: 0 };
    case 's':  return { x: w / 2, y: 0 };
    case 'sw': return { x: w,     y: 0 };
    case 'w':  return { x: w,     y: h / 2 };
  }
}

// World position of a handle's local point on a frame.
function localToWorld(frame: Frame, lx: number, ly: number) {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const dx = lx - frame.w / 2;
  const dy = ly - frame.h / 2;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

describe('resizeFrame — east handle', () => {
  it('grows the frame to the right when dragging east-positive', () => {
    const start = f(100, 100, 200, 100);
    const next = resizeFrame(start, 'e', 50, 0, false);
    expect(next).toEqual({ x: 100, y: 100, w: 250, h: 100, rotation: 0 });
  });
  it('shrinks the frame when dragging east-negative', () => {
    const start = f(100, 100, 200, 100);
    const next = resizeFrame(start, 'e', -150, 0, false);
    expect(next.w).toBe(50);
  });
  it('does not move the west edge', () => {
    const start = f(100, 100, 200, 100);
    expect(resizeFrame(start, 'e', 30, 0, false).x).toBe(100);
  });
});

describe('resizeFrame — nw handle', () => {
  it('moves the top-left corner; keeps bottom-right in place', () => {
    const start = f(100, 100, 200, 100);
    const next = resizeFrame(start, 'nw', -50, -25, false);
    expect(next).toEqual({ x: 50, y: 75, w: 250, h: 125, rotation: 0 });
  });
});

describe('resizeFrame — shift preserves aspect', () => {
  it('uses the larger relative drag and scales the other axis proportionally', () => {
    const start = f(0, 0, 200, 100);            // 2:1 aspect
    const next = resizeFrame(start, 'se', 100, 10, true); // shift on
    // 100 / 200 = 0.5 (x-relative). 10 / 100 = 0.1 (y-relative).
    // Larger relative is 0.5; apply to both → +100 width, +50 height.
    expect(next.w).toBe(300);
    expect(next.h).toBe(150);
  });
});

describe('resizeFrame — minimum size', () => {
  it('clamps to a 1px minimum so the frame never inverts', () => {
    const start = f(0, 0, 100, 100);
    const next = resizeFrame(start, 'se', -200, -200, false);
    expect(next.w).toBe(1);
    expect(next.h).toBe(1);
  });
});

describe('resizeFrameWorld — unrotated delegates to resizeFrame', () => {
  it('produces the same frame as resizeFrame when rotation === 0', () => {
    const start = f(100, 100, 200, 100);
    const a = resizeFrame(start, 'se', 50, 30, false);
    const b = resizeFrameWorld(start, 'se', 50, 30, false);
    expect(b).toEqual(a);
  });
});

describe('resizeFrameWorld — rotated frames keep the anchor in world space', () => {
  // Rotated 45°. The anchor must NOT move in world coords, regardless
  // of which handle is dragged.
  const ROT = Math.PI / 4;
  const start = f(100, 100, 200, 100, ROT);
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

  for (const handle of handles) {
    it(`${handle} handle: anchor world position is preserved`, () => {
      const before = anchorLocal(handle, start.w, start.h);
      const anchorWorldBefore = localToWorld(start, before.x, before.y);
      const next = resizeFrameWorld(start, handle, 30, -20, false);
      const after = anchorLocal(handle, next.w, next.h);
      const anchorWorldAfter = localToWorld(next, after.x, after.y);
      expect(anchorWorldAfter.x).toBeCloseTo(anchorWorldBefore.x, 6);
      expect(anchorWorldAfter.y).toBeCloseTo(anchorWorldBefore.y, 6);
      expect(next.rotation).toBe(ROT);
    });
  }

  it('east handle on a 45°-rotated 200×100 frame: dragging "east" in world projects onto local +x and grows w', () => {
    // World drag (dx=10, dy=10) projects onto local (rotated by -45°)
    // = (10*cos(-π/4) - 10*sin(-π/4), 10*sin(-π/4) + 10*cos(-π/4))
    // = (10*√2/2 + 10*√2/2, -10*√2/2 + 10*√2/2) = (√200 ≈ 14.14, 0)
    // So the local x-extent grows by ~14.14 → new w ≈ 214.14.
    const next = resizeFrameWorld(start, 'e', 10, 10, false);
    expect(next.w).toBeCloseTo(start.w + Math.SQRT2 * 10, 5);
    expect(next.h).toBeCloseTo(start.h, 5);
  });
});

import {
  resizeMultiFrames,
  type MultiResizeStart,
  type ElementSnapshot,
} from '../../../../src/view/editor/interactions/resize';

const frameSnap = (
  id: string,
  x: number, y: number, w: number, h: number,
  rotation = 0,
): ElementSnapshot => ({
  kind: 'frame',
  id,
  worldFrame: { x, y, w, h, rotation },
});

describe('resizeMultiFrames', () => {
  it('SE corner, no Shift: scales both axes independently per child', () => {
    const snapshots = [
      frameSnap('a', 0,   0,   100, 50),
      frameSnap('b', 200, 100, 80,  60),
    ];
    const startBbox = { x: 0, y: 0, w: 280, h: 160, rotation: 0 };
    const start: MultiResizeStart = { scope: [], startBbox, snapshots };
    const { newBbox, frames } = resizeMultiFrames(start, 'se', 280, 160, false);

    expect(newBbox).toMatchObject({ x: 0, y: 0, w: 560, h: 320 });
    expect(frames.get('a')).toMatchObject({ x: 0, y: 0, w: 200, h: 100 });
    expect(frames.get('b')).toMatchObject({ x: 400, y: 200, w: 160, h: 120 });
  });

  it('SE corner, Shift: uniform scale based on the dominant axis', () => {
    const snapshots = [frameSnap('a', 0, 0, 100, 50)];
    const startBbox = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
    const result = resizeMultiFrames(
      { scope: [], startBbox, snapshots },
      'se',
      100, // dx grows the bbox by 2x in x
      0,   // dy unchanged
      true, // shift → uniform scale, h also doubles
    );
    expect(result.newBbox).toMatchObject({ w: 200, h: 100 });
    expect(result.frames.get('a')).toMatchObject({ w: 200, h: 100 });
  });

  it('W edge: single-axis stretch in x only', () => {
    const snapshots = [frameSnap('a', 100, 0, 100, 50)];
    const startBbox = { x: 100, y: 0, w: 100, h: 50, rotation: 0 };
    const result = resizeMultiFrames(
      { scope: [], startBbox, snapshots },
      'w',
      -100, // drag west handle 100 to the left → x shrinks, w grows by 100
      0,
      false,
    );
    expect(result.newBbox).toMatchObject({ x: 0, w: 200, h: 50 });
    expect(result.frames.get('a')).toMatchObject({ x: 0, w: 200, h: 50 });
  });

  it('preserves rotation on each child; w/h scale in local axes', () => {
    const snapshots = [frameSnap('a', 0, 0, 100, 50, Math.PI / 4)];
    const startBbox = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
    const result = resizeMultiFrames(
      { scope: [], startBbox, snapshots },
      'se', 100, 50, false,
    );
    const a = result.frames.get('a')!;
    expect(a.rotation).toBeCloseTo(Math.PI / 4);
    expect(a.w).toBeCloseTo(200);
    expect(a.h).toBeCloseTo(100);
  });

  it('connector free endpoints scale; attached endpoints are unchanged', () => {
    const snapshots: ElementSnapshot[] = [
      {
        kind: 'connector',
        id: 'c',
        worldFrame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        start: { kind: 'free', x: 0, y: 0 },
        end:   { kind: 'attached', elementId: 'target', siteIndex: 0 },
      },
    ];
    const startBbox = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
    const result = resizeMultiFrames(
      { scope: [], startBbox, snapshots },
      'se', 100, 50, false,
    );
    const eps = result.connectorEndpoints.get('c')!;
    expect(eps.start).toEqual({ kind: 'free', x: 0, y: 0 }); // NW is the anchor — point doesn't move
    expect(eps.end).toEqual({ kind: 'attached', elementId: 'target', siteIndex: 0 });
  });

  it('connector with both endpoints attached is not in the output map', () => {
    const snapshots: ElementSnapshot[] = [
      {
        kind: 'connector',
        id: 'c',
        worldFrame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        start: { kind: 'attached', elementId: 'a', siteIndex: 0 },
        end:   { kind: 'attached', elementId: 'b', siteIndex: 2 },
      },
    ];
    const result = resizeMultiFrames(
      { scope: [], startBbox: { x: 0, y: 0, w: 100, h: 50, rotation: 0 }, snapshots },
      'se', 50, 25, false,
    );
    expect(result.connectorEndpoints.has('c')).toBe(false);
  });

  it('per-child min-size clamp does not collapse the bbox', () => {
    const snapshots = [
      frameSnap('big',  0,   0, 100, 50),
      frameSnap('tiny', 200, 0, 2,   2),
    ];
    const startBbox = { x: 0, y: 0, w: 202, h: 50, rotation: 0 };
    const result = resizeMultiFrames(
      { scope: [], startBbox, snapshots },
      'se', -100, 0, false,
    );
    expect(result.frames.get('tiny')!.w).toBeGreaterThanOrEqual(1);
    // big scales by sx = newBbox.w / startBbox.w = 102 / 202 ≈ 0.505
    expect(result.frames.get('big')!.w).toBeCloseTo(100 * (102 / 202), 5);
  });
});
