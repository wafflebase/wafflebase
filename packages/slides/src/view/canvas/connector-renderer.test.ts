import { describe, expect, it } from 'vitest';
import type { ConnectorElement } from '../../model/connector';
import type { Element } from '../../model/element';
import type { Theme } from '../../model/theme';
import { asCtx, createCtxSpy } from './ctx-spy';
import { drawConnector } from './connector-renderer';

const THEME: Theme = {
  id: 't',
  name: 't',
  colors: {
    text: '#000',
    background: '#fff',
    textSecondary: '#444',
    backgroundAlt: '#f3f3f3',
    accent1: '#abc',
    accent2: '#bcd',
    accent3: '#cde',
    accent4: '#def',
    accent5: '#e0e1e2',
    accent6: '#f0f1f2',
    hyperlink: '#11c',
    visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

function fakeConnector(
  overrides: Partial<ConnectorElement> = {},
): ConnectorElement {
  return {
    id: 'c1',
    type: 'connector',
    routing: 'straight',
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 100, y: 0 },
    arrowheads: {},
    frame: { x: 0, y: 0, w: 100, h: 0, rotation: 0 },
    stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
    ...overrides,
  };
}

describe('drawConnector', () => {
  it('draws a stroked line between the two endpoints', () => {
    const spy = createCtxSpy();
    const c = fakeConnector();
    drawConnector(asCtx(spy), c, new Map<string, Element>(), THEME);
    expect(spy.beginPath).toHaveBeenCalledTimes(1);
    expect(spy.moveTo).toHaveBeenCalledWith(0, 0);
    expect(spy.lineTo).toHaveBeenCalledWith(100, 0);
    expect(spy.stroke).toHaveBeenCalledTimes(1);
  });

  it('resolves the stroke colour through the theme (default text role)', () => {
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), fakeConnector(), new Map(), THEME);
    expect(spy.strokeStyle).toBe('#000'); // text role
    expect(spy.lineWidth).toBe(2);
  });

  it('with end arrowhead: also fills the arrowhead triangle', () => {
    const spy = createCtxSpy();
    const c = fakeConnector({
      arrowheads: { end: { kind: 'triangle', size: 'md' } },
    });
    drawConnector(asCtx(spy), c, new Map(), THEME);
    expect(spy.fill).toHaveBeenCalled();
  });

  it('with start arrowhead pointing back along -direction', () => {
    const spy = createCtxSpy();
    const c = fakeConnector({
      arrowheads: { start: { kind: 'triangle', size: 'md' } },
    });
    drawConnector(asCtx(spy), c, new Map(), THEME);
    // Arrowhead triangle tip lands on the start endpoint (0, 0).
    expect(spy.moveTo).toHaveBeenCalledWith(0, 0);
    expect(spy.fill).toHaveBeenCalled();
  });

  it('without arrowheads: never calls fill', () => {
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), fakeConnector(), new Map(), THEME);
    expect(spy.fill).not.toHaveBeenCalled();
  });

  it('resolves attached endpoints through the elements lookup', () => {
    const target: Element = {
      id: 't1',
      type: 'shape',
      frame: { x: 200, y: 100, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const lookup = new Map<string, Element>([['t1', target]]);
    const c = fakeConnector({
      start: { kind: 'free', x: 0, y: 0 },
      end: { kind: 'attached', elementId: 't1', siteIndex: 1 }, // E side
    });
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), c, lookup, THEME);
    expect(spy.moveTo).toHaveBeenCalledWith(0, 0);
    expect(spy.lineTo).toHaveBeenCalledWith(300, 150);
  });
});
