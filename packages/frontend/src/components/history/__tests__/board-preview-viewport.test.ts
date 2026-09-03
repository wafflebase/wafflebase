import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { worldToScreen } from '@wafflebase/slides';

import { parseBoardSnapshot } from '../snapshot-adapters';
import {
  boardPreviewViewport,
  ORIGIN_VIEWPORT,
} from '../board-preview-viewport';

const HOST = { w: 800, h: 600 };

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', `${name}.yson.txt`), 'utf8');

/** Screen-space AABB of an element's frame under `vp`. */
function onScreen(
  frame: { x: number; y: number; w: number; h: number },
  vp: { panX: number; panY: number; zoom: number },
) {
  const tl = worldToScreen(vp, { x: frame.x, y: frame.y });
  const br = worldToScreen(vp, { x: frame.x + frame.w, y: frame.y + frame.h });
  return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
}

describe('boardPreviewViewport', () => {
  // The board plane is unbounded and boards live off-origin — this repo's
  // own board fixture has an element at x: -240. The preview used to mount
  // at a hard-coded {panX: 0, panY: 0, zoom: 1}, and a readOnly mount has no
  // wheel-pan, drag-pan or minimap, so that rendered an empty canvas the
  // user had no way to reach their content from.
  it('brings off-origin board content on screen', () => {
    const doc = parseBoardSnapshot(fixture('board'));
    const frames = doc.slides[0].elements.map((e) => e.frame);
    expect(frames.some((f) => f.x < 0)).toBe(true);

    // The old behaviour, kept here as the thing being fixed: at the origin
    // viewport the negative-x element is off the left edge of the host.
    const before = onScreen(frames.find((f) => f.x < 0)!, ORIGIN_VIEWPORT);
    expect(before.right).toBeLessThan(0);

    const vp = boardPreviewViewport(doc, HOST);
    for (const frame of frames) {
      const box = onScreen(frame, vp);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(HOST.w);
      expect(box.bottom).toBeLessThanOrEqual(HOST.h);
    }
  });

  it('centres the content in the host', () => {
    const doc = parseBoardSnapshot(fixture('board'));
    const frames = doc.slides[0].elements.map((e) => e.frame);
    const minX = Math.min(...frames.map((f) => f.x));
    const maxX = Math.max(...frames.map((f) => f.x + f.w));
    const minY = Math.min(...frames.map((f) => f.y));
    const maxY = Math.max(...frames.map((f) => f.y + f.h));

    const vp = boardPreviewViewport(doc, HOST);
    const centre = worldToScreen(vp, {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    });
    expect(centre.x).toBeCloseTo(HOST.w / 2, 5);
    expect(centre.y).toBeCloseTo(HOST.h / 2, 5);
  });

  // "Fitted to nothing" is not a thing: an empty board and an unmeasured
  // host both leave the default viewport in place, matching what
  // `createFitToContentOnce` does on the live board.
  it('falls back to the origin viewport when there is nothing to frame', () => {
    const empty = parseBoardSnapshot('{"meta":{"title":"Empty"},"elements":[]}');
    expect(boardPreviewViewport(empty, HOST)).toEqual(ORIGIN_VIEWPORT);

    const doc = parseBoardSnapshot(fixture('board'));
    expect(boardPreviewViewport(doc, { w: 0, h: 0 })).toEqual(ORIGIN_VIEWPORT);
  });

  // A single small sticky must not open at 40x — the live board clamps the
  // same way (`MAX_FIT_ZOOM`), and a magnified board reads as corrupted.
  it('never magnifies past 1:1', () => {
    const tiny = parseBoardSnapshot(
      '{"meta":{"title":"Tiny"},"elements":[{"id":"a","type":"shape",' +
        '"frame":{"x":10,"y":10,"w":20,"h":20,"rotation":0},' +
        '"data":{"kind":"rect"}}]}',
    );
    expect(boardPreviewViewport(tiny, HOST).zoom).toBeLessThanOrEqual(1);
  });
});
