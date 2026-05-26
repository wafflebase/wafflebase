// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attr, attrInt, child, children, descendant, parseXml, textOf, NS } from '../../../src/import/pptx/xml';

const SAMPLE = `<?xml version="1.0"?>
<root xmlns:p="${NS.P}" xmlns:a="${NS.A}">
  <p:wrap>
    <a:run sz="1200">Hello</a:run>
    <a:run sz="abc">World</a:run>
    <a:run>!</a:run>
  </p:wrap>
  <p:other/>
</root>`;

describe('xml helpers', () => {
  it('throws on malformed input', () => {
    expect(() => parseXml('<a><b>')).toThrow(/Invalid XML/);
  });

  it('matches children by localName ignoring prefix', () => {
    const doc = parseXml(SAMPLE);
    const root = doc.documentElement;
    const wrap = child(root, 'wrap');
    expect(wrap).toBeDefined();
    const runs = children(wrap!, 'run');
    expect(runs).toHaveLength(3);
    expect(textOf(runs[0])).toBe('Hello');
  });

  it('finds a descendant deep in the tree', () => {
    const doc = parseXml(SAMPLE);
    const run = descendant(doc, 'run');
    expect(run).toBeDefined();
    expect(textOf(run!)).toBe('Hello');
  });

  it('reads attributes safely', () => {
    const doc = parseXml(SAMPLE);
    const run = descendant(doc, 'run')!;
    expect(attr(run, 'sz')).toBe('1200');
    expect(attr(run, 'missing')).toBeUndefined();
    expect(attrInt(run, 'sz')).toBe(1200);

    const runs = children(child(doc.documentElement, 'wrap')!, 'run');
    expect(attrInt(runs[1], 'sz')).toBeUndefined();
    expect(attrInt(runs[2], 'sz')).toBeUndefined();
  });
});
