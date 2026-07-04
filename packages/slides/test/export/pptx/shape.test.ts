import { describe, it, expect } from 'vitest';
import { shapeToXml, kindToPrst, xfrmXml } from '../../../src/export/pptx/shape.js';
import type { ShapeElement } from '../../../src/model/element.js';

const frame = { x: 100, y: 200, w: 300, h: 150, rotation: 0 };

describe('shape', () => {
  it('maps pentagonArrow to homePlate, others identity', () => {
    expect(kindToPrst('pentagonArrow')).toBe('homePlate');
    expect(kindToPrst('rect')).toBe('rect');
  });
  it('emits xfrm in EMU', () => {
    const xml = xfrmXml({ ...frame, rotation: Math.PI / 2 });
    expect(xml).toContain('rot="5400000"');
    expect(xml).toMatch(/<a:off x="\d+" y="\d+"\/>/);
  });
  it('emits p:sp with prstGeom and fill', () => {
    const el: ShapeElement = { id: 's', frame, type: 'shape', data: { kind: 'rect', fill: { kind: 'srgb', value: '#FF0000' } } };
    const xml = shapeToXml(el);
    expect(xml).toContain('<p:sp>');
    expect(xml).toContain('<a:prstGeom prst="rect">');
    expect(xml).toContain('<a:srgbClr val="FF0000"/>');
  });
  it('emits custGeom for freeform', () => {
    const el: ShapeElement = { id: 's', frame, type: 'shape', data: { kind: 'freeform', path: { commands: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 1 }, { c: 'Z' }] } } };
    expect(shapeToXml(el)).toContain('<a:custGeom>');
  });
  it('emits tailEnd/headEnd on a freeform shape with arrowheads', () => {
    const el: ShapeElement = {
      id: 's', frame, type: 'shape',
      data: {
        kind: 'freeform',
        path: { commands: [{ c: 'M', x: 0, y: 0 }, { c: 'C', x1: 0.3, y1: 0, x2: 0.7, y2: 0, x: 1, y: 0 }] },
        stroke: { color: { kind: 'srgb', value: '#292929' }, width: 1 },
        arrowheads: { end: { kind: 'triangle', size: 'md' } },
      },
    };
    const xml = shapeToXml(el);
    expect(xml).toContain('<a:tailEnd');
    expect(xml).toContain('type="triangle"');
    expect(xml).toContain('len="med"');
    // No start arrowhead → no headEnd emitted.
    expect(xml).not.toContain('<a:headEnd');
  });
  it('emits empty p:txBody when shape has no text', () => {
    const el: ShapeElement = { id: 's', frame, type: 'shape', data: { kind: 'ellipse' } };
    const xml = shapeToXml(el);
    expect(xml).toContain('<p:txBody>');
  });
  it('emits flipH and flipV attributes', () => {
    const xml = xfrmXml({ ...frame, rotation: 0, flipH: true, flipV: true });
    expect(xml).toContain('flipH="1"');
    expect(xml).toContain('flipV="1"');
  });
  it('emits lineXml with stroke color and width', () => {
    const el: ShapeElement = {
      id: 's',
      frame,
      type: 'shape',
      data: {
        kind: 'rect',
        stroke: { color: '#0000FF', width: 2 },
      },
    };
    const xml = shapeToXml(el);
    expect(xml).toContain('<a:ln');
    expect(xml).toContain('<a:srgbClr val="0000FF"/>');
  });
  it('emits adjustments in avLst', () => {
    const el: ShapeElement = {
      id: 's',
      frame,
      type: 'shape',
      data: {
        kind: 'roundRect',
        adjustments: [16667],
      },
    };
    const xml = shapeToXml(el);
    expect(xml).toContain('<a:avLst>');
    expect(xml).toContain('fmla="val 16667"');
  });
  it('emits alt text in cNvPr descr attribute', () => {
    const el: ShapeElement = {
      id: 's',
      frame,
      type: 'shape',
      data: { kind: 'rect', alt: 'A red box' },
    };
    const xml = shapeToXml(el);
    expect(xml).toContain('descr="A red box"');
  });
  it('escapes special characters in alt text descr attribute', () => {
    const el: ShapeElement = {
      id: 's',
      frame,
      type: 'shape',
      data: { kind: 'rect', alt: 'A & B "quoted"' },
    };
    const xml = shapeToXml(el);
    expect(xml).toContain('descr="A &amp; B &quot;quoted&quot;"');
    // No raw & or " inside attribute value
    const descrMatch = xml.match(/descr="([^"]*)"/);
    expect(descrMatch).not.toBeNull();
    expect(descrMatch![1]).not.toContain('&"');
  });
  it('omits descr attribute when alt is absent', () => {
    const el: ShapeElement = {
      id: 's',
      frame,
      type: 'shape',
      data: { kind: 'rect' },
    };
    const xml = shapeToXml(el);
    expect(xml).not.toContain('descr=');
  });

  it('emits prst="rect" for freeform shape with no path', () => {
    // prst="freeform" is not valid OOXML; fallback to rect when path is absent.
    const el: ShapeElement = {
      id: 's',
      frame,
      type: 'shape',
      data: { kind: 'freeform' },
    };
    const xml = shapeToXml(el);
    expect(xml).toContain('prst="rect"');
    expect(xml).not.toContain('prst="freeform"');
    // Must not emit custGeom either
    expect(xml).not.toContain('<a:custGeom>');
  });
});
