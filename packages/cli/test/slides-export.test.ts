import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { exportPptxCli } from '../src/slides/pptx-export.js';
import type { SlidesDocument } from '@wafflebase/slides/node';

function deck(elements: unknown[] = []): SlidesDocument {
  return {
    meta: { title: 'T', themeId: 'default-light', masterId: 'default' },
    themes: [], masters: [], layouts: [],
    slides: [{ id: 's1', layoutId: 'blank', background: { fill: { kind: 'role', role: 'background' } }, elements, notes: [] }],
    guides: [],
  } as unknown as SlidesDocument;
}

/** One image element plus a shape, so a dropped image is distinguishable. */
function deckWithImage(): SlidesDocument {
  return deck([
    {
      id: 'img1',
      type: 'image',
      frame: { x: 0, y: 0, w: 100, h: 100 },
      data: { src: 'http://10.0.0.5/photo.png' },
    },
    {
      id: 'sh1',
      type: 'shape',
      frame: { x: 0, y: 200, w: 100, h: 100 },
      data: { kind: 'rect' },
    },
  ]);
}

describe('exportPptxCli', () => {
  it('returns pptx bytes with a slide part', async () => {
    const bytes = await exportPptxCli(deck(), {});
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull();
  });

  it('embeds a fetched image', async () => {
    const bytes = await exportPptxCli(deckWithImage(), {
      imageFetcher: async () =>
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
    });
    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slide).toContain('<p:pic>');
  });

  it('exports the deck when an image is refused', async () => {
    // The CLI's SSRF guard makes a refused `src` an ordinary outcome — a deck
    // whose images live on a host the operator did not list must still export
    // (minus those images), exactly as `docs export` does, instead of the
    // whole file being lost to one URL the user cannot fix.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let bytes: Uint8Array;
    try {
      bytes = await exportPptxCli(deckWithImage(), {
        imageFetcher: async () => {
          throw new Error(
            'Refusing to fetch image from a non-public address: 10.0.0.5',
          );
        },
      });
      expect(warn.mock.calls.flat().join('\n')).toContain(
        'Skipping image http://10.0.0.5/photo.png',
      );
    } finally {
      warn.mockRestore();
    }

    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    // The image element is gone — no picture, no dangling relationship — but
    // the slide and its other elements survived.
    expect(slide).not.toContain('<p:pic>');
    expect(slide).toContain('<p:sp>');
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    expect(rels).not.toContain('/image"');
  });
});
