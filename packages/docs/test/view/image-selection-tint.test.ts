// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { DocCanvas } from '../../src/view/doc-canvas.js';
import { imageIntersectsSelection } from '../../src/view/image-selection-overlay.js';
import { computeLayout, clearMeasureCache } from '../../src/view/layout.js';
import { paginateLayout, getPageXOffset } from '../../src/view/pagination.js';
import { computeSelectionRects } from '../../src/view/selection.js';
import { renderTableContent } from '../../src/view/table-renderer.js';
import type { LayoutTable } from '../../src/view/table-layout.js';
import type { TableData } from '../../src/model/types.js';
import { Theme } from '../../src/view/theme.js';
import {
  DEFAULT_PAGE_SETUP,
  getEffectiveDimensions,
  normalizeBlockStyle,
} from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';
import { stubMeasurer } from './_stub-measurer.js';

/**
 * A selection that covers exactly one image must tint exactly that image.
 *
 * `DocCanvas` re-fills a selected image with the selection colour because
 * the picture is opaque and hides the highlight painted under it. That fill
 * rounds its left/top edge, matching how `renderRun` places the image; the
 * *test* for whether to fill must stay in the unrounded layout coordinates
 * the selection rectangles use, or it compares a screen-space edge against
 * a layout-space one and the rounding shows up as overlap. Neighbours share
 * an edge exactly, so half a pixel is the whole margin: the touch becomes an
 * overlap and the neighbour is tinted too. Pasted images carry fractional
 * widths (`clampImageToWidth`), so the fraction accumulates along the row
 * and the first rounding that goes up lands around the third of several
 * adjacent images — which is where the artefact used to appear.
 *
 * The adjacent-image case is asserted by **running `DocCanvas.render`** and
 * reading the fills it emitted, not by re-deriving the render loop in the
 * test. `imageIntersectsSelection` is a plain rectangle test and cannot
 * express the defect on its own: the bug was in what the call site passed
 * it. A test that reimplements the loop would keep passing if `Math.round`
 * came back at the real call site, which is the only place it can return.
 */

const EMPTY = normalizeBlockStyle({});

interface FillCall {
  x: number;
  y: number;
  width: number;
  height: number;
  fillStyle: string;
}

/**
 * Canvas 2D stand-in that records `fillRect` together with the `fillStyle`
 * in force at the time, and answers everything else with a no-op. jsdom
 * ships no 2D context, and the render path only needs `measureText` to
 * return a shape.
 */
function makeRecordingCtx(): { ctx: CanvasRenderingContext2D; fills: FillCall[] } {
  const fills: FillCall[] = [];
  const props: Record<string, unknown> = { fillStyle: '' };
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'fillRect') {
        return (x: number, y: number, width: number, height: number) => {
          fills.push({ x, y, width, height, fillStyle: String(props.fillStyle) });
        };
      }
      if (prop === 'measureText') {
        return (text: string) => ({
          width: typeof text === 'string' ? text.length * 8 : 0,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        });
      }
      if (prop === 'canvas') return null;
      if (typeof prop === 'string' && prop in props) return props[prop];
      return () => {};
    },
    set(_t, prop, value) {
      if (typeof prop === 'string') props[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D, fills };
}

describe('imageIntersectsSelection', () => {
  const image = { x: 100, y: 0, width: 50, height: 40 };

  test('an overlapping rectangle intersects', () => {
    expect(imageIntersectsSelection(image, [{ x: 120, y: 0, width: 50, height: 40 }])).toBe(true);
  });

  test('a rectangle starting exactly at the right edge does not', () => {
    expect(imageIntersectsSelection(image, [{ x: 150, y: 0, width: 50, height: 40 }])).toBe(false);
  });

  test('a rectangle ending exactly at the left edge does not', () => {
    expect(imageIntersectsSelection(image, [{ x: 50, y: 0, width: 50, height: 40 }])).toBe(false);
  });

  test('a rectangle on the line below does not', () => {
    expect(imageIntersectsSelection(image, [{ x: 100, y: 40, width: 50, height: 40 }])).toBe(false);
  });

  test('a rectangle ending exactly at the top edge does not', () => {
    expect(imageIntersectsSelection(image, [{ x: 100, y: -40, width: 50, height: 40 }])).toBe(false);
  });

  test('any one of several rectangles is enough', () => {
    expect(imageIntersectsSelection(image, [
      { x: 0, y: 0, width: 10, height: 40 },
      { x: 120, y: 0, width: 10, height: 40 },
    ])).toBe(true);
  });
});

