// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Theme } from '../../model/theme';
import type { ShapeElement } from '../../model/element';
import type { ConnectorElement } from '../../model/connector';
import { asCtx, createCtxSpy, type CtxSpy } from './ctx-spy';
// Installs the Path2D global the shape builders need.
import './test-canvas-env';
import { drawShape } from './shape-renderer';
import { drawConnector } from './connector-renderer';

const THEME: Theme = {
  id: 't',
  name: 't',
  colors: {
    text: '#000', background: '#fff', textSecondary: '#444', backgroundAlt: '#f3f3f3',
    accent1: '#abc', accent2: '#bcd', accent3: '#cde', accent4: '#def',
    accent5: '#e0e1e2', accent6: '#f0f1f2',
    hyperlink: '#11c', visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

const SIZE = { w: 120, h: 80 };

function shapeData(kind: string, dash: 'solid' | 'dashed' | 'dotted' | undefined) {
  return {
    kind,
    fill: { kind: 'srgb', value: '#a00' },
    stroke: { color: '#000', width: 2, ...(dash ? { dash } : {}) },
  } as unknown as ShapeElement['data'];
}

/** Every `setLineDash` argument, in call order. */
function dashCalls(ctx: CtxSpy): unknown[] {
  return ctx.setLineDash.mock.calls.map((c) => c[0]);
}

describe('shape stroke dash', () => {
  // One case per branch `drawShape` can take — they do not share a
  // single code path, so a fix to one says nothing about the rest. This
  // table is the registry of those branches: when `drawShape` grows an
  // early return, it needs a row here. The action-button row exists
  // because that one returns before `shape-renderer` strokes anything
  // (it paints in `shape-special.ts`) and was missed on the first pass.
  const KINDS: Array<[label: string, kind: string]> = [
    ['parametric (paintFillStroke)', 'rect'],
    ['freeform', 'freeform'],
    ['3D faces (FACE_BUILDERS)', 'cube'],
    ['border callout leader', 'borderCallout1'],
    ['action button (shape-special)', 'actionButtonHome'],
    ['unknown kind placeholder', 'notAShapeKindWeKnow'],
  ];

  for (const [label, kind] of KINDS) {
    it(`${label}: dotted sets [2,2] and resets`, () => {
      const ctx = createCtxSpy();
      const data = shapeData(kind, 'dotted');
      if (kind === 'freeform') {
        (data as { path?: unknown }).path = {
          commands: [
            { c: 'M', x: 0, y: 0 },
            { c: 'L', x: 1, y: 1 },
          ],
        };
      }

      drawShape(asCtx(ctx), SIZE, data, THEME);

      expect(dashCalls(ctx)).toContainEqual([2, 2]);
      // Must not leak: the shape's own text pass and, for connectors,
      // later elements paint under the same ctx state.
      expect(dashCalls(ctx).at(-1)).toEqual([]);
    });
  }

  it('border callouts dash the leader as well as the body', () => {
    // `borderCallout1` is in both PATH_BUILDERS and LEADER_BUILDERS, so
    // `drawShape` strokes it twice. The row above is satisfied by the
    // body alone — an implementation that left the leader solid would
    // pass it — so count the pattern instead of merely finding it.
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), SIZE, shapeData('borderCallout1', 'dotted'), THEME);

    const dotted = dashCalls(ctx).filter(
      (d) => Array.isArray(d) && d.length === 2 && d[0] === 2 && d[1] === 2,
    );
    expect(dotted).toHaveLength(2);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it('dashed sets [6,4]', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), SIZE, shapeData('rect', 'dashed'), THEME);
    expect(dashCalls(ctx)).toContainEqual([6, 4]);
  });

  it('solid and absent both stay continuous', () => {
    for (const dash of ['solid', undefined] as const) {
      const ctx = createCtxSpy();
      drawShape(asCtx(ctx), SIZE, shapeData('rect', dash), THEME);
      // Assert the solid path is actually exercised: `every` over an
      // empty array is vacuously true, so without this the case would
      // also pass on a renderer that never sets a dash at all.
      expect(ctx.setLineDash).toHaveBeenCalled();
      // A continuous line is `[]`; no pattern may ever be set.
      expect(dashCalls(ctx).every((d) => Array.isArray(d) && d.length === 0)).toBe(true);
    }
  });

  it('a stroke-less shape sets no dash at all', () => {
    const ctx = createCtxSpy();
    const data = { kind: 'rect', fill: { kind: 'srgb', value: '#a00' } } as unknown as ShapeElement['data'];
    drawShape(asCtx(ctx), SIZE, data, THEME);
    expect(ctx.setLineDash).not.toHaveBeenCalled();
  });
});

describe('connector stroke dash', () => {
  function connector(
    routing: 'straight' | 'elbow' | 'curved',
    dash: 'solid' | 'dashed' | 'dotted' | undefined,
  ): ConnectorElement {
    return {
      id: 'c1',
      type: 'connector',
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      routing,
      start: { kind: 'free', x: 0, y: 0 },
      end: { kind: 'free', x: 100, y: 100 },
      arrowheads: { end: { kind: 'triangle', size: 'md' } },
      stroke: { color: '#000', width: 2, ...(dash ? { dash } : {}) },
    } as unknown as ConnectorElement;
  }

  for (const routing of ['straight', 'elbow', 'curved'] as const) {
    it(`${routing}: dotted sets [2,2] and resets`, () => {
      const ctx = createCtxSpy();
      drawConnector(asCtx(ctx), connector(routing, 'dotted'), new Map(), THEME);
      expect(dashCalls(ctx)).toContainEqual([2, 2]);
      expect(dashCalls(ctx).at(-1)).toEqual([]);
    });
  }

  it('resets before the arrowhead is filled', () => {
    // `element-renderer` calls `drawConnector` with no surrounding
    // save()/restore(), so a leaked pattern would reach every element
    // painted afterward.
    const ctx = createCtxSpy();
    drawConnector(asCtx(ctx), connector('straight', 'dashed'), new Map(), THEME);
    const resetAt = ctx.setLineDash.mock.invocationCallOrder.at(-1)!;
    const fillAt = ctx.fill.mock.invocationCallOrder.at(-1)!;
    expect(resetAt).toBeLessThan(fillAt);
  });

  it('solid stays continuous', () => {
    const ctx = createCtxSpy();
    drawConnector(asCtx(ctx), connector('straight', 'solid'), new Map(), THEME);
    expect(ctx.setLineDash).toHaveBeenCalled();
    expect(dashCalls(ctx).every((d) => Array.isArray(d) && d.length === 0)).toBe(true);
  });
});
