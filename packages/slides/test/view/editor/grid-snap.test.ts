import { describe, it, expect } from 'vitest';
import { snapToGrid, quantizeResizeFrame } from '../../../src/view/editor/grid-snap';
import type { Frame } from '../../../src/model/element';

const frame = (
  x: number,
  y: number,
  w: number,
  h: number,
  rotation = 0,
): Frame => ({ x, y, w, h, rotation });

describe('snapToGrid', () => {
  it('rounds to the nearest multiple', () => {
    expect(snapToGrid(23, 20)).toBe(20);
    expect(snapToGrid(31, 20)).toBe(40);
    expect(snapToGrid(30, 20)).toBe(40); // .5 rounds up
  });

  it('handles negative coordinates', () => {
    // A board is unbounded, so half the plane is negative — `%` would
    // keep the sign here and land on the wrong side.
    expect(snapToGrid(-23, 20)).toBe(-20);
    expect(snapToGrid(-31, 20)).toBe(-40);
  });
});

describe('quantizeResizeFrame', () => {
  it('rounds only the edge an east handle moves', () => {
    // Right edge 133 → 140; left edge must not budge, or the shape
    // would slide out from under the anchor.
    const out = quantizeResizeFrame(frame(13, 27, 120, 100), 'e', 20);
    expect(out.x).toBe(13);
    expect(out.y).toBe(27);
    expect(out.w).toBe(127); // right = 140
    expect(out.h).toBe(100);
  });

  it('rounds only the edge a north handle moves', () => {
    // Top 27 → 20, bottom (127) fixed.
    const out = quantizeResizeFrame(frame(13, 27, 120, 100), 'n', 20);
    expect(out.y).toBe(20);
    expect(out.h).toBe(107);
    expect(out.x).toBe(13);
    expect(out.w).toBe(120);
  });

  it('rounds both edges a corner handle moves', () => {
    // 'nw' moves left and top; right (133) and bottom (127) stay.
    const out = quantizeResizeFrame(frame(13, 27, 120, 100), 'nw', 20);
    expect(out.x).toBe(20);
    expect(out.w).toBe(113);
    expect(out.y).toBe(20);
    expect(out.h).toBe(107);
  });

  it('leaves a rotated frame alone', () => {
    // x/y/w/h describe the PRE-rotation box, so its edges are not the
    // ones on screen — rounding them aligns the shape to nothing.
    const rotated = frame(13, 27, 120, 100, Math.PI / 4);
    expect(quantizeResizeFrame(rotated, 'se', 20)).toEqual(rotated);
  });

  it('skips an axis where rounding would collapse the size', () => {
    // Right edge is 15, one step from the left edge at 13. Rounding it
    // to 20 is fine, but rounding DOWN to 0 (as a step of 40 would)
    // must not invert the frame.
    const out = quantizeResizeFrame(frame(13, 27, 2, 100), 'e', 40);
    expect(out.w).toBe(2);
    // The untouched axis is not affected by the other one bailing.
    const both = quantizeResizeFrame(frame(13, 27, 2, 100), 'se', 40);
    expect(both.w).toBe(2);
    expect(both.h).toBe(93); // bottom 127 → 120
  });

  it('is a no-op when every moved edge is already on the grid', () => {
    const aligned = frame(20, 40, 100, 60);
    expect(quantizeResizeFrame(aligned, 'se', 20)).toEqual(aligned);
  });
});