describe('DocCanvas tints only the image the selection covers', () => {
  // Fractional width, as `clampImageToWidth` produces for a pasted picture.
  // An integer width does not reproduce the defect: the row starts on a
  // whole pixel, so it takes an accumulating fraction to push a neighbour's
  // left edge across a rounding boundary.
  const W = 121.9;
  const H = 80;
  const COUNT = 4;
  const CANVAS_WIDTH = 900;
  const VIEWPORT_HEIGHT = 1400;

  let originalDpr: number;

  beforeEach(() => {
    clearMeasureCache();
    originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: originalDpr,
      configurable: true,
    });
  });

  /**
   * Render a document of `COUNT` adjacent images with image `selected`
   * covered by a one-offset text selection — the selection an image copy
   * installs — and report which images `DocCanvas` actually tinted.
   */
  function tintedIndicesFor(selected: number): number[] {
    const setup = DEFAULT_PAGE_SETUP;
    const { width } = getEffectiveDimensions(setup);
    const contentWidth = width - setup.margins.left - setup.margins.right;
    const inlines = Array.from({ length: COUNT }, (_, i) => ({
      text: '￼',
      style: { image: { src: `img${i}.png`, width: W, height: H } },
    }));
    const blocks: Block[] = [{ id: 'b1', type: 'paragraph', inlines, style: EMPTY }];
    const layout = computeLayout(blocks, stubMeasurer(), contentWidth).layout;
    const paginated = paginateLayout(layout, setup);

    const rects = computeSelectionRects(
      { anchor: { blockId: 'b1', offset: selected }, focus: { blockId: 'b1', offset: selected + 1 } },
      paginated, layout, stubMeasurer(), CANVAS_WIDTH,
    );
    expect(rects.length).toBeGreaterThan(0);

    const { ctx, fills } = makeRecordingCtx();
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = VIEWPORT_HEIGHT;
    (canvas as unknown as { getContext: (k: string) => unknown }).getContext = (k: string) =>
      k === '2d' ? ctx : null;

    new DocCanvas(canvas).render(
      paginated, 0, CANVAS_WIDTH, VIEWPORT_HEIGHT,
      undefined, rects, true, undefined, undefined, layout,
    );

    // Both the selection highlight and the image tint fill with
    // `Theme.selectionColor`, and they are told apart by order: the
    // highlight pass runs once per page before any run is drawn, so the
    // first `rects.length` selection-coloured fills are the highlight.
    // Asserting they match the selection rectangles exactly is what makes
    // that split a fact rather than an assumption.
    const selectionFills = fills.filter((f) => f.fillStyle === Theme.selectionColor);
    expect(selectionFills.slice(0, rects.length)).toEqual(
      rects.map((r) => ({ ...r, fillStyle: Theme.selectionColor })),
    );

    // Left edge each image is drawn at, in the same rounded screen space
    // the tint fill uses.
    const pageX = getPageXOffset(paginated, CANVAS_WIDTH);
    const imageLefts: number[] = [];
    for (const page of paginated.pages) {
      for (const pl of page.lines) {
        for (const run of pl.line.runs) {
          if (run.inline.style.image) imageLefts.push(Math.round(pageX + pl.x + run.x));
        }
      }
    }
    expect(imageLefts).toHaveLength(COUNT);

    return selectionFills
      .slice(rects.length)
      .map((f) => imageLefts.indexOf(f.x))
      .sort((a, b) => a - b);
  }

  for (let i = 0; i < COUNT; i++) {
    test(`image ${i + 1} of ${COUNT} tints only itself`, () => {
      expect(tintedIndicesFor(i)).toEqual([i]);
    });
  }
});

