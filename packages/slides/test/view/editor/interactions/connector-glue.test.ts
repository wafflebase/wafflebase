import { describe, expect, it } from 'vitest';
import type { Element } from '../../../../src/model/element';
import type { ConnectorElement } from '../../../../src/model/connector';
import {
  acceptsBodyGlue,
  findBodyGlue,
  nearestSiteIndex,
} from '../../../../src/view/editor/interactions/connector-glue';
import {
  buildConnectorInit,
  findGlueTarget,
  snappedEndpoint,
} from '../../../../src/view/editor/interactions/insert-connector';
import { endpointGlueOptions } from '../../../../src/view/editor/interactions/connector-endpoint-drag';
import { resolveEndpoint } from '../../../../src/view/canvas/connector-frame';

const shape = (
  id: string,
  x: number,
  y: number,
  w = 200,
  h = 100,
  kind = 'rect',
  rotation = 0,
): Element =>
  ({
    id,
    type: 'shape',
    frame: { x, y, w, h, rotation },
    data: { kind },
  }) as Element;

describe('acceptsBodyGlue', () => {
  it('accepts ordinary shapes (stickies are roundRect shapes)', () => {
    expect(acceptsBodyGlue(shape('a', 0, 0))).toBe(true);
    expect(acceptsBodyGlue(shape('a', 0, 0, 100, 100, 'roundRect'))).toBe(true);
  });

  it('rejects freeform strokes, connectors and non-shape elements', () => {
    expect(acceptsBodyGlue(shape('a', 0, 0, 100, 100, 'freeform'))).toBe(false);
    expect(
      acceptsBodyGlue({ id: 'c', type: 'connector' } as unknown as Element),
    ).toBe(false);
    expect(
      acceptsBodyGlue({
        id: 't',
        type: 'text',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { blocks: [] },
      } as unknown as Element),
    ).toBe(false);
  });
});

describe('nearestSiteIndex', () => {
  // fourCardinal order: N(0), E(1), S(2), W(3).
  const el = shape('a', 0, 0, 200, 100);
  it.each([
    [{ x: 100, y: 10 }, 0],
    [{ x: 190, y: 50 }, 1],
    [{ x: 100, y: 95 }, 2],
    [{ x: 5, y: 50 }, 3],
  ])('cursor %o picks site %i', (cursor, expected) => {
    expect(nearestSiteIndex(el, cursor)).toBe(expected);
  });

  it('respects rotation (a 90° turn moves N to the right edge)', () => {
    const rotated = shape('a', 0, 0, 200, 100, 'rect', Math.PI / 2);
    // Centre (100, 50). Rotated 90° clockwise, the N site (100, 0)
    // lands at (150, 50).
    expect(nearestSiteIndex(rotated, { x: 145, y: 50 })).toBe(0);
  });
});

describe('findBodyGlue', () => {
  it('returns the topmost containing shape and its nearest site', () => {
    const below = shape('below', 0, 0, 400, 400);
    const above = shape('above', 100, 100, 200, 100);
    const hit = findBodyGlue({ x: 280, y: 150 }, [below, above]);
    expect(hit).toMatchObject({ elementId: 'above', siteIndex: 1 });
    expect(hit).toMatchObject({ worldX: 300, worldY: 150 });
  });

  it('returns null outside every body', () => {
    expect(findBodyGlue({ x: 999, y: 999 }, [shape('a', 0, 0)])).toBeNull();
  });

  it('skips the excluded element and falls through to the one below', () => {
    const below = shape('below', 0, 0, 400, 400);
    const above = shape('above', 100, 100, 200, 100);
    const hit = findBodyGlue({ x: 280, y: 150 }, [below, above], 'above');
    expect(hit?.elementId).toBe('below');
  });
});

describe('findGlueTarget precedence', () => {
  it('a site within the snap radius beats body glue', () => {
    // Cursor inside `big`'s body but within 12px of `small`'s W site.
    const big = shape('big', 0, 0, 1000, 1000);
    const small = shape('small', 500, 500, 100, 100);
    // small W site = (500, 550); cursor 5px left of it, inside `big`.
    const hit = findGlueTarget({ x: 495, y: 550 }, [small, big], 1);
    expect(hit).toMatchObject({ elementId: 'small', siteIndex: 3, via: 'site' });
  });

  it('falls back to body glue when no site is in range', () => {
    const hit = findGlueTarget({ x: 60, y: 50 }, [shape('a', 0, 0)], 1);
    expect(hit).toMatchObject({ elementId: 'a', via: 'body' });
  });
});

describe('snappedEndpoint body glue', () => {
  it('attaches when dropped on the body, far from any site', () => {
    const ep = snappedEndpoint({ x: 170, y: 40 }, [shape('a', 0, 0)], 1);
    expect(ep).toEqual({ kind: 'attached', elementId: 'a', siteIndex: 1 });
  });

  it('stays free on a freeform stroke bbox', () => {
    const ep = snappedEndpoint(
      { x: 100, y: 50 },
      [shape('ink', 0, 0, 200, 100, 'freeform')],
      1,
    );
    expect(ep.kind).toBe('free');
  });

  it('keeps the endpoint glued when the shape moves', () => {
    const a = shape('a', 0, 0);
    const ep = snappedEndpoint({ x: 170, y: 40 }, [a], 1);
    const moved = { ...a, frame: { ...a.frame, x: 500, y: 300 } } as Element;
    const pos = resolveEndpoint(ep, new Map([['a', moved]]));
    // E site of the moved shape.
    expect(pos).toEqual({ x: 700, y: 350 });
  });
});

describe('buildConnectorInit body glue', () => {
  it('glues both ends to the shapes under the drag start / end', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 600, 0);
    const init = buildConnectorInit('arrow', { x: 150, y: 50 }, { x: 640, y: 50 }, [a, b], 1);
    expect(init.start).toEqual({ kind: 'attached', elementId: 'a', siteIndex: 1 });
    expect(init.end).toEqual({ kind: 'attached', elementId: 'b', siteIndex: 3 });
  });

  it('does not glue the end to the shape the start is glued to', () => {
    const a = shape('a', 0, 0);
    const init = buildConnectorInit('arrow', { x: 20, y: 50 }, { x: 150, y: 50 }, [a], 1);
    expect(init.start).toMatchObject({ kind: 'attached', elementId: 'a' });
    expect(init.end).toEqual({ kind: 'free', x: 150, y: 50 });
  });
});

describe('endpointGlueOptions', () => {
  const base = {
    id: 'c',
    type: 'connector',
    routing: 'straight',
    arrowheads: {},
    frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
  } as const;
  it('excludes the body the other endpoint is attached to', () => {
    const c = {
      ...base,
      start: { kind: 'attached', elementId: 'a', siteIndex: 0 },
      end: { kind: 'free', x: 0, y: 0 },
    } as ConnectorElement;
    expect(endpointGlueOptions(c, 'end')).toEqual({ excludeBodyOf: 'a' });
    expect(endpointGlueOptions(c, 'start')).toEqual({});
  });
});
