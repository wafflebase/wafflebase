import { beforeEach, describe, expect, it } from 'vitest';
import { FALLBACK_REGION } from '@wafflebase/debug-report';
import { locatePoint, locateOnSurface } from './locate';
import type { DebugSurface } from './surface-registry';

const canvasAt = (x: number, y: number, w: number, h: number) => [
  { box: { x, y, w, h } },
];

const sheetSurface = (address = 'Sheet1!C7'): DebugSurface => ({
  kind: 'sheet',
  cellRefFromPoint: () => ({ r: 7, c: 3 }),
  cellRect: () => ({ left: 100, top: 50, width: 80, height: 20 }),
  sheetName: () => address.split('!')[0],
  host: document.body,
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('locatePoint', () => {
  it('asks the engine when the point is on a canvas', () => {
    // jsdom gives every element a zero box, so the host rect makes the sheet
    // locator refuse — which is itself the behaviour under test below. Here the
    // surface is stubbed at the routing level.
    const target = locatePoint(
      { x: 50, y: 50 },
      {
        layers: canvasAt(0, 0, 200, 200),
        surface: {
          kind: 'sheet',
          cellRefFromPoint: () => ({ r: 1, c: 1 }),
          cellRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
          host: document.body,
        },
      },
    );
    // The stub host has no canvas child, so the locator declines and the point
    // degrades to a region — never to a photograph of the whole surface.
    expect(target.kind).toBe('viewport');
  });

  it('degrades to a small region on a canvas with no locator', () => {
    const target = locatePoint(
      { x: 500, y: 400 },
      { layers: canvasAt(0, 0, 1000, 800), surface: undefined, viewport: { w: 1000, h: 800 } },
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

describe('locateOnSurface', () => {
  it('is undefined with no surface registered', () => {
    expect(locateOnSurface({ x: 0, y: 0 }, undefined)).toBeUndefined();
  });

  it('routes a sheet surface to the sheet locator', () => {
    // The locator refuses without a measurable canvas, which proves the routing
    // reached it rather than silently returning a stub value.
    expect(locateOnSurface({ x: 0, y: 0 }, sheetSurface())).toBeUndefined();
  });

  it('routes a doc surface to the doc locator', () => {
    const surface: DebugSurface = {
      kind: 'doc',
      positionAtClientPoint: () => ({ blockId: 'b1', offset: 4 }),
      host: document.body,
    };
    // jsdom's zero-sized host puts every point outside it, so this refuses —
    // again proving the call reached the doc locator.
    expect(locateOnSurface({ x: 5, y: 5 }, surface)).toBeUndefined();
  });
});

describe('locatePoint · plausibility', () => {
  it('describes a region rather than naming a page-sized element', () => {
    // `main[data-testid]` matches the promotion selector but is not what anyone
    // aimed at; naming it produced a 1280×800 capture of the whole page.
    document.body.innerHTML = '<main data-testid="app-root"><span id="leaf">x</span></main>';
    const root = document.querySelector('main')!;
    root.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800, toJSON: () => ({}) }) as DOMRect;
    const target = locatePoint(
      { x: 5, y: 5 },
      { layers: [], elementAt: () => root, viewport: { w: 1280, h: 800 } },
    );
    expect(target.kind).toBe('viewport');
    expect(target.rect.w).toBe(FALLBACK_REGION.w);
  });

  it('still names a normal control', () => {
    document.body.innerHTML = '<button id="b">Save</button>';
    const button = document.querySelector('#b')!;
    button.getBoundingClientRect = () =>
      ({ x: 10, y: 10, left: 10, top: 10, right: 90, bottom: 42, width: 80, height: 32, toJSON: () => ({}) }) as DOMRect;
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

  it('names the control, not the cell underneath it', () => {
    // The sheet parks its filter panel, list/date popovers, validation tooltip
    // and cell input inside the grid's box. Asking `onCanvas` first meant
    // aiming at the filter dropdown reported `Sheet1!D3` with a picture of one
    // cell, and the control appeared nowhere in the report.
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
        surface: {
          kind: 'sheet',
          cellRefFromPoint: () => ({ r: 3, c: 4 }),
          cellRect: () => ({ left: 0, top: 0, width: 80, height: 21 }),
          host: document.body,
        },
      },
    );
    expect(target.kind).toBe('dom');
    if (target.kind === 'dom') expect(target.tag).toBe('button');
  });

  it('still asks the engine when the hit-test lands on the canvas itself', () => {
    const canvas = boxed('<canvas></canvas>', { x: 0, y: 0, w: 1280, h: 800 });
    const target = locatePoint(
      { x: 220, y: 310 },
      { layers: grid, elementAt: () => canvas, viewport: { w: 1280, h: 800 } },
    );
    // No surface registered here, so it degrades to a region — but it must not
    // have named the `<canvas>` element as a DOM target either.
    expect(target.kind).toBe('viewport');
  });
});
