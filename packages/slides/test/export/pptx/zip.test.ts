import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { PptxWriter } from '../../../src/export/pptx/zip.js';

describe('PptxWriter', () => {
  it('emits content-types, root rels, parts, and per-part rels', async () => {
    const w = new PptxWriter();
    const rId = w.addRel('ppt/presentation.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', 'slides/slide1.xml');
    w.addPart('ppt/presentation.xml', `<p:presentation xmlns:p="x"/>`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml');
    w.addPart('ppt/slides/slide1.xml', `<p:sld xmlns:p="x"/>`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
    const bytes = await w.build();
    const zip = await JSZip.loadAsync(bytes);

    expect(rId).toBe('rId1');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('presentationml.slide+xml');
    expect(await zip.file('_rels/.rels')!.async('string')).toContain('presentation.xml');
    const presRels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string');
    expect(presRels).toContain('slides/slide1.xml');
    expect(presRels).toContain('Id="rId1"');
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull();
  });

  it('dedups media and returns stable rel ids per owner', async () => {
    const w = new PptxWriter();
    const p1 = w.addMedia(new Uint8Array([1, 2, 3]), 'png');
    expect(p1).toBe('media/image1.png');
    const r1 = w.addRel('ppt/slides/slide1.xml', 'http://x/image', `../${p1}`);
    const r2 = w.addRel('ppt/slides/slide1.xml', 'http://x/image', `../${p1}`);
    expect([r1, r2]).toEqual(['rId1', 'rId2']); // per-owner counter
    const zip = await JSZip.loadAsync(await w.build());
    expect(zip.file('ppt/media/image1.png')).not.toBeNull();
  });
});
