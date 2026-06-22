import { describe, it, expect } from 'vitest';
import { connectorToXml } from '../../../src/export/pptx/connector.js';
import type { ConnectorElement } from '../../../src/model/connector.js';

const el = {
  id: 'c', type: 'connector', routing: 'straight',
  start: { kind: 'free', x: 0, y: 0 }, end: { kind: 'free', x: 100, y: 50 },
  arrowheads: { end: { kind: 'triangle', size: 'md' } },
} as unknown as ConnectorElement;

describe('connectorToXml', () => {
  it('emits cxnSp with a line preset and tail arrowhead', () => {
    const xml = connectorToXml(el, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(xml).toContain('<p:cxnSp>');
    expect(xml).toContain('prst="line"');
    expect(xml).toContain('<a:tailEnd');
  });

  it('emits bentConnector3 for elbow routing', () => {
    const elbow = { ...el, routing: 'elbow' } as unknown as ConnectorElement;
    const xml = connectorToXml(elbow, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(xml).toContain('prst="bentConnector3"');
  });

  it('emits curvedConnector3 for curved routing', () => {
    const curved = { ...el, routing: 'curved' } as unknown as ConnectorElement;
    const xml = connectorToXml(curved, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(xml).toContain('prst="curvedConnector3"');
  });

  it('emits headEnd for start arrowhead', () => {
    const withStart = {
      ...el,
      arrowheads: { start: { kind: 'diamond', size: 'sm' } },
    } as unknown as ConnectorElement;
    const xml = connectorToXml(withStart, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(xml).toContain('<a:headEnd');
    expect(xml).toContain('type="diamond"');
  });

  it('maps triangle-open to stealth arrowhead type', () => {
    const withOpen = {
      ...el,
      arrowheads: { end: { kind: 'triangle-open', size: 'lg' } },
    } as unknown as ConnectorElement;
    const xml = connectorToXml(withOpen, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(xml).toContain('type="stealth"');
  });

  it('maps circle to oval arrowhead type', () => {
    const withCircle = {
      ...el,
      arrowheads: { end: { kind: 'circle', size: 'md' } },
    } as unknown as ConnectorElement;
    const xml = connectorToXml(withCircle, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(xml).toContain('type="oval"');
  });

  it('emits stroke color solidFill inside a:ln when stroke is present', () => {
    const withStroke = {
      ...el,
      stroke: { color: '#FF0000', width: 2 },
      arrowheads: {},
    } as unknown as ConnectorElement;
    const xml = connectorToXml(withStroke, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(xml).toContain('<a:solidFill>');
    expect(xml).toContain('FF0000');
  });

  it('uses default stroke width when no stroke is present', () => {
    const noStroke = { ...el, arrowheads: {} } as unknown as ConnectorElement;
    const xml = connectorToXml(noStroke, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    // Default 1px stroke width converted to EMU
    expect(xml).toContain('<a:ln w="');
  });

  it('encodes xfrm off and ext from the frame', () => {
    const xml = connectorToXml(el, { x: 10, y: 20, w: 200, h: 100, rotation: 0 });
    expect(xml).toContain('<a:off');
    expect(xml).toContain('<a:ext');
  });

  it('escapes id in cNvPr name attribute', () => {
    const special = { ...el, id: 'a&b<c' } as unknown as ConnectorElement;
    const xml = connectorToXml(special, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(xml).toContain('name="a&amp;b&lt;c"');
  });
});
