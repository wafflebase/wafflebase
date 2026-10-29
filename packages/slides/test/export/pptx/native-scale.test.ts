// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportPptx } from '../../../src/export/pptx/index.js';
import { toExportScale } from '../../../src/export/pptx/physical-scale.js';
import { importPptx } from '../../../src/import/pptx/index.js';
import { buildMinimalPptx } from '../../import/pptx/__fixtures__/build-minimal-pptx.js';
import { DOCS_PX_PER_PT, type SlidesDocument } from '../../../src/model/presentation.js';
import type { TextElement } from '../../../src/model/element.js';
import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';

/**
 * A deck authored in wafflebase has no `meta.pxPerPt`: its points are painted
 * at the docs canvas's 96 DPI. The exported page runs at 2 px/pt, so the
 * exporter has to re-express sizes — otherwise the file opens with every run
 * 1.5× too large. The invariant is the painted size, `fontSize × pxPerPt`,
 * surviving export → import.
 */

const text = (fontSize: number): TextElement => ({
  id: 't',
  type: 'text',
  frame: { x: 100, y: 100, w: 800, h: 200, rotation: 0 },
  data: {
    autofit: 'none',
    blocks: [
      {
        id: 'b',
        type: 'paragraph',
        style: { ...DEFAULT_BLOCK_STYLE, marginTop: 12, marginBottom: 6 },
        inlines: [{ text: 'Hello', style: { fontSize } }],
      },
    ],
  },
});

async function nativeDeck(fontSize: number): Promise<SlidesDocument> {
  const base = (await importPptx(await buildMinimalPptx())).document;
  const { pxPerPt: _drop, ...meta } = base.meta;
  return { ...base, meta, slides: [{ ...base.slides[0], elements: [text(fontSize)] }] };
}

async function roundTrip(deck: SlidesDocument): Promise<SlidesDocument> {
  const bytes = await exportPptx(deck);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return (await importPptx(buf)).document;
}

const firstText = (d: SlidesDocument) =>
  d.slides[0].elements.find((e): e is TextElement => e.type === 'text')!;

describe('PPTX export of a native (no pxPerPt) deck', () => {
  it('keeps the painted font size and paragraph spacing through export → import', async () => {
    const deck = await nativeDeck(36);
    expect(deck.meta.pxPerPt).toBeUndefined();
    const back = await roundTrip(deck);
    const scale = back.meta.pxPerPt!;
    expect(scale).toBeCloseTo(2, 6);
    const run = firstText(back).data.blocks[0];
    // 36 pt at 96 DPI = 48 canvas px, before and after.
    expect(run.inlines[0].style.fontSize! * scale).toBeCloseTo(36 * DOCS_PX_PER_PT, 1);
    expect(run.style.marginTop * (scale / DOCS_PX_PER_PT)).toBeCloseTo(12, 0);
    expect(run.style.marginBottom * (scale / DOCS_PX_PER_PT)).toBeCloseTo(6, 0);
  });

  it('keeps an explicit text inset', async () => {
    const deck = await nativeDeck(24);
    const el = deck.slides[0].elements[0] as TextElement;
    el.data.inset = { left: 40, top: 28, right: 40, bottom: 12 };
    const back = await roundTrip(deck);
    const inset = firstText(back).data.inset!;
    expect(inset.left).toBeCloseTo(40, 0);
    expect(inset.top).toBeCloseTo(28, 0);
    expect(inset.right).toBeCloseTo(40, 0);
    expect(inset.bottom).toBeCloseTo(12, 0);
  });

  it('leaves a deck that already runs at the page scale unchanged', async () => {
    const deck = (await importPptx(await buildMinimalPptx())).document;
    expect(deck.meta.pxPerPt).toBeCloseTo(2, 6);
    expect(toExportScale(deck)).toBe(deck);
  });

  it('does not modify the deck it is given', async () => {
    const deck = await nativeDeck(36);
    const before = JSON.stringify(deck);
    await exportPptx(deck);
    expect(JSON.stringify(deck)).toBe(before);
  });
});
