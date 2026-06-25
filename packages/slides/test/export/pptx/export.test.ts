// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportPptx } from '../../../src/export/pptx/index.js';
import { importPptx } from '../../../src/import/pptx/index.js';
import { buildMinimalPptx } from '../../import/pptx/__fixtures__/build-minimal-pptx.js';
import { MemSlidesStore } from '../../../src/store/memory.js';

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
});
