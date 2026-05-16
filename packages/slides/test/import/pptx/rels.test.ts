// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseRels, resolveRelsTarget } from '../../../src/import/pptx/rels';

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout3.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/>
</Relationships>`;

describe('parseRels', () => {
  it('builds a map from rId to short type + target', () => {
    const rels = parseRels(RELS_XML);
    expect(rels.size).toBe(3);
    expect(rels.get('rId1')).toEqual({
      type: 'slideLayout',
      target: '../slideLayouts/slideLayout3.xml',
      external: false,
    });
    expect(rels.get('rId2')?.type).toBe('image');
    expect(rels.get('rId3')?.external).toBe(true);
  });
});

describe('resolveRelsTarget', () => {
  it('resolves relative targets against the part directory', () => {
    expect(resolveRelsTarget('ppt/slides/slide1.xml', '../media/image1.png')).toBe(
      'ppt/media/image1.png',
    );
    expect(resolveRelsTarget('ppt/slides/slide1.xml', '../slideLayouts/slideLayout3.xml')).toBe(
      'ppt/slideLayouts/slideLayout3.xml',
    );
  });

  it('returns external URLs unchanged', () => {
    expect(resolveRelsTarget('ppt/slides/slide1.xml', 'https://example.com/')).toBe(
      'https://example.com/',
    );
  });
});
