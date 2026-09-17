import { describe, expect, it } from 'vitest';
import { GridCanvas, RenderedLink } from '../../src/view/gridcanvas';
import { BoundingRect } from '../../src/view/layout';

/**
 * `recordRenderedLink` and `linkAt` drive interaction, not pixels, so they are
 * exercised against a hand-built `this` the way `worksheet-mouse.test.ts`
 * drives the mouse handlers. That keeps them reachable without a DOM: the
 * sheets view suite runs in Vitest's node environment and `GridCanvas`'s
 * constructor calls `document.createElement`.
 */
type RecordContext = {
  renderedLinks: Array<RenderedLink>;
  paintRegion: BoundingRect;
};

const recordRenderedLink = (
  GridCanvas.prototype as unknown as {
    recordRenderedLink(
      sref: string,
      box: { x: number; width: number; url: string },
      textY: number,
      rect: BoundingRect,
      clipWidth: number,
    ): void;
  }
).recordRenderedLink;

const linkAt = (
  GridCanvas.prototype as unknown as {
    linkAt(x: number, y: number): RenderedLink | null;
  }
).linkAt;

/** A cell wide enough that clipping is never the cell's own doing. */
const CELL: BoundingRect = { left: 200, top: 100, width: 120, height: 40 };
const BOX = { x: 210, width: 60, url: 'https://example.com' };

function record(paintRegion: BoundingRect, textY = 104): Array<RenderedLink> {
  const ctx: RecordContext = { renderedLinks: [], paintRegion };
  recordRenderedLink.call(ctx, 'C5', BOX, textY, CELL, CELL.width);
  return ctx.renderedLinks;
}

describe('recordRenderedLink', () => {
  // The whole grid area, i.e. nothing outside the cell constrains the span.
  const openRegion: BoundingRect = {
    left: 0,
    top: 0,
    width: 1000,
    height: 1000,
  };

  it('records a span the paint region fully contains', () => {
    expect(record(openRegion)).toEqual([
      { sref: 'C5', left: 210, top: 104, width: 60, height: 16, url: BOX.url },
    ]);
  });

  it('drops a span scrolled behind a frozen pane', () => {
    // Quadrant D is clipped to the right of the frozen columns. A cell
    // scrolled underneath still has a rect there, and its text is not drawn —
    // so nothing may be clickable there either. This is the case where the
    // click guard does not save us: a read-only viewer plain-clicking a frozen
    // cell would otherwise open a URL from a cell they cannot see.
    const quadrantD: BoundingRect = {
      left: 400,
      top: 0,
      width: 600,
      height: 1000,
    };
    expect(record(quadrantD)).toEqual([]);
  });

  it('trims a span straddling the frozen edge to the visible part', () => {
    const quadrantD: BoundingRect = {
      left: 240,
      top: 0,
      width: 600,
      height: 1000,
    };
    expect(record(quadrantD)).toEqual([
      { sref: 'C5', left: 240, top: 104, width: 30, height: 16, url: BOX.url },
    ]);
  });

  it('drops a span under the column header', () => {
    // The unfrozen branch applies no clip at all — the headers are painted
    // over the cells afterwards — so the recorded region is what keeps a
    // half-scrolled top row from being hoverable through the header. The cell
    // is placed *inside* the header strip, so its own rect cannot be what
    // rejects the span.
    const scrolledUnderHeader: BoundingRect = {
      left: 200,
      top: 2,
      width: 120,
      height: 20,
    };
    const belowHeaders: BoundingRect = {
      left: 50,
      top: 23,
      width: 1000,
      height: 1000,
    };
    const ctx: RecordContext = { renderedLinks: [], paintRegion: belowHeaders };
    recordRenderedLink.call(
      ctx,
      'C1',
      BOX,
      4,
      scrolledUnderHeader,
      scrolledUnderHeader.width,
    );
    expect(ctx.renderedLinks).toEqual([]);
  });

  it('drops a span left of the row header', () => {
    const rightOfHeaders: BoundingRect = {
      left: 300,
      top: 0,
      width: 1000,
      height: 1000,
    };
    expect(record(rightOfHeaders)).toEqual([]);
  });
});

describe('linkAt', () => {
  const link: RenderedLink = {
    sref: 'C5',
    left: 210,
    top: 104,
    width: 60,
    height: 16,
    url: 'https://example.com',
  };
  const ctx = { renderedLinks: [link] };

  it('finds the span under the point', () => {
    expect(linkAt.call(ctx, 240, 110)).toBe(link);
  });

  it.each([
    ['left of it', 209, 110],
    ['right of it', 271, 110],
    ['above it', 240, 103],
    ['below it', 240, 121],
  ])('returns null %s', (_label, x, y) => {
    expect(linkAt.call(ctx, x, y)).toBeNull();
  });
});
