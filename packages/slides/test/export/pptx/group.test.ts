import { describe, it, expect } from 'vitest';
import { elementToXml, groupToXml, type ElementXmlCtx } from '../../../src/export/pptx/group.js';
import type { ChartElement, GroupElement, ShapeElement } from '../../../src/model/element.js';

const ctx: ElementXmlCtx = {
  resolveImageRId: () => 'rId1',
  connectorFrame: () => ({ x: 0, y: 0, w: 1, h: 1, rotation: 0 }),
};
const child: ShapeElement = {
  id: 'c',
  frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
  type: 'shape',
  data: { kind: 'rect' },
};

describe('group', () => {
  it('dispatches a shape', () => {
    expect(elementToXml(child, ctx)).toContain('<p:sp>');
  });

  it('skips a chart element (Phase 2: no serializer yet) instead of throwing', () => {
    const chart: ChartElement = {
      id: 'ch',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      type: 'chart',
      data: { kind: 'bar', categories: ['Q1'], series: [{ values: [1] }] },
    };
    expect(() => elementToXml(chart, ctx)).not.toThrow();
    expect(elementToXml(chart, ctx)).toBe('');
  });

  it('omits a chart but keeps sibling shape XML when serializing a group', () => {
    const chart: ChartElement = {
      id: 'ch2',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      type: 'chart',
      data: { kind: 'bar', categories: ['Q1'], series: [{ values: [1] }] },
    };
    const g: GroupElement = {
      id: 'gc',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      type: 'group',
      data: { children: [child, chart] },
    };
    const xml = groupToXml(g, ctx);
    expect(xml).toContain('<p:sp>');
    expect(xml).not.toContain('chart');
  });

  it('emits grpSp with children and chOff/chExt', () => {
    const g: GroupElement = {
      id: 'g',
      frame: { x: 5, y: 5, w: 100, h: 100, rotation: 0 },
      type: 'group',
      data: { children: [child] },
    };
    const xml = groupToXml(g, ctx);
    expect(xml).toContain('<p:grpSp>');
    expect(xml).toContain('<a:chOff');
    expect(xml).toContain('<a:chExt');
    expect(xml).toContain('<p:sp>');
  });

  it('uses refSize for chExt when present', () => {
    const g: GroupElement = {
      id: 'g2',
      frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
      type: 'group',
      data: { children: [child], refSize: { w: 400, h: 200 } },
    };
    const xml = groupToXml(g, ctx);
    // chExt should use refSize (400 × 200), not frame (200 × 100)
    const chExtMatch = xml.match(/<a:chExt cx="(\d+)" cy="(\d+)"\/>/);
    expect(chExtMatch).not.toBeNull();
    // refSize w=400 in EMU: pxToEmuX(400) = round((400/1920)*12192000) = 2540000
    expect(chExtMatch![1]).toBe('2540000');
  });

  it('recurses into nested groups', () => {
    const inner: GroupElement = {
      id: 'inner',
      frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
      type: 'group',
      data: { children: [child] },
    };
    const outer: GroupElement = {
      id: 'outer',
      frame: { x: 10, y: 10, w: 100, h: 100, rotation: 0 },
      type: 'group',
      data: { children: [inner] },
    };
    const xml = groupToXml(outer, ctx);
    // Two nested grpSp elements
    expect((xml.match(/<p:grpSp>/g) ?? []).length).toBe(2);
    // The leaf shape is inside
    expect(xml).toContain('<p:sp>');
  });

  it('emits rot on group xfrm for frame.rotation = Math.PI/2', () => {
    const g: GroupElement = {
      id: 'gr',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: Math.PI / 2 },
      type: 'group',
      data: { children: [child] },
    };
    const xml = groupToXml(g, ctx);
    // Math.PI/2 radians = 90 degrees = 5 400 000 in OOXML 60 000ths-of-a-degree
    expect(xml).toContain('rot="5400000"');
  });

  it('emits flipH and flipV on group xfrm', () => {
    const g: GroupElement = {
      id: 'gf',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0, flipH: true, flipV: true },
      type: 'group',
      data: { children: [child] },
    };
    const xml = groupToXml(g, ctx);
    expect(xml).toContain('flipH="1"');
    expect(xml).toContain('flipV="1"');
  });
});
