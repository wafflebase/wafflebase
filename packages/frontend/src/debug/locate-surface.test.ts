import { afterEach, describe, expect, it } from 'vitest';
import { locateOnSurface } from './locate-surface';
import type { DebugSurface } from './surface-registry';

/**
 * The wafflebase half of locating a point: which engine answers, and what it
 * says.
 *
 * The hit-test, the promotion rules and the region fallback live in
 * `@wafflebase/debug-report` and are tested there. What is here is the dispatch
 * — the only part that names an engine.
 *
 * EVERY ASSERTION BELOW NAMES AN ADDRESS. An earlier version of this file
 * asserted `toBeUndefined()` three times, because jsdom lays nothing out and
 * both locators correctly decline on a zero-sized host — so a `locateOnSurface`
 * that ignored its argument and returned `undefined` passed all three. The
 * geometry is stubbed here instead, which is what makes a wrong dispatch fail.
 */

const boxed = (el: Element, box: { x: number; y: number; w: number; h: number }) => {
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

/** A host laid out like a mounted sheet: a grid canvas filling it. */
function sheetHost(): HTMLElement {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  document.body.appendChild(host);
  boxed(host, { x: 0, y: 0, w: 1280, h: 720 });
  boxed(canvas, { x: 0, y: 43, w: 1280, h: 677 });
  return host;
}

function docHost(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  boxed(host, { x: 0, y: 0, w: 816, h: 1056 });
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('locateOnSurface', () => {
  it('is undefined with no surface registered', () => {
    expect(locateOnSurface({ x: 0, y: 0 }, undefined)).toBeUndefined();
  });

  it('routes a sheet surface to the sheet locator, which names the cell', () => {
    const surface: DebugSurface = {
      kind: 'sheet',
      cellRefFromPoint: () => ({ r: 7, c: 3 }),
      cellRect: () => ({ left: 160, top: 126, width: 80, height: 21 }),
      host: sheetHost(),
    };
    const target = locateOnSurface({ x: 200, y: 200 }, surface);
    expect(target).toMatchObject({ kind: 'canvas', surface: 'sheet', address: 'C7' });
    // The cell rect is CANVAS-relative and the sheet paints 43px of chrome above
    // it, so the canvas origin is what must be added — adding the container's
    // would land the rectangle two rows high without changing the address.
    expect(target?.rect).toEqual({ x: 160, y: 43 + 126, w: 80, h: 21 });
  });

  it('routes a doc surface to the doc locator, which names the block', () => {
    const surface: DebugSurface = {
      kind: 'doc',
      positionAtClientPoint: () => ({ blockId: 'b1', offset: 4 }),
      host: docHost(),
    };
    const target = locateOnSurface({ x: 400, y: 500 }, surface);
    expect(target).toMatchObject({
      kind: 'canvas',
      surface: 'doc',
      address: 'b1@4',
    });
  });

  it('asks only the engine that is registered', () => {
    // A sheet surface must never reach the doc locator: a `blockId@offset`
    // address for a spreadsheet report is worse than no address, because it
    // reads like a real one.
    const sheet: DebugSurface = {
      kind: 'sheet',
      cellRefFromPoint: () => ({ r: 1, c: 1 }),
      cellRect: () => ({ left: 0, top: 0, width: 80, height: 21 }),
      host: sheetHost(),
    };
    const target = locateOnSurface({ x: 100, y: 100 }, sheet);
    expect(target).toMatchObject({ surface: 'sheet' });
    expect(target).not.toMatchObject({ surface: 'doc' });
  });

  it('declines rather than guessing when the point is off the grid', () => {
    const surface: DebugSurface = {
      kind: 'sheet',
      cellRefFromPoint: () => ({ r: 7, c: 3 }),
      cellRect: () => ({ left: 0, top: 0, width: 80, height: 21 }),
      host: sheetHost(),
    };
    // Above the canvas: inside the host, in the sheet's chrome band.
    expect(locateOnSurface({ x: 200, y: 10 }, surface)).toBeUndefined();
  });

  it('declines when the engine refuses the point', () => {
    const surface: DebugSurface = {
      kind: 'doc',
      positionAtClientPoint: () => undefined,
      host: docHost(),
    };
    expect(locateOnSurface({ x: 400, y: 500 }, surface)).toBeUndefined();
  });
});