/**
 * The same rule inside a table cell. `renderTableContent` paints cell
 * content itself — `DocCanvas`'s run loop never sees it — so it carried its
 * own copy of the overlap test, with the same rounded coordinates.
 */
describe('renderTableContent tints only the cell image the selection covers', () => {
  const W = 121.9;
  const H = 80;
  const COUNT = 4;
  const PADDING = 4;
  // A fractional table origin, as `getPageXOffset` produces for a page
  // narrower than the canvas. It is what puts the image left edges either
  // side of a rounding boundary.
  const TABLE_X = 0.6;
  const TABLE_Y = 0;

  function makeCellFixture(): { tableData: TableData; tableLayout: LayoutTable; lefts: number[] } {
    const images = Array.from({ length: COUNT }, (_, i) => ({
      src: `cell${i}.png`,
      width: W,
      height: H,
    }));
    const runs = images.map((image, i) => ({
      inline: { text: '￼', style: { image } },
      text: '￼',
      x: W * i,
      width: W,
      inlineIndex: i,
      charStart: 0,
      charEnd: 1,
      charOffsets: [W],
      imageHeight: H,
    }));
    const layoutCell = {
      lines: [{ y: 0, height: H, width: W * COUNT, runs }],
      blockBoundaries: [0],
      width: W * COUNT + PADDING * 2,
      height: H + PADDING * 2,
      merged: false,
    };
    const tableData = {
      rows: [{
        cells: [{
          blocks: [{
            id: 'cell-block-0',
            type: 'paragraph' as const,
            style: normalizeBlockStyle({}),
            inlines: images.map((image) => ({ text: '￼', style: { image } })),
          }],
          style: { padding: PADDING },
        }],
      }],
      columnWidths: [1],
    } as unknown as TableData;
    const tableLayout = {
      cells: [[layoutCell]],
      columnXOffsets: [0],
      columnPixelWidths: [W * COUNT + PADDING * 2],
      rowYOffsets: [0],
      rowHeights: [H + PADDING * 2],
      totalWidth: W * COUNT + PADDING * 2,
      totalHeight: H + PADDING * 2,
      blockParentMap: new Map(),
    } as unknown as LayoutTable;

    // runX = cellX + padding + run.x, with cellX = TABLE_X + columnXOffsets[0].
    const lefts = runs.map((run) => Math.round(TABLE_X + PADDING + run.x));
    return { tableData, tableLayout, lefts };
  }

  function tintedIndicesFor(selected: number): number[] {
    const { tableData, tableLayout, lefts } = makeCellFixture();
    // A one-offset selection over image `selected`, in the unrounded
    // coordinates `computeSelectionRects` would produce for it.
    const left = TABLE_X + PADDING + W * selected;
    const top = TABLE_Y + PADDING;
    const rects = [{ x: left, y: top, width: W, height: H }];

    const { ctx, fills } = makeRecordingCtx();
    renderTableContent(
      ctx, tableData, tableLayout, TABLE_X, TABLE_Y,
      0, undefined, undefined, undefined, undefined, rects, true,
    );

    // Unlike the body path, `renderTableContent` paints no selection
    // highlight of its own, so every selection-coloured fill here is a tint.
    return fills
      .filter((f) => f.fillStyle === Theme.selectionColor)
      .map((f) => lefts.indexOf(f.x))
      .sort((a, b) => a - b);
  }

  for (let i = 0; i < COUNT; i++) {
    test(`cell image ${i + 1} of ${COUNT} tints only itself`, () => {
      expect(tintedIndicesFor(i)).toEqual([i]);
    });
  }
});
