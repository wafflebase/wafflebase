import { describe, expect, it } from 'vitest';
import { GridCanvas, RenderedLink } from '../../src/view/gridcanvas';
import {
  BoundingRect,
  CellFontSize,
  CellLineHeight,
  CellPaddingX,
  CellPaddingY,
} from '../../src/view/layout';
import { CellStyle } from '../../src/model/core/types';

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

/**
 * The paint path itself: `renderCellContent` is where detection, segmentation,
 * link color, the per-span underline and the hit-box recording actually meet,
 * and every one of those is arithmetic the two leaf helpers above never see.
 *
 * Driven against a mock 2D context, the way `gridcanvas.test.ts` drives
 * `renderCellCheckbox` — the sheets view suite runs in Vitest's node
 * environment, so there is no real canvas to measure against. `measureText`
 * returns a fixed width per character, which makes every expected coordinate
 * below plain arithmetic.
 */
const CHAR_WIDTH = 7;
const TEXT_COLOR = '#111111';
const LINK_COLOR = '#0000ee';

type Painted = { text: string; x: number; y: number; color: string };
type Stroked = { from: number; to: number; y: number; color: string };

type PaintCtx = {
  painted: Array<Painted>;
  stroked: Array<Stroked>;
};

function makePaintCtx() {
  const painted: Array<Painted> = [];
  const stroked: Array<Stroked> = [];
  let pending: { x: number; y: number } | null = null;
  const ctx = {
    painted,
    stroked,
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    lineWidth: 0,
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    measureText: (text: string) => ({ width: text.length * CHAR_WIDTH }),
    fillText(text: string, x: number, y: number) {
      painted.push({ text, x, y, color: ctx.fillStyle });
    },
    moveTo(x: number, y: number) {
      pending = { x, y };
    },
    lineTo(x: number, y: number) {
      if (pending) stroked.push({ from: pending.x, to: x, y, color: '' });
      pending = null;
    },
    stroke() {
      const last = stroked[stroked.length - 1];
      if (last) last.color = ctx.strokeStyle;
    },
  };
  return ctx;
}

const renderCellContent = (
  GridCanvas.prototype as unknown as {
    renderCellContent: (...args: unknown[]) => void;
  }
).renderCellContent;

/** A cell wide enough that nothing below is clipped by accident. */
const PAINT_RECT: BoundingRect = {
  left: 100,
  top: 60,
  width: 400,
  height: 60,
};

function paint(value: string, style?: CellStyle, formula?: string) {
  const ctx = makePaintCtx();
  const thisArg = {
    renderedLinks: [] as Array<RenderedLink>,
    paintRegion: { left: 0, top: 0, width: 2000, height: 2000 },
    toCellRect: () => PAINT_RECT,
    toCellFont: () => `${CellFontSize}px sans-serif`,
    getThemeColor: (key: string) =>
      key === 'cellLinkColor' ? LINK_COLOR : TEXT_COLOR,
    recordRenderedLink: (
      GridCanvas.prototype as unknown as {
        recordRenderedLink: (...args: unknown[]) => void;
      }
    ).recordRenderedLink,
  };
  renderCellContent.call(
    thisArg,
    ctx,
    { r: 1, c: 1 },
    { v: value, s: style, f: formula },
    { left: 0, top: 0 },
    undefined,
    undefined,
    style,
  );
  return { ctx: ctx as unknown as PaintCtx, links: thisArg.renderedLinks };
}

/** Where a left-aligned line starts, and where the character at `index` does. */
const lineStart = PAINT_RECT.left + CellPaddingX;
const at = (index: number) => lineStart + index * CHAR_WIDTH;
const lineTop = (i: number) =>
  PAINT_RECT.top + CellPaddingY + i * (CellFontSize * CellLineHeight);

describe('renderCellContent hyperlink painting', () => {
  const URL = 'https://example.com';

  it('paints a plain cell as one run in the text color', () => {
    const { ctx, links } = paint('just text');
    expect(ctx.painted).toEqual([
      { text: 'just text', x: lineStart, y: lineTop(0), color: TEXT_COLOR },
    ]);
    expect(ctx.stroked).toEqual([]);
    expect(links).toEqual([]);
  });

  it('splits the line so every glyph is painted exactly once', () => {
    // Repainting the link on top of the whole line would stack two
    // anti-aliased renderings and read as bold, so the segments must tile.
    const { ctx } = paint(`PR: ${URL} ok`);
    expect(ctx.painted).toEqual([
      { text: 'PR: ', x: at(0), y: lineTop(0), color: TEXT_COLOR },
      { text: URL, x: at(4), y: lineTop(0), color: LINK_COLOR },
      { text: ' ok', x: at(4 + URL.length), y: lineTop(0), color: TEXT_COLOR },
    ]);
    expect(ctx.painted.map((p) => p.text).join('')).toBe(`PR: ${URL} ok`);
  });

  it('underlines the span alone, in the link color', () => {
    const { ctx } = paint(`PR: ${URL} ok`);
    expect(ctx.stroked).toEqual([
      {
        from: at(4),
        to: at(4 + URL.length),
        y: lineTop(0) + CellFontSize + 1,
        color: LINK_COLOR,
      },
    ]);
  });

  it('records a hit box under the glyphs it painted', () => {
    const { ctx, links } = paint(`PR: ${URL} ok`);
    const span = ctx.painted[1];
    expect(links).toEqual([
      {
        sref: 'A1',
        left: span.x,
        top: span.y,
        width: URL.length * CHAR_WIDTH,
        height: CellFontSize + 3,
        url: URL,
      },
    ]);
  });

  it('records one box per line of a multi-line cell', () => {
    const { links } = paint(`a ${URL}\nb https://other.example`);
    expect(links.map((l) => [l.url, l.top, l.left])).toEqual([
      [URL, lineTop(0), at(2)],
      ['https://other.example', lineTop(1), at(2)],
    ]);
  });

  it('places a span by the aligned line start, not the cell edge', () => {
    const { ctx, links } = paint(URL, { al: 'right' });
    // Right-aligned: the line ends at the cell's right padding edge, so the
    // span starts a whole line-width back from there.
    const right = PAINT_RECT.left + PAINT_RECT.width - CellPaddingX;
    expect(ctx.painted[0].x).toBe(right - URL.length * CHAR_WIDTH);
    expect(links[0].left).toBe(right - URL.length * CHAR_WIDTH);
  });

  it('draws one underline, not two, when the cell is already underlined', () => {
    const { ctx } = paint(`PR: ${URL}`, { u: true });
    expect(ctx.stroked).toEqual([
      {
        from: lineStart,
        to: at(`PR: ${URL}`.length),
        y: lineTop(0) + CellFontSize + 1,
        color: TEXT_COLOR,
      },
    ]);
  });

  it('keeps an explicit text color over the link color', () => {
    const { ctx } = paint(URL, { tc: '#ff0000' });
    expect(ctx.painted[0].color).toBe('#ff0000');
    expect(ctx.stroked[0].color).toBe('#ff0000');
  });

  it('links a formula cell by its rendered value', () => {
    // Formula cells used to be skipped wholesale, which cost `=A1&"/"&B1` and
    // a single-argument `=HYPERLINK("https://…")` their link.
    const { links } = paint(URL, undefined, '=A1&"/"&B1');
    expect(links.map((l) => l.url)).toEqual([URL]);
  });

  it('records nothing for a cell with no link', () => {
    expect(paint('2026-09-17 plan').links).toEqual([]);
  });
});
