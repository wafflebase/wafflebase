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
