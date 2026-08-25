import { beforeEach, describe, expect, it } from 'vitest';
import { FALLBACK_REGION } from '../index';
import { locatePoint } from './locate';

const canvasAt = (x: number, y: number, w: number, h: number) => [
  { box: { x, y, w, h } },
];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('locatePoint', () => {
  it('asks the host when the point is on a canvas', () => {
    // The canvas branch is a HOST CONCERN: only the mounted engine can say which
    // cell a point is, so this package takes it as a function and this test
    // stubs that function rather than an engine.
    const target = locatePoint(
      { x: 50, y: 50 },
      {
        layers: canvasAt(0, 0, 200, 200),
        locateOnCanvas: () => ({
          kind: 'canvas' as const,
          surface: 'sheet',
          address: 'Sheet1!B2',
          rect: { x: 0, y: 0, w: 10, h: 10 },
        }),
      },
    );
    expect(target).toEqual({
      kind: 'canvas',
      surface: 'sheet',
      address: 'Sheet1!B2',
      rect: { x: 0, y: 0, w: 10, h: 10 },
    });
  });

  it('degrades to a region when the host locator declines', () => {
    // A locator that cannot name the point is a normal answer — the engine may
    // have no cell there — and the point becomes a region rather than a
    // photograph of the whole surface.
    const target = locatePoint(
      { x: 50, y: 50 },
      { layers: canvasAt(0, 0, 200, 200), locateOnCanvas: () => undefined },
    );
    expect(target.kind).toBe('viewport');
  });

  it('degrades to a small region on a canvas with no host locator', () => {
    const target = locatePoint(
      { x: 500, y: 400 },
      { layers: canvasAt(0, 0, 1000, 800), viewport: { w: 1000, h: 800 } },
    );
    expect(target).toEqual({
      kind: 'viewport',
      rect: {
        x: 500 - FALLBACK_REGION.w / 2,
        y: 400 - FALLBACK_REGION.h / 2,
        w: FALLBACK_REGION.w,
        h: FALLBACK_REGION.h,
      },
    });
  });

  it('promotes to the nearest control off the canvas', () => {
    document.body.innerHTML = '<button><svg><path id="glyph"/></svg></button>';
    const glyph = document.querySelector('#glyph')!;
    const target = locatePoint(
      { x: 10, y: 10 },
      { layers: [], elementAt: () => glyph, viewport: { w: 800, h: 600 } },
    );
    expect(target.kind).toBe('dom');
    if (target.kind === 'dom') expect(target.tag).toBe('button');
  });

  it('describes a region rather than naming a meaningless ancestor', () => {
    // The container-fallback trap: with nothing meaningful above the point, a
    // promotion would name a `div` nobody aimed at.
    document.body.innerHTML = '<div><div><span id="leaf">x</span></div></div>';
    const leaf = document.querySelector('#leaf')!;
    const target = locatePoint(
      { x: 10, y: 10 },
      { layers: [], elementAt: () => leaf, viewport: { w: 800, h: 600 } },
    );
    expect(target.kind).toBe('viewport');
  });

  it('still returns a target when nothing at all is under the point', () => {
    // A capture keystroke must never be a silent no-op.
    const target = locatePoint(
      { x: 10, y: 10 },
      { layers: [], elementAt: () => null, viewport: { w: 800, h: 600 } },
    );
    expect(target.kind).toBe('viewport');
  });
});

/**
 * Ported from the frontend suite this file replaced.
 *
 * The move to the package dropped these four, which is why they are called out:
 * they are the regressions that made `locatePoint` what it is — a promotion rule
 * with a plausibility ceiling, and a canvas branch that loses to a real control
 * on top of it. The engine surface they used is now the injected
 * `locateOnCanvas`, so what they assert is unchanged and what they inject is one
 * function instead of a registry.
 */
const boxed = (html: string, box: { x: number; y: number; w: number; h: number }) => {
  document.body.innerHTML = html;
  const el = document.body.firstElementChild!;
  el.getBoundingClientRect = () =>
    ({
      x: box.x,
      y: box.y,
      left: box.x,
      top: box.y,
      right: box.x + box.w,
      bottom: box.y + box.h,
      width: box.w,
      height: box.h,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
};

describe('locatePoint · plausibility', () => {
  it('describes a region rather than naming a page-sized element', () => {
    // `main[data-testid]` matches the promotion selector but is not what anyone
    // aimed at; naming it produced a 1280×800 capture of the whole page.
    const root = boxed('<main data-testid="app-root"><span id="leaf">x</span></main>', {
      x: 0,
      y: 0,
      w: 1280,
      h: 800,
    });
    const target = locatePoint(
      { x: 5, y: 5 },
      { layers: [], elementAt: () => root, viewport: { w: 1280, h: 800 } },
    );
    expect(target.kind).toBe('viewport');
    expect(target.rect.w).toBe(FALLBACK_REGION.w);
  });

  it('still names a normal control', () => {
    const button = boxed('<button id="b">Save</button>', { x: 10, y: 10, w: 80, h: 32 });
    const target = locatePoint(
      { x: 20, y: 20 },
      { layers: [], elementAt: () => button, viewport: { w: 1280, h: 800 } },
    );
    expect(target.kind).toBe('dom');
  });
});

describe('locatePoint · a DOM control over a canvas', () => {
  /** A canvas covering the viewport, as the sheet's grid does. */
  const grid = canvasAt(0, 0, 1280, 800);

  /** What a host locator answers for any point on that grid. */
  const cell = () => ({
    kind: 'canvas' as const,
    surface: 'sheet',
    address: 'Sheet1!D3',
    rect: { x: 0, y: 0, w: 80, h: 21 },
  });

  it('names the control, not the cell underneath it', () => {
    // The sheet parks its filter panel, list/date popovers, validation tooltip
    // and cell input inside the grid's box. Asking the canvas locator first
    // meant aiming at the filter dropdown reported `Sheet1!D3` with a picture of
    // one cell, and the control appeared nowhere in the report.
    const control = boxed('<button aria-label="Filter">Filter</button>', {
      x: 200,
      y: 300,
      w: 120,
      h: 32,
    });
    const target = locatePoint(
      { x: 220, y: 310 },
      {
        layers: grid,
        elementAt: () => control,
        viewport: { w: 1280, h: 800 },
        locateOnCanvas: cell,
      },
    );
    expect(target.kind).toBe('dom');
    if (target.kind === 'dom') expect(target.tag).toBe('button');
  });

  it('still asks the host when the hit-test lands on the canvas itself', () => {
    const canvas = boxed('<canvas></canvas>', { x: 0, y: 0, w: 1280, h: 800 });
    const target = locatePoint(
      { x: 220, y: 310 },
      {
        layers: grid,
        elementAt: () => canvas,
        viewport: { w: 1280, h: 800 },
        locateOnCanvas: cell,
      },
    );
    // The `<canvas>` element must never be named as a DOM target: it is the
    // surface, not the thing on it.
    expect(target).toEqual(cell());
  });

  it('degrades to a region on the canvas itself when no host locator answers', () => {
    const canvas = boxed('<canvas></canvas>', { x: 0, y: 0, w: 1280, h: 800 });
    const target = locatePoint(
      { x: 220, y: 310 },
      { layers: grid, elementAt: () => canvas, viewport: { w: 1280, h: 800 } },
    );
    expect(target.kind).toBe('viewport');
  });
});
