import { describe, expect, it, vi } from 'vitest';
import {
  captureRegion,
  drawOpFor,
  layersForRect,
  MAX_CAPTURE_SIDE,
  outputSizeFor,
  pixelRatioOf,
  type CanvasLayer,
  type CaptureTarget,
  type DrawOp,
} from './capture';

/** A layer at CSS box `box` whose backing store is `ratio`× that box. */
const layer = (
  x: number,
  y: number,
  w: number,
  h: number,
  ratio = 1,
  z?: number,
): CanvasLayer => ({
  box: { x, y, w, h },
  backing: { w: w * ratio, h: h * ratio },
  ...(z === undefined ? {} : { z }),
});

/**
 * The two layouts this file exists for.
 *
 * `overlapping` is the sheet: grid and overlay canvases sharing one box.
 * `stacked` is `/harness/docs`: pairs of canvases ADJACENT in y, which is the
 * layout that produced an image with a black band when selection went by centre
 * containment.
 */
const overlapping = [layer(0, 0, 400, 300), layer(0, 0, 400, 300)];
const stacked = [layer(25, 54, 698, 158), layer(25, 212, 698, 158)];

describe('layersForRect', () => {
  it('keeps every layer the rect overlaps', () => {
    expect(layersForRect(overlapping, { x: 10, y: 10, w: 50, h: 50 })).toHaveLength(2);
  });

  it('keeps a layer the rect only partly covers', () => {
    // The docs case: the rect starts inside the first canvas and ends inside
    // the second. Centre containment kept one; intersection keeps both.
    const rect = { x: 55, y: 140, w: 220, h: 120 };
    expect(layersForRect(stacked, rect)).toHaveLength(2);
  });

  it('drops a layer the rect misses', () => {
    expect(layersForRect(stacked, { x: 55, y: 60, w: 100, h: 40 })).toEqual([stacked[0]]);
  });

  it('drops a layer the rect only touches along an edge', () => {
    // A contributor that paints nothing still raises the pixel ratio, and so
    // the output size, for no pixels.
    const right = layer(100, 0, 100, 100);
    expect(layersForRect([right], { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
  });

  it('returns layers in PAINT order, not document order', () => {
    // The sheet appends its OVERLAY canvas first and gives it `z-index: 1`, so
    // document order is the reverse of what the browser composited. Drawing in
    // document order painted the opaque grid over the selection rectangle.
    const overlayFirst = [layer(0, 0, 400, 300, 1, 1), layer(0, 0, 400, 300, 1, 0)];
    const ordered = layersForRect(overlayFirst, { x: 0, y: 0, w: 100, h: 100 });
    expect(ordered.map((l) => l.z)).toEqual([0, 1]);
  });

  it('keeps document order within one stacking level', () => {
    const a = layer(0, 0, 10, 10);
    const b = layer(0, 0, 20, 20);
    expect(layersForRect([a, b], { x: 0, y: 0, w: 5, h: 5 })).toEqual([a, b]);
  });

  it('drops degenerate layers and refuses a degenerate rect', () => {
    expect(layersForRect([layer(0, 0, 0, 0)], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(layersForRect(overlapping, { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
  });
});

describe('pixelRatioOf', () => {
  it('takes the sharpest layer, not the first', () => {
    expect(pixelRatioOf([layer(0, 0, 100, 100, 1), layer(0, 0, 100, 100, 3)])).toBe(3);
  });

  it('never goes below 1, and ignores degenerate layers', () => {
    expect(pixelRatioOf([])).toBe(1);
    expect(pixelRatioOf([layer(0, 0, 0, 0, 4)])).toBe(1);
  });
});

describe('outputSizeFor', () => {
  it('honours the pixel ratio', () => {
    expect(outputSizeFor({ x: 0, y: 0, w: 160, h: 60 }, 2)).toEqual({ w: 320, h: 120 });
  });

  it('caps the longest side and preserves the aspect ratio', () => {
    const out = outputSizeFor({ x: 0, y: 0, w: 1600, h: 800 }, 2);
    expect(Math.max(out.w, out.h)).toBe(MAX_CAPTURE_SIDE);
    expect(out.w / out.h).toBeCloseTo(2, 2);
  });

  it('never returns a zero dimension', () => {
    const out = outputSizeFor({ x: 0, y: 0, w: 0.2, h: 0.2 }, 1);
    expect(out.w).toBeGreaterThanOrEqual(1);
    expect(out.h).toBeGreaterThanOrEqual(1);
  });
});

describe('drawOpFor', () => {
  const rect = { x: 100, y: 100, w: 200, h: 100 };

  it('maps a fully covering layer one to one', () => {
    const op = drawOpFor(layer(0, 0, 400, 300), rect, { w: 200, h: 100 });
    expect(op).toEqual({ sx: 100, sy: 100, sw: 200, sh: 100, dx: 0, dy: 0, dw: 200, dh: 100 });
  });

  it('scales source coordinates by the layer backing ratio', () => {
    const op = drawOpFor(layer(0, 0, 400, 300, 2), rect, { w: 400, h: 200 });
    // Source in backing pixels (2×), destination in output pixels (also 2×).
    expect(op).toEqual({ sx: 200, sy: 200, sw: 400, sh: 200, dx: 0, dy: 0, dw: 400, dh: 200 });
  });

  it('crops to the INTERSECTION, so a partial layer paints only its share', () => {
    // This is the black-band regression. The region runs y 140..260; the first
    // canvas ends at y 212, so it may paint only the top 72 of the 120.
    const region = { x: 55, y: 140, w: 220, h: 120 };
    const output = { w: 220, h: 120 };
    const top = drawOpFor(stacked[0], region, output);
    const bottom = drawOpFor(stacked[1], region, output);
    expect(top).toMatchObject({ dy: 0, dh: 72 });
    expect(bottom).toMatchObject({ dy: 72, dh: 48 });
    // Together they tile the output with no gap and no overlap — which is what
    // "the bottom third is black" was the absence of.
    expect(top!.dh + bottom!.dh).toBe(output.h);
    expect(bottom!.dy).toBe(top!.dh);
    // And each reads from the right place inside its own canvas.
    expect(top!.sy).toBe(140 - 54);
    expect(bottom!.sy).toBe(0);
  });

  it('returns undefined for a layer the rect only touches at the edge', () => {
    expect(drawOpFor(layer(0, 0, 100, 100), { x: 100, y: 0, w: 50, h: 50 }, { w: 50, h: 50 })).toBeUndefined();
  });

  it('returns undefined for degenerate input', () => {
    expect(drawOpFor(layer(0, 0, 0, 0), { x: 0, y: 0, w: 10, h: 10 }, { w: 10, h: 10 })).toBeUndefined();
    expect(drawOpFor(layer(0, 0, 10, 10), { x: 0, y: 0, w: 0, h: 10 }, { w: 10, h: 10 })).toBeUndefined();
  });
});

/** A capture target that records what it was asked to paint. */
function recordingTarget(): {
  target: CaptureTarget;
  ops: DrawOp[];
  images: unknown[];
  fills: string[];
} {
  const ops: DrawOp[] = [];
  const images: unknown[] = [];
  const fills: string[] = [];
  return {
    ops,
    images,
    fills,
    target: {
      width: 0,
      height: 0,
      fill: (color) => fills.push(color),
      drawImage: (image, op) => {
        images.push(image);
        ops.push(op);
      },
      toDataUrl: (mime) => `data:${mime};base64,AAAA`,
    },
  };
}

describe('captureRegion', () => {
  const image = {} as CanvasImageSource;
  const source = (layers: CanvasLayer[]) => ({ layers, imageFor: () => image });

  it('composites every contributing layer in the order given', () => {
    const { target, ops } = recordingTarget();
    const result = captureRegion(
      { x: 0, y: 0, w: 100, h: 100 },
      source(overlapping),
      { createCanvas: () => target },
    );
    expect(result?.layers).toBe(2);
    expect(ops).toHaveLength(2);
    expect(result?.mime).toBe('image/jpeg');
  });

  it('covers the whole output when two adjacent layers each cover part', () => {
    const { target, ops } = recordingTarget();
    const region = { x: 55, y: 140, w: 220, h: 120 };
    const result = captureRegion(region, source(stacked), { createCanvas: () => target });
    expect(result?.layers).toBe(2);
    const covered = ops.reduce((sum, op) => sum + op.dh, 0);
    expect(covered).toBe(outputSizeFor(region, 1).h);
  });

  it('returns undefined rather than a blank image when nothing contributes', () => {
    const create = vi.fn();
    expect(
      captureRegion({ x: 0, y: 0, w: 10, h: 10 }, source([layer(500, 500, 10, 10)]), {
        createCanvas: create,
      }),
    ).toBeUndefined();
    // No point allocating a canvas for an empty capture.
    expect(create).not.toHaveBeenCalled();
  });

  it('returns undefined when no drawing surface can be had', () => {
    expect(
      captureRegion({ x: 0, y: 0, w: 10, h: 10 }, source(overlapping), {
        createCanvas: () => undefined,
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the surface refuses to encode', () => {
    const { target } = recordingTarget();
    const throwing: CaptureTarget = {
      ...target,
      toDataUrl: () => {
        throw new Error('tainted canvas');
      },
    };
    expect(
      captureRegion({ x: 0, y: 0, w: 10, h: 10 }, source(overlapping), {
        createCanvas: () => throwing,
      }),
    ).toBeUndefined();
  });

  it('honours an explicit mime and quality', () => {
    const { target } = recordingTarget();
    const quality = vi.spyOn(target, 'toDataUrl');
    const result = captureRegion({ x: 0, y: 0, w: 10, h: 10 }, source(overlapping), {
      createCanvas: () => target,
      mime: 'image/png',
      quality: 0.5,
    });
    expect(result?.mime).toBe('image/png');
    expect(quality).toHaveBeenCalledWith('image/png', 0.5);
  });
});

describe('coverage', () => {
  it('is 1 when a layer covers the whole region', () => {
    const { target } = recordingTarget();
    const result = captureRegion({ x: 0, y: 0, w: 100, h: 100 }, {
      layers: [layer(0, 0, 400, 300)],
      imageFor: () => ({}) as CanvasImageSource,
    }, { createCanvas: () => target });
    expect(result?.coverage).toBe(1);
  });

  it('reports the shortfall when the region reaches past every canvas', () => {
    // The region runs y 140..260 but the canvases stop at y 212, so a quarter of
    // the output has no content — the part that used to encode as solid black.
    const { target } = recordingTarget();
    const region = { x: 55, y: 140, w: 220, h: 120 };
    const result = captureRegion(region, {
      layers: [stacked[0]],
      imageFor: () => ({}) as CanvasImageSource,
    }, { createCanvas: () => target });
    expect(result?.coverage).toBeCloseTo(72 / 120, 2);
  });

  it('does not double-count stacked layers that share a box', () => {
    const { target } = recordingTarget();
    const result = captureRegion({ x: 0, y: 0, w: 100, h: 100 }, {
      layers: overlapping,
      imageFor: () => ({}) as CanvasImageSource,
    }, { createCanvas: () => target });
    expect(result?.coverage).toBe(1);
  });

  it('fills the surface before compositing, so a gap is not black', () => {
    const { target, fills } = recordingTarget();
    captureRegion({ x: 0, y: 0, w: 100, h: 100 }, {
      layers: overlapping,
      imageFor: () => ({}) as CanvasImageSource,
    }, { createCanvas: () => target, background: '#123456' });
    expect(fills).toEqual(['#123456']);
  });

  it('fills before it draws, not after', () => {
    // The order is the whole point; filling afterwards would erase the capture.
    const order: string[] = [];
    const target: CaptureTarget = {
      width: 0,
      height: 0,
      fill: () => order.push('fill'),
      drawImage: () => order.push('draw'),
      toDataUrl: () => 'data:image/jpeg;base64,AAAA',
    };
    captureRegion({ x: 0, y: 0, w: 100, h: 100 }, {
      layers: overlapping,
      imageFor: () => ({}) as CanvasImageSource,
    }, { createCanvas: () => target });
    expect(order[0]).toBe('fill');
    expect(order).toContain('draw');
  });
});
