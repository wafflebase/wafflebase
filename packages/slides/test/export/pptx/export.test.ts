// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportPptx } from '../../../src/export/pptx/index.js';
import { importPptx } from '../../../src/import/pptx/index.js';
import { buildMinimalPptx } from '../../import/pptx/__fixtures__/build-minimal-pptx.js';
import { MemSlidesStore } from '../../../src/store/memory.js';
import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { TextElement } from '../../../src/model/element.js';

function textElementWithHref(href: string): TextElement {
  return {
    id: 'link-box',
    type: 'text',
    frame: { x: 10, y: 10, w: 200, h: 40, rotation: 0 },
    data: {
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          inlines: [{ text: 'click', style: { href } }],
          style: { ...DEFAULT_BLOCK_STYLE },
        },
      ],
    },
  };
}

describe('exportPptx', () => {
  it('produces a zip with required parts that re-imports', async () => {
    const { document: deck } = await importPptx(await buildMinimalPptx());
    const bytes = await exportPptx(deck);
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('ppt/presentation.xml')).not.toBeNull();
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull();
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    // Re-import must not throw and yields one slide.
    // Use transferToFixedLength / slice to get a plain ArrayBuffer.
    const reimportBuf: ArrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const reimported = await importPptx(reimportBuf);
    expect(reimported.document.slides).toHaveLength(1);
  });

  it('deck with layouts:[] still produces ppt/slideLayouts/slideLayout1.xml', async () => {
    // Fix 8: when layouts is empty, a synthetic blank layout must be emitted so
    // every slide's layout rel resolves to a valid part.
    const { document: base } = await importPptx(await buildMinimalPptx());
    const deck = { ...base, layouts: [] };
    const bytes = await exportPptx(deck);
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('ppt/slideLayouts/slideLayout1.xml')).not.toBeNull();
  });

  it('exports a custom master background fill onto inheriting slides', async () => {
    // Theme-builder regression: a slide that inherits its background
    // (no explicit fill) must export the resolved master fill, not the
    // theme background role.
    const store = new MemSlidesStore();
    store.batch(() => {
      store.updateMaster('default', {
        background: { fill: { kind: 'srgb', value: '#FF0000' } },
      });
      store.addSlide('blank');
    });
    const bytes = await exportPptx(store.read());
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const bg = xml.match(/<p:bg>.*?<\/p:bg>/s)?.[0] ?? '';
    expect(bg).toMatch(/srgbClr val="FF0000"/i);
  });

  it('exports a text-run hyperlink as an external rel and round-trips it', async () => {
    const { document: base } = await importPptx(await buildMinimalPptx());
    const url = 'https://example.com/a?x=1&y=2';
    const deck = {
      ...base,
      slides: [
        {
          ...base.slides[0],
          elements: [...base.slides[0].elements, textElementWithHref(url)],
        },
        ...base.slides.slice(1),
      ],
    };

    const bytes = await exportPptx(deck);
    const zip = await JSZip.loadAsync(bytes);

    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const hlink = slideXml.match(/<a:hlinkClick r:id="(rId\d+)"\/>/);
    expect(hlink).not.toBeNull();
    const rId = hlink![1];

    const relsXml = await zip
      .file('ppt/slides/_rels/slide1.xml.rels')!
      .async('string');
    // The rel must be external, target the (XML-escaped) URL, and match rId.
    expect(relsXml).toContain(`Id="${rId}"`);
    expect(relsXml).toContain('TargetMode="External"');
    expect(relsXml).toContain('Target="https://example.com/a?x=1&amp;y=2"');
    expect(relsXml).toContain('relationships/hyperlink');

    // Re-import: the href must survive back onto the run.
    const reimportBuf: ArrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const { document: back } = await importPptx(reimportBuf);
    const hrefs: string[] = [];
    for (const el of back.slides[0].elements) {
      if (el.type === 'text') {
        for (const block of el.data.blocks) {
          for (const inline of block.inlines) {
            if (inline.style.href) hrefs.push(inline.style.href);
          }
        }
      }
    }
    expect(hrefs).toContain(url);
  });
});
