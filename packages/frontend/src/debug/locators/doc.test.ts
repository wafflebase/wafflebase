import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOC_CAPTURE_BAND, locateDocPoint } from './doc';
import type { DocSurface } from '../surface-registry';
import { withBox } from '../test-box';

const PAGE = { x: 100, y: 50, w: 700, h: 900 };

function surface(overrides: Partial<DocSurface> = {}): DocSurface {
  const host = withBox(document.createElement('div'), PAGE);
  document.body.appendChild(host);
  return {
    kind: 'doc',
    positionAtClientPoint: () => ({ blockId: 'block-7', offset: 12 }),
    host,
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('locateDocPoint', () => {
  it('names the block and offset, with a band of page around it', () => {
    const target = locateDocPoint({ x: 400, y: 500 }, surface());
    expect(target).toEqual({
      kind: 'canvas',
      surface: 'doc',
      rect: {
        x: 400 - DOC_CAPTURE_BAND.w / 2,
        y: 500 - DOC_CAPTURE_BAND.h / 2,
        w: DOC_CAPTURE_BAND.w,
        h: DOC_CAPTURE_BAND.h,
      },
      address: 'block-7@12',
    });
  });

  it('keeps the band inside the host near an edge', () => {
    const target = locateDocPoint({ x: 110, y: 60 }, surface());
    expect(target?.rect.x).toBe(PAGE.x);
    expect(target?.rect.y).toBe(PAGE.y);
  });

  it('declines a point off the text — the engine does not clamp, and nor does this', () => {
    // A margin click resolves to nothing; naming the nearest paragraph anyway
    // would produce a report about a paragraph nobody aimed at.
    const empty = surface({ positionAtClientPoint: () => undefined });
    expect(locateDocPoint({ x: 400, y: 500 }, empty)).toBeUndefined();
  });

  it('declines a point outside the host', () => {
    expect(locateDocPoint({ x: 10, y: 10 }, surface())).toBeUndefined();
  });

  it('swallows an engine that throws', () => {
    const throwing = surface({
      positionAtClientPoint: vi.fn(() => {
        throw new Error('no layout yet');
      }),
    });
    expect(locateDocPoint({ x: 400, y: 500 }, throwing)).toBeUndefined();
  });
});
