// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { ConnectorElement } from '../../../src/model/connector';
import type { Element, TextBody } from '../../../src/model/element';
import type { Theme } from '../../../src/model/theme';
import { MemSlidesStore } from '../../../src/store/memory';
import { estimateMeasurer } from '../../../src/lint/estimate-measurer';
import {
  LABEL_MAX_WIDTH,
  LABEL_PADDING,
  drawConnectorLabel,
  isLabelEmpty,
  layoutConnectorLabel,
  pathMidpoint,
} from '../../../src/view/canvas/connector-label';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
import { hitTestElement } from '../../../src/view/editor/element-hit';
import {
  LABEL_EDIT_MIN_WIDTH,
  connectorLabelEditTarget,
  labelFromEditedBlocks,
  makeDefaultLabelBlock,
} from '../../../src/view/editor/connector-label-edit';
import { maskEditingElement } from '../../../src/view/editor/editor';
import { connectorLabelTextBox } from '../../../src/export/pptx/connector-label';
import { elementToXml } from '../../../src/export/pptx/group';

const THEME = {
  id: 't',
  name: 't',
  colors: {
    text: '#000', background: '#fafafa', textSecondary: '#444', backgroundAlt: '#eee',
    accent1: '#a', accent2: '#b', accent3: '#c', accent4: '#d', accent5: '#e', accent6: '#f',
    hyperlink: '#11c', visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
} as Theme;

const body = (text: string): TextBody => {
  const block = makeDefaultLabelBlock();
  return { blocks: [{ ...block, inlines: [{ ...block.inlines[0], text }] }] };
};

const connector = (overrides: Partial<ConnectorElement> = {}): ConnectorElement => ({
  id: 'c1',
  type: 'connector',
  routing: 'straight',
  start: { kind: 'free', x: 0, y: 0 },
  end: { kind: 'free', x: 400, y: 0 },
  arrowheads: {},
  frame: { x: 0, y: 0, w: 400, h: 0, rotation: 0 },
  ...overrides,
});

const NONE = new Map<string, Element>();
const measurer = estimateMeasurer();

describe('pathMidpoint', () => {
  it('halves a straight line', () => {
    expect(pathMidpoint({ points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] })).toEqual({ x: 200, y: 0 });
  });

  it('walks an elbow by length, not by chord', () => {
    // 0,0 → 100,0 → 100,300: total 400, midpoint 200 along = (100, 100).
    const mid = pathMidpoint({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }] });
    expect(mid).toEqual({ x: 100, y: 100 });
  });

  it('lands on a symmetric bezier at its centre', () => {
    const mid = pathMidpoint({
      p0: { x: 0, y: 0 }, c1: { x: 0, y: 100 }, c2: { x: 200, y: 100 }, p1: { x: 200, y: 0 },
    });
    expect(mid.x).toBeCloseTo(100, 0);
    expect(mid.y).toBeCloseTo(75, 0);
  });
});

describe('layoutConnectorLabel', () => {
  it('returns null without a visible label', () => {
    expect(layoutConnectorLabel(connector(), NONE, { measurer })).toBeNull();
    expect(layoutConnectorLabel(connector({ label: body('') }), NONE, { measurer })).toBeNull();
    expect(isLabelEmpty(body('  '))).toBe(false);
    expect(isLabelEmpty(body(''))).toBe(true);
  });

  it('centres a content-sized box on the path midpoint', () => {
    const placed = layoutConnectorLabel(connector({ label: body('yes') }), NONE, { measurer })!;
    expect(placed.center).toEqual({ x: 200, y: 0 });
    expect(placed.frame.x + placed.frame.w / 2).toBeCloseTo(200);
    expect(placed.frame.y + placed.frame.h / 2).toBeCloseTo(0);
    // A one-word label gets a small box, not the max width.
    expect(placed.frame.w).toBeLessThan(LABEL_MAX_WIDTH / 2);
    expect(placed.frame.w).toBeGreaterThan(LABEL_PADDING.x * 2);
  });

  it('wraps a long label at the max width', () => {
    const long = 'a fairly long connector label that keeps going and going';
    const placed = layoutConnectorLabel(connector({ label: body(long) }), NONE, { measurer })!;
    expect(placed.frame.w).toBeLessThanOrEqual(LABEL_MAX_WIDTH + LABEL_PADDING.x * 2);
    expect(placed.layout.blocks[0].lines.length).toBeGreaterThan(1);
  });

  it('follows an attached endpoint when its shape moves', () => {
    const shape = (x: number): Element => ({
      id: 's', type: 'shape', frame: { x, y: 0, w: 100, h: 100, rotation: 0 }, data: { kind: 'rect' },
    }) as Element;
    const c = connector({
      start: { kind: 'free', x: 0, y: 50 },
      end: { kind: 'attached', elementId: 's', siteIndex: 3 },
      label: body('x'),
    });
    const a = layoutConnectorLabel(c, new Map([['s', shape(400)]]), { measurer })!;
    const b = layoutConnectorLabel(c, new Map([['s', shape(800)]]), { measurer })!;
    expect(a.center).toEqual({ x: 200, y: 50 });
    expect(b.center).toEqual({ x: 400, y: 50 });
  });
});

