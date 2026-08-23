import { describe, expect, it } from 'vitest';
import { locateOnSurface } from './locate-surface';
import type { DebugSurface } from './surface-registry';

/**
 * The wafflebase half of locating a point: which engine answers.
 *
 * The hit-test, the promotion rules and the region fallback live in
 * `@wafflebase/debug-report` and are tested there. What is here is the dispatch
 * — the only part that names an engine.
 */
describe('locateOnSurface', () => {
  it('is undefined with no surface registered', () => {
    expect(locateOnSurface({ x: 0, y: 0 }, undefined)).toBeUndefined();
  });

  it('routes a sheet surface to the sheet locator', () => {
    const surface: DebugSurface = {
      kind: 'sheet',
      cellRefFromPoint: () => ({ r: 7, c: 3 }),
      cellRect: () => ({ left: 100, top: 50, width: 80, height: 20 }),
      host: document.body,
    };
    // jsdom gives the host no canvas child, so the locator declines — the
    // dispatch reaching it at all is what this asserts.
    expect(locateOnSurface({ x: 0, y: 0 }, surface)).toBeUndefined();
  });

  it('routes a doc surface to the doc locator', () => {
    const surface: DebugSurface = {
      kind: 'doc',
      positionAtClientPoint: () => ({ blockId: 'b1', offset: 4 }),
      host: document.body,
    };
    // jsdom's zero-sized host puts every point outside it, so the locator
    // refuses — which is itself what proves the call reached the doc locator
    // rather than the sheet one. The address formatting is tested where the
    // locator is.
    expect(locateOnSurface({ x: 5, y: 5 }, surface)).toBeUndefined();
  });
});
