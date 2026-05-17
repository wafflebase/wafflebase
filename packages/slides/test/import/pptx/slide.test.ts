// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSlide } from '../../../src/import/pptx/slide';
import { ImportReport } from '../../../src/import/pptx/report';
import type { PptxArchive } from '../../../src/import/pptx/unzip';

/**
 * Build a `PptxArchive` mock backed by an in-memory file map. Only the
 * methods the importer actually calls are populated — `list()` is a
 * no-op because slide parsing doesn't walk the archive.
 */
function makeArchive(files: Record<string, string | Uint8Array>): PptxArchive {
  return {
    readText: async (path) => {
      const v = files[path];
      return typeof v === 'string' ? v : undefined;
    },
    readBytes: async (path) => {
      const v = files[path];
      if (v instanceof Uint8Array) return v;
      if (typeof v === 'string') return new TextEncoder().encode(v);
      return undefined;
    },
    list: () => [],
  };
}

const SLIDE_WITH_BLIPFILL = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:blipFill>
          <a:blip r:embed="rIdImg"><a:alphaModFix amt="80000"/></a:blip>
          <a:stretch><a:fillRect/></a:stretch>
        </a:blipFill>
      </p:bgPr>
    </p:bg>
    <p:spTree/>
  </p:cSld>
</p:sld>`;

const SLIDE_RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;

const SLIDE_BLIPFILL_NO_REL = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:blipFill>
          <a:blip r:embed="rIdMissing"/>
          <a:stretch><a:fillRect/></a:stretch>
        </a:blipFill>
      </p:bgPr>
    </p:bg>
    <p:spTree/>
  </p:cSld>
</p:sld>`;

describe('parseSlide — blipFill background', () => {
  it('populates background.image when blipFill resolves and uploadImage is provided', async () => {
    const archive = makeArchive({
      'ppt/slides/slide1.xml': SLIDE_WITH_BLIPFILL,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_RELS,
      'ppt/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const uploads: Array<{ mime: string; size: number }> = [];
    const report = new ImportReport();

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      uploadImage: async (bytes, mime) => {
        uploads.push({ mime, size: bytes.byteLength });
        return `cdn://uploaded/${uploads.length}.png`;
      },
      scale: { sx: 1, sy: 1 },
      report,
      clrMap: new Map(),
    });

    expect(slide).toBeDefined();
    expect(slide!.background.image).toEqual({
      src: 'cdn://uploaded/1.png',
      opacity: 0.8,
    });
    // Theme-role fill stays on so transparent regions still get a color.
    expect(slide!.background.fill).toEqual({ kind: 'role', role: 'background' });
    expect(uploads).toEqual([{ mime: 'image/png', size: 4 }]);
    expect(report.skippedImages).toBe(0);
  });

  it('falls back to a color background when uploadImage is not configured', async () => {
    const archive = makeArchive({
      'ppt/slides/slide1.xml': SLIDE_WITH_BLIPFILL,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_RELS,
      'ppt/media/image1.png': new Uint8Array([0x89]),
    });
    const report = new ImportReport();

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      // no uploadImage — dry-run / CLI fixture style
      scale: { sx: 1, sy: 1 },
      report,
      clrMap: new Map(),
    });

    expect(slide).toBeDefined();
    expect(slide!.background.image).toBeUndefined();
    expect(report.skippedImages).toBeGreaterThan(0);
  });

  it('counts a skip and falls through when the blip rel does not resolve', async () => {
    const archive = makeArchive({
      'ppt/slides/slide1.xml': SLIDE_BLIPFILL_NO_REL,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_RELS,
    });
    const report = new ImportReport();

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      uploadImage: async () => 'cdn://unused.png',
      scale: { sx: 1, sy: 1 },
      report,
      clrMap: new Map(),
    });

    expect(slide).toBeDefined();
    expect(slide!.background.image).toBeUndefined();
    expect(report.skippedImages).toBe(1);
  });
});