describe('drawConnectorLabel', () => {
  it('paints the theme-background knockout behind the text', () => {
    const spy = createCtxSpy();
    drawConnectorLabel(asCtx(spy), connector({ label: body('yes') }), NONE, THEME);
    expect(spy.fillRect).toHaveBeenCalled();
    expect(spy.fillText).toHaveBeenCalled();
  });

  it('paints nothing without a label', () => {
    const spy = createCtxSpy();
    drawConnectorLabel(asCtx(spy), connector(), NONE, THEME);
    expect(spy.fillRect).not.toHaveBeenCalled();
  });
});

describe('hit-testing a label', () => {
  it('a click on the label box (off the line) hits the connector', () => {
    const c = connector({ label: body('a label') });
    const ctx = { isPointInPath: () => false };
    // 200, 0 is the midpoint; 8px below is inside the box, past the
    // line's 6px tolerance.
    expect(hitTestElement(c, 200, 9, ctx, { tolerance: 0 })).toBe(true);
    expect(hitTestElement(connector(), 200, 9, ctx, { tolerance: 0 })).toBe(false);
  });
});

describe('label editing helpers', () => {
  it('seeds a centred label-size paragraph for a new label', () => {
    const t = connectorLabelEditTarget(connector(), NONE);
    expect(t.blocks[0].style.alignment).toBe('center');
    expect(t.editFrame.w).toBe(LABEL_EDIT_MIN_WIDTH);
    expect(t.editFrame.x + t.editFrame.w / 2).toBe(200);
  });

  it('starts from the existing label blocks', () => {
    const label = body('hi');
    const t = connectorLabelEditTarget(connector({ label }), NONE);
    expect(t.blocks).toBe(label.blocks);
  });

  it('an emptied edit removes the label', () => {
    expect(labelFromEditedBlocks(body('').blocks)).toBeUndefined();
    expect(labelFromEditedBlocks(body('ok').blocks)).toEqual(body('ok'));
  });

  it('masking during edit keeps the line and drops only the label', () => {
    const c = connector({ label: body('hi') });
    const [masked] = maskEditingElement([c], 'c1', null);
    expect(masked.type).toBe('connector');
    expect((masked as ConnectorElement).label).toBeUndefined();
  });
});

describe('MemSlidesStore.updateConnectorLabel', () => {
  it('sets, replaces and removes the label in one undo unit each', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    const sid = store.read().slides[0].id;
    let id = '';
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'connector', routing: 'straight',
        start: { kind: 'free', x: 0, y: 0 }, end: { kind: 'free', x: 10, y: 0 },
        arrowheads: {}, frame: { x: 0, y: 0, w: 10, h: 0, rotation: 0 },
      });
    });
    const read = () =>
      store.read().slides[0].elements.find((e) => e.id === id) as ConnectorElement;
    store.batch(() => store.updateConnectorLabel(sid, id, body('a')));
    expect(read().label).toEqual(body('a'));
    store.batch(() => store.updateConnectorLabel(sid, id, undefined));
    expect(read().label).toBeUndefined();
    store.undo();
    expect(read().label).toEqual(body('a'));
  });
});

describe('PPTX export of a label', () => {
  it('emits a background-filled text box after the connector', () => {
    const c = connector({ label: body('yes') });
    const box = connectorLabelTextBox(c, NONE)!;
    expect(box.type).toBe('text');
    expect(box.frame.x + box.frame.w / 2).toBeCloseTo(200);
    const xml = elementToXml(c, {
      resolveImageRId: () => null,
      connectorFrame: (el) => el.frame,
      connectorLabel: (el) => connectorLabelTextBox(el, NONE),
      resolveHyperlinkRId: () => 'rId1',
    });
    expect(xml.indexOf('<p:cxnSp>')).toBeLessThan(xml.indexOf('txBox="1"'));
    expect(xml).toContain('yes');
  });

  it('emits only the connector without a label', () => {
    const xml = elementToXml(connector(), {
      resolveImageRId: () => null,
      connectorFrame: (el) => el.frame,
      connectorLabel: (el) => connectorLabelTextBox(el, NONE),
      resolveHyperlinkRId: () => 'rId1',
    });
    expect(xml).not.toContain('txBox');
  });
});
