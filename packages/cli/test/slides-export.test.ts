import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportPptxCli } from '../src/slides/pptx-export.js';
import type { SlidesDocument } from '@wafflebase/slides/node';

function deck(): SlidesDocument {
  return {
    meta: { title: 'T', themeId: 'default-light', masterId: 'default' },
    themes: [], masters: [], layouts: [],
    slides: [{ id: 's1', layoutId: 'blank', background: { fill: { kind: 'role', role: 'background' } }, elements: [], notes: [] }],
    guides: [],
  } as unknown as SlidesDocument;
}

describe('exportPptxCli', () => {
  it('returns pptx bytes with a slide part', async () => {
    const bytes = await exportPptxCli(deck(), {});
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull();
  });
});
