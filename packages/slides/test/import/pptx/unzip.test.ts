import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { unzipPptx } from '../../../src/import/pptx/unzip';
import { buildMinimalPptx } from './__fixtures__/build-minimal-pptx';

describe('unzipPptx', () => {
  it('reads text parts from a minimal pptx', async () => {
    const buffer = await buildMinimalPptx();
    const archive = await unzipPptx(buffer);
    const xml = await archive.readText('ppt/presentation.xml');
    expect(xml).toBeDefined();
    expect(xml).toContain('<p:presentation');
  });

  it('returns undefined for missing entries', async () => {
    const buffer = await buildMinimalPptx();
    const archive = await unzipPptx(buffer);
    expect(await archive.readText('ppt/slides/slide99.xml')).toBeUndefined();
    expect(await archive.readBytes('ppt/media/missing.png')).toBeUndefined();
  });

  it('lists entries by prefix', async () => {
    const buffer = await buildMinimalPptx();
    const archive = await unzipPptx(buffer);
    const slides = archive.list('ppt/slides/');
    expect(slides).toContain('ppt/slides/slide1.xml');
    const layouts = archive.list('ppt/slideLayouts/');
    expect(layouts).toContain('ppt/slideLayouts/slideLayout1.xml');
  });

  it('rejects a non-OOXML archive', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'world');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(unzipPptx(buffer)).rejects.toThrow(/Content_Types/);
  });

  it('rejects an unzip failure', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    await expect(unzipPptx(buffer)).rejects.toThrow(/Invalid \.pptx/);
  });
});
