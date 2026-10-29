// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportPptx } from '../../../src/export/pptx/index.js';
import { toExportScale, withPaintedDefaults } from '../../../src/export/pptx/physical-scale.js';
import { importPptx } from '../../../src/import/pptx/index.js';
import { buildMinimalPptx } from '../../import/pptx/__fixtures__/build-minimal-pptx.js';
import { DOCS_PX_PER_PT, type SlidesDocument } from '../../../src/model/presentation.js';
import type { TextElement } from '../../../src/model/element.js';
import { DEFAULT_BLOCK_STYLE, DEFAULT_INLINE_STYLE, Theme } from '@wafflebase/docs';

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

  it('names the font a run without fontFamily is painted in', async () => {
    const deck = await nativeDeck(24);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const run = /<a:r><a:rPr[^>]*>(.*?)<\/a:rPr><a:t>Hello<\/a:t>/.exec(slide);
    expect(run?.[1]).toContain('<a:latin typeface="Arial"/>');
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

const firstBodyPr = async (deck: SlidesDocument): Promise<string> => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await exportPptx(deck));
  const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
  return /<a:bodyPr[^>]*>/.exec(slide)![0];
};

describe('PPTX export of a native deck: painted defaults', () => {
  // The exporter names DEFAULT_INLINE_STYLE's family because the view theme
  // is browser-only; it must stay the face the canvas actually paints.
  it('names the same family the docs view paints unstyled runs in', () => {
    expect(DEFAULT_INLINE_STYLE.fontFamily).toBe(Theme.defaultFontFamily);
  });

  it('keeps a run\'s explicit font family', async () => {
    const deck = await nativeDeck(24);
    const el = deck.slides[0].elements[0] as TextElement;
    el.data.blocks[0].inlines = [
      { text: 'Named', style: { fontSize: 24, fontFamily: 'Georgia' } },
      { text: 'Bare', style: { fontSize: 24 } },
    ];
    const run = firstText(withPaintedDefaults(deck)).data.blocks[0].inlines;
    expect(run[0].style.fontFamily).toBe('Georgia');
    expect(run[1].style.fontFamily).toBe(DEFAULT_INLINE_STYLE.fontFamily);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const named = /<a:r><a:rPr[^>]*>(.*?)<\/a:rPr><a:t>Named<\/a:t>/.exec(slide);
    expect(named?.[1]).toContain('<a:latin typeface="Georgia"/>');
    expect(named?.[1]).not.toContain('typeface="Arial"');
  });

  it('writes zero insets for a text element without one', async () => {
    const bodyPr = await firstBodyPr(await nativeDeck(24));
    expect(bodyPr).toContain('lIns="0" tIns="0" rIns="0" bIns="0"');
  });

  it('keeps a negative inset side, which OOXML allows', async () => {
    const deck = await nativeDeck(24);
    (deck.slides[0].elements[0] as TextElement).data.inset = { left: -10, top: 0, right: 0, bottom: 0 };
    expect(await firstBodyPr(deck)).toContain('lIns="-63500"');
  });

  it('spells out defaults when pxPerPt is unusable, as the renderer paints it natively', async () => {
    const deck = await nativeDeck(24);
    const out = withPaintedDefaults({ ...deck, meta: { ...deck.meta, pxPerPt: Number.NaN } });
    expect(firstText(out).data.inset).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it('writes a non-finite inset side as 0, not NaN', async () => {
    const deck = await nativeDeck(24);
    (deck.slides[0].elements[0] as TextElement).data.inset = {
      left: Number.NaN,
      top: 10,
      right: -5,
      bottom: Number.POSITIVE_INFINITY,
    };
    const bodyPr = await firstBodyPr(deck);
    expect(bodyPr).not.toContain('NaN');
    expect(bodyPr).toContain('lIns="0"');
    expect(bodyPr).toContain('rIns="-31750"');
    expect(bodyPr).toContain('bIns="0"');
  });

  it('leaves an imported deck without fonts or insets it never had', async () => {
    const base = (await importPptx(await buildMinimalPptx())).document;
    const deck = { ...base, slides: [{ ...base.slides[0], elements: [text(24)] }] };
    expect(withPaintedDefaults(deck)).toBe(deck);
    const bodyPr = await firstBodyPr(deck);
    expect(bodyPr).not.toContain('lIns');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slide).not.toContain('<a:latin typeface="Arial"/>');
  });
});

describe('toExportScale', () => {
  const body = (fontSize: number, extra: Partial<TextElement['data']['blocks'][0]> = {}) => ({
    blocks: [
      {
        id: 'b',
        type: 'paragraph' as const,
        style: { ...DEFAULT_BLOCK_STYLE },
        inlines: [{ text: 'x', style: { fontSize } }],
        ...extra,
      },
    ],
  });
  const factor = DOCS_PX_PER_PT / 2;

  it('scales letter spacing with the font size', async () => {
    const deck = await nativeDeck(24);
    (deck.slides[0].elements[0] as TextElement).data.blocks[0].inlines[0].style.letterSpacing = 3;
    const run = firstText(toExportScale(deck)).data.blocks[0].inlines[0];
    expect(run.style.fontSize).toBeCloseTo(24 * factor, 6);
    expect(run.style.letterSpacing).toBeCloseTo(3 * factor, 6);
  });

  it('scales shape text, table cells, layout placeholders and style-less blocks, but not notes', async () => {
    const deck = await nativeDeck(24);
    const shape = {
      id: 's',
      type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect', text: body(20) },
    };
    const table = {
      id: 'tb',
      type: 'table',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { rows: [{ height: 40, cells: [{ body: body(18), style: {} }] }], columns: [100] },
    };
    const styleless = { ...text(30), id: 'u' };
    delete (styleless.data.blocks[0] as { style?: unknown }).style;
    deck.slides[0] = {
      ...deck.slides[0],
      elements: [...deck.slides[0].elements, shape, table, styleless] as never,
      notes: body(12).blocks,
    };
    deck.layouts = deck.layouts.map((l, i) =>
      i === 0
        ? { ...l, placeholders: [{ ...text(40), placeholder: { type: 'title' } }] as never }
        : l,
    );
    const out = toExportScale(deck);
    const els = out.slides[0].elements as unknown as Array<{ data: Record<string, unknown> }>;
    const size = (b: { blocks: Array<{ inlines: Array<{ style: { fontSize?: number } }> }> }) =>
      b.blocks[0].inlines[0].style.fontSize;
    expect(size(els[1].data.text as never)).toBeCloseTo(20 * factor, 6);
    const rows = els[2].data.rows as Array<{ cells: Array<{ body: never }> }>;
    expect(size(rows[0].cells[0].body)).toBeCloseTo(18 * factor, 6);
    expect(size(els[3].data as never)).toBeCloseTo(30 * factor, 6);
    expect(size((out.layouts[0].placeholders[0] as unknown as TextElement).data as never)).toBeCloseTo(40 * factor, 6);
    expect(out.slides[0].notes[0].inlines[0].style.fontSize).toBe(12);
  });

  it('reads an unusable pxPerPt the way the renderer does', async () => {
    const deck = await nativeDeck(36);
    const out = toExportScale({ ...deck, meta: { ...deck.meta, pxPerPt: Number.NaN } });
    expect(firstText(out).data.blocks[0].inlines[0].style.fontSize).toBeCloseTo(36 * factor, 6);
    expect(out.meta.pxPerPt).toBe(2);
  });
});
