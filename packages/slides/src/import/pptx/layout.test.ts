// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseLayout } from './layout';
import { ImportReport } from './report';

function layoutXml(type: string): string {
  return `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="${type}">
  <p:cSld name="Layout"><p:spTree/></p:cSld>
</p:sldLayout>`;
}

describe('parseLayout', () => {
  it('maps the four types used by the benchmark deck', () => {
    const r = new ImportReport();
    expect(parseLayout(layoutXml('tx'), 'l1', r).layout.id).toBe('title-body');
    expect(parseLayout(layoutXml('secHead'), 'l2', r).layout.id).toBe('section-header');
    expect(parseLayout(layoutXml('body'), 'l3', r).layout.id).toBe('one-column-text');
    expect(parseLayout(layoutXml('title'), 'l4', r).layout.id).toBe('title-slide');
    expect(r.unknownLayoutTypes).toBe(0);
  });

  it('falls back to title-body and counts unknown types', () => {
    const r = new ImportReport();
    const out = parseLayout(layoutXml('mediaText'), 'lx', r);
    expect(out.layout.id).toBe('title-body');
    expect(r.unknownLayoutTypes).toBe(1);
  });

  it('preserves the OOXML part name for later rels resolution', () => {
    const r = new ImportReport();
    const out = parseLayout(layoutXml('blank'), 'ppt/slideLayouts/slideLayout11.xml', r);
    expect(out.ooxmlPartName).toBe('ppt/slideLayouts/slideLayout11.xml');
    expect(out.layout.id).toBe('blank');
  });
});
