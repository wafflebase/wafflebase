import { describe, it, expect } from 'vitest';
import {
  BUILTIN_STYLES,
  STYLE_IDS,
  blockStyleId,
  resolveStyleInline,
  resolveStyleBlock,
  effectiveBlockSpacing,
  markAuthoredSpacing,
  clearAuthoredSpacing,
  materializeBlockSpacing,
  rematerializeDocSpacing,
  STYLE_OWNED_SPACING_DEFAULTS,
  type DocStyles,
  type StyleId,
} from '../../src/model/named-styles.js';
import {
  createBlock,
  createTableBlock,
  DEFAULT_BLOCK_STYLE,
  DEFAULT_INLINE_STYLE,
} from '../../src/model/types.js';
import type { Document } from '../../src/model/types.js';
import { ptToPx } from '../../src/view/theme.js';

describe('blockStyleId', () => {
  it('maps paragraph and list-item to normal', () => {
    expect(blockStyleId(createBlock('paragraph'))).toBe('normal');
    expect(blockStyleId(createBlock('list-item'))).toBe('normal');
  });

  it('maps title / subtitle', () => {
    expect(blockStyleId(createBlock('title'))).toBe('title');
    expect(blockStyleId(createBlock('subtitle'))).toBe('subtitle');
  });

  it('maps headings by level', () => {
    expect(blockStyleId(createBlock('heading', { headingLevel: 1 }))).toBe('heading-1');
    expect(blockStyleId(createBlock('heading', { headingLevel: 6 }))).toBe('heading-6');
  });

  it('defaults heading without level to heading-1', () => {
    const b = createBlock('heading');
    delete b.headingLevel;
    expect(blockStyleId(b)).toBe('heading-1');
  });

  it('clamps an out-of-range heading level (e.g. DOCX Heading 7–9) into the catalog', () => {
    const b = createBlock('heading');
    (b as { headingLevel?: number }).headingLevel = 9;
    expect(blockStyleId(b)).toBe('heading-6');
    // Resolution must not throw even if a corrupt registry key sneaks through.
    expect(resolveStyleInline('heading-9' as never)).toEqual({});
    expect(resolveStyleBlock('heading-9' as never)).toEqual({});
  });

  it('maps structural blocks to normal', () => {
    expect(blockStyleId(createBlock('horizontal-rule'))).toBe('normal');
    expect(blockStyleId(createBlock('page-break'))).toBe('normal');
  });
});

describe('built-in style values (Google Docs defaults)', () => {
  it('covers every style id', () => {
    for (const id of STYLE_IDS) {
      expect(BUILTIN_STYLES[id]).toBeDefined();
    }
  });

  // The full factory catalog, transcribed from a Google Docs document's own
  // `word/styles.xml` export taken straight after
  // `Format → Paragraph styles → Options → Reset styles`. Point spacing is
  // converted here rather than in the table so the source numbers stay
  // literally comparable to the export.
  //
  // This replaces a `headings are non-bold` loop that asserted every style's
  // `bold` was `undefined`. That test passed, and it was wrong: it pinned a
  // claim about Google Docs instead of measuring it, so it locked in the two
  // missing bolds it existed to guard.
  const ptToPxRounded = (pt: number) => Math.round((pt * 4) / 3);
  const GOOGLE_FACTORY = [
    { id: 'title',     pt: 26, bold: false, italic: false, color: undefined,  beforePt: 0,  afterPt: 3 },
    { id: 'subtitle',  pt: 15, bold: false, italic: true,  color: '#666666', beforePt: 0,  afterPt: 16 },
    { id: 'heading-1', pt: 20, bold: false, italic: false, color: undefined,  beforePt: 20, afterPt: 6 },
    { id: 'heading-2', pt: 16, bold: true,  italic: false, color: undefined,  beforePt: 18, afterPt: 6 },
    { id: 'heading-3', pt: 14, bold: true,  italic: false, color: '#434343', beforePt: 16, afterPt: 4 },
    { id: 'heading-4', pt: 12, bold: false, italic: false, color: '#666666', beforePt: 14, afterPt: 4 },
    { id: 'heading-5', pt: 11, bold: false, italic: false, color: '#666666', beforePt: 12, afterPt: 4 },
    { id: 'heading-6', pt: 11, bold: false, italic: true,  color: '#666666', beforePt: 12, afterPt: 4 },
  ] as const;

  it.each(GOOGLE_FACTORY)('matches Google Docs factory defaults for $id', (g) => {
    const def = BUILTIN_STYLES[g.id];
    expect(def.inline.fontSize).toBe(g.pt);
    expect(def.inline.bold ?? false).toBe(g.bold);
    expect(def.inline.italic ?? false).toBe(g.italic);
    expect(def.inline.color).toBe(g.color);
    expect(def.block.marginTop).toBe(ptToPxRounded(g.beforePt));
    expect(def.block.marginBottom).toBe(ptToPxRounded(g.afterPt));
  });

  it('matches Google on `normal` too — line 1.15, no space after', () => {
    // Google's Normal inherits docDefaults: line 1.15, no space before/after.
    // A measured comparison put every heading within 1.7 px of Google and
    // every *body* paragraph 13.1 px out, which was 23% of the document's
    // height, so this is where the remaining difference lived.
    expect(BUILTIN_STYLES['normal'].block).toEqual({
      marginTop: 0,
      marginBottom: 0,
      lineHeight: 1.15,
    });
    // And it is now *unlike* `DEFAULT_BLOCK_STYLE`, which used to be the
    // mechanism protecting slides/board. That protection moved to the
    // `normalStyleSpacing` opt-in — asserted directly below rather than
    // inferred from the values being equal.
    expect(BUILTIN_STYLES['normal'].block.lineHeight)
      .not.toBe(DEFAULT_BLOCK_STYLE.lineHeight);
  });

  it('leads every style at Google\u2019s uniform 1.15', () => {
    // The per-style ladder this test used to pin (Title 1.1 \u2026 Normal 1.5) is
    // gone. It existed to stop a 26 pt Title floating inside a line box built
    // from a 1.5 body multiplier; `normal` is 1.15 now, so the condition it
    // corrected for no longer arises. See the `BUILTIN_STYLES` comment.
    for (const id of STYLE_IDS) {
      expect(BUILTIN_STYLES[id].block.lineHeight).toBe(1.15);
    }
  });

  it('keeps line boxes monotone in size across the heading chain', () => {
    // The guard the individual numbers above cannot give: a future leading
    // edit must never make a heading's line box *shorter* than the body
    // text's, which is what a multiplier tightened one step too far does.
    const boxPx = (id: StyleId) => {
      const size = BUILTIN_STYLES[id].inline.fontSize ?? DEFAULT_INLINE_STYLE.fontSize ?? 11;
      return ptToPx(size) * BUILTIN_STYLES[id].block.lineHeight!;
    };
    const chain: StyleId[] = [
      'normal', 'heading-6', 'heading-5', 'heading-4',
      'heading-3', 'heading-2', 'heading-1', 'title',
    ];
    for (let i = 1; i < chain.length; i++) {
      expect(boxPx(chain[i])).toBeGreaterThanOrEqual(boxPx(chain[i - 1]));
    }
    // And the reported symptom: a 26 pt Title no longer gets a body-text line
    // box (34.67 px of glyph in a 52 px box at 1.5).
    expect(boxPx('title')).toBeLessThan(ptToPx(26) * 1.5);
  });
});

describe('rematerializeDocSpacing', () => {
  it('recurses into table-cell blocks', () => {
    const cellHeading = createBlock('heading', { headingLevel: 1 });
    const table = createTableBlock(1, 1);
    table.tableData!.rows[0].cells[0].blocks = [cellHeading];
    const doc: Document = {
      blocks: [table],
      styles: { 'heading-1': { block: { marginTop: 44, marginBottom: 7 } } },
    };
    rematerializeDocSpacing(doc);
    expect(cellHeading.style.marginTop).toBe(44);
    expect(cellHeading.style.marginBottom).toBe(7);
  });
});

describe('resolveStyleInline / resolveStyleBlock', () => {
  it('returns built-in when no overrides', () => {
    expect(resolveStyleInline('heading-1')).toEqual({ fontSize: 20 });
    expect(resolveStyleBlock('heading-1')).toEqual({ marginTop: 27, marginBottom: 8, lineHeight: 1.15 });
  });

  it('merges an override over the built-in', () => {
    const docStyles: DocStyles = {
      'heading-1': { inline: { fontSize: 28, bold: true } },
    };
    expect(resolveStyleInline('heading-1', docStyles)).toEqual({ fontSize: 28, bold: true });
    // block sub-key absent in the override → still built-in
    expect(resolveStyleBlock('heading-1', docStyles)).toEqual({ marginTop: 27, marginBottom: 8, lineHeight: 1.15 });
  });

  it('does not mutate the built-in definition', () => {
    const docStyles: DocStyles = { 'title': { inline: { color: '#ff0000' } } };
    resolveStyleInline('title', docStyles);
    expect(BUILTIN_STYLES['title'].inline.color).toBeUndefined();
  });
});

describe('resolveStyleInline surfaces', () => {
  it('defaults to the light surface', () => {
    // The default is the export guarantee: every caller that omits the
    // argument — PDF export, caret style, range summaries — gets the
    // Google Docs greys, whatever theme mode the editor happens to be in.
    expect(resolveStyleInline('heading-3'))
      .toEqual({ fontSize: 14, bold: true, color: '#434343' });
    expect(resolveStyleInline('heading-3', undefined, 'light'))
      .toEqual({ fontSize: 14, bold: true, color: '#434343' });
    expect(resolveStyleInline('subtitle', undefined, 'light'))
      .toEqual({ fontSize: 15, color: '#666666', italic: true });
  });

  it('swaps in the dark-surface grey', () => {
    expect(resolveStyleInline('heading-3', undefined, 'dark'))
      .toEqual({ fontSize: 14, bold: true, color: '#B0B0B0' });
    expect(resolveStyleInline('subtitle', undefined, 'dark'))
      .toEqual({ fontSize: 15, color: '#999999', italic: true });
    expect(resolveStyleInline('heading-6', undefined, 'dark'))
      .toEqual({ fontSize: 11, color: '#999999', italic: true });
  });

  it('invents no color on a style that carries none', () => {
    // Heading 1/2 and Title take their hierarchy from size alone; the dark
    // layer must not add a color key, or they would stop inheriting the
    // theme's body ink.
    expect(resolveStyleInline('heading-1', undefined, 'dark')).toEqual({ fontSize: 20 });
    expect(resolveStyleInline('title', undefined, 'dark')).toEqual({ fontSize: 26 });
    expect(resolveStyleInline('normal', undefined, 'dark')).toEqual({});
  });

  it('lets a document override beat the dark remap', () => {
    // A redefined style belongs to the document, not the product: once the
    // user has chosen a color it paints on both surfaces, even if that color
    // happens to be the built-in light grey.
    const docStyles: DocStyles = { 'heading-3': { inline: { color: '#666666' } } };
    expect(resolveStyleInline('heading-3', docStyles, 'dark').color).toBe('#666666');
    expect(resolveStyleInline('heading-3', docStyles, 'light').color).toBe('#666666');
  });

  it('does not mutate the built-in definition when resolving dark', () => {
    resolveStyleInline('heading-3', { 'heading-3': { inline: { color: '#ff0000' } } }, 'dark');
    expect(BUILTIN_STYLES['heading-3'].inline.color).toBe('#434343');
    expect(BUILTIN_STYLES['heading-3'].inlineDark!.color).toBe('#B0B0B0');
  });

  it('restricts the dark layer to color keys', () => {
    // Metrics are resolved surface-blind (`assignLineHeights`,
    // `getLineMaxFontSizePx`), so a dark `fontSize`/`bold` would paint glyphs
    // the measured line never accounted for and the screen would paginate
    // differently from the PDF. The `Pick<>` type enforces this at compile
    // time; this asserts it for the shipped data too.
    const allowed = new Set(['color', 'backgroundColor']);
    for (const id of STYLE_IDS) {
      const dark = BUILTIN_STYLES[id].inlineDark;
      if (!dark) continue;
      for (const key of Object.keys(dark)) expect(allowed.has(key)).toBe(true);
    }
  });
});

describe('named-style greys meet WCAG AA on both surfaces', () => {
  // Recomputed rather than quoted, so retuning a grey — or the dark page
  // background in `view/theme.ts` — fails here instead of shipping an
  // illegible heading.
  const luminance = (hex: string): number => {
    const v = hex.replace('#', '');
    const channel = (i: number) => {
      const c = parseInt(v.slice(i * 2, i * 2 + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // `LightTheme.pageBackground` / `DarkTheme.pageBackground` (view/theme.ts).
  const LIGHT_PAGE = '#ffffff';
  const DARK_PAGE = '#2b2b2b';

  it('sanity-checks the contrast helper against known ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('keeps every light grey ≥ 4.5:1 on the white page', () => {
    for (const id of STYLE_IDS) {
      const color = BUILTIN_STYLES[id].inline.color;
      if (typeof color !== 'string') continue;
      expect(contrast(color, LIGHT_PAGE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps every dark grey ≥ 4.5:1 on the dark page', () => {
    // The bar is AA normal text (4.5:1), not AA-large (3:1). Subtitle (15 pt)
    // and Heading 4/5/6 (12/11/11 pt, none bold) are normal-sized text, so
    // 4.5:1 is mandatory for them. Heading 3 at 14 pt **bold** does sit on the
    // large-text threshold and could legally take 3:1 — it is held to 4.5:1
    // here anyway, because one loop over one bar is the guard worth having and
    // the chosen grey clears it with room (6.53:1).
    for (const id of STYLE_IDS) {
      const color = BUILTIN_STYLES[id].inlineDark?.color;
      if (typeof color !== 'string') continue;
      expect(contrast(color, DARK_PAGE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives every grey-bearing style a dark counterpart', () => {
    // The defect this fixes: a light grey with no dark pair paints literally
    // on `#2b2b2b` (`#434343` scores 1.43:1 there — darker than body text, so
    // the hierarchy inverts).
    for (const id of STYLE_IDS) {
      if (BUILTIN_STYLES[id].inline.color === undefined) continue;
      expect(BUILTIN_STYLES[id].inlineDark?.color).toBeDefined();
    }
  });

  it('keeps the two grey tiers ordered the same way on both surfaces', () => {
    // Heading 3 is the stronger tier; subtitle / heading 4–6 the weaker one.
    // On the light page "stronger" means higher contrast, and so it must on
    // the dark page too — today's rendering reverses it.
    const strongLight = BUILTIN_STYLES['heading-3'].inline.color as string;
    const weakLight = BUILTIN_STYLES['subtitle'].inline.color as string;
    const strongDark = BUILTIN_STYLES['heading-3'].inlineDark!.color as string;
    const weakDark = BUILTIN_STYLES['subtitle'].inlineDark!.color as string;
    expect(contrast(strongLight, LIGHT_PAGE)).toBeGreaterThan(contrast(weakLight, LIGHT_PAGE));
    expect(contrast(strongDark, DARK_PAGE)).toBeGreaterThan(contrast(weakDark, DARK_PAGE));
  });
});

describe('effectiveBlockSpacing', () => {
  it('gives a legacy heading its style space-before', () => {
    // `createBlock` seeds `DEFAULT_BLOCK_STYLE` (0 / 8) — exactly what every
    // non-interactive writer (DOCX import, paste, /api/v1 PUT, the CLI)
    // produces, and the state the reported document was in.
    const h1 = createBlock('heading', { headingLevel: 1 });
    expect(h1.style.marginTop).toBe(0);
    expect(effectiveBlockSpacing(h1)).toEqual({ marginTop: 27, marginBottom: 8, lineHeight: 1.15 });
  });

  it('leaves a paragraph at the defaults', () => {
    expect(effectiveBlockSpacing(createBlock('paragraph')))
      .toEqual({ marginTop: 0, marginBottom: 8, lineHeight: 1.5 });
  });

  it('resolves each built-in style to its own catalog values', () => {
    const title = createBlock('title');
    expect(effectiveBlockSpacing(title)).toEqual({ marginTop: 0, marginBottom: 4, lineHeight: 1.15 });
    const sub = createBlock('subtitle');
    expect(effectiveBlockSpacing(sub)).toEqual({ marginTop: 0, marginBottom: 21, lineHeight: 1.15 });
    const h3 = createBlock('heading', { headingLevel: 3 });
    expect(effectiveBlockSpacing(h3)).toEqual({ marginTop: 21, marginBottom: 5, lineHeight: 1.15 });
  });

  it('lets an authored value win over the style', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.style.marginTop = 40;
    expect(effectiveBlockSpacing(h1).marginTop).toBe(40);
    // A non-default 0 bottom margin (what the PPTX importer writes) is
    // authored, so it must survive rather than snapping back to the style's 8.
    h1.style.marginBottom = 0;
    expect(effectiveBlockSpacing(h1).marginBottom).toBe(0);
  });

  it('lets an authored leading win over the style leading', () => {
    const title = createBlock('title');
    title.style.lineHeight = 2;
    expect(effectiveBlockSpacing(title).lineHeight).toBe(2);
  });

  it('expresses an authored leading that equals the default multiplier', () => {
    // The defect the authored markers exist to fix. The docs toolbar offers 1.5
    // as a line-spacing preset *and* accepts it in the Custom field, so on the
    // six styles whose own leading is not 1.5 (Title, Subtitle, Heading 1–4)
    // the pick lands exactly on `DEFAULT_BLOCK_STYLE.lineHeight`. Under the
    // value sentinel alone that read back as "inherit" and the pick silently
    // did nothing — worse, from an authored 2.0 it jumped the block to the
    // style's leading rather than to 1.5. The marker makes the value stick.
    const title = createBlock('title');
    title.style.lineHeight = 1.5;
    title.style.authoredLineHeight = true;
    expect(effectiveBlockSpacing(title).lineHeight).toBe(1.5);

    // …and the same on the styles where 1.5 is also the inherited value, where
    // it was never observable either way.
    const para = createBlock('paragraph');
    para.style.lineHeight = 1.5;
    para.style.authoredLineHeight = true;
    expect(effectiveBlockSpacing(para).lineHeight).toBe(1.5);
  });

  it('expresses an authored zero space-before (Word\'s "Remove Space Before")', () => {
    // `<w:spacing w:before="0"/>` is what Word's one-click "Remove Space Before
    // Paragraph" emits, and 0 is a valid explicit `ST_TwipsMeasure`. Without
    // the marker it is indistinguishable from `DEFAULT_BLOCK_STYLE.marginTop`
    // and the style's 27 px replaced it.
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.style.marginTop = 0;
    h1.style.authoredMarginTop = true;
    expect(effectiveBlockSpacing(h1).marginTop).toBe(0);

    // Same for `w:after="0"` against Heading 1's 8 px space-after.
    h1.style.marginBottom = 8;
    h1.style.authoredMarginBottom = true;
    expect(effectiveBlockSpacing(h1).marginBottom).toBe(8);
  });

  it('marks each field independently', () => {
    // Per-field markers are the minimum granularity that makes a single-field
    // control safe: the line-spacing picker authors `lineHeight` alone, and a
    // single coarse "this paragraph authored its spacing" flag would have
    // destroyed the heading's 27 px space-before on the same click.
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.style.lineHeight = 1.5;
    h1.style.authoredLineHeight = true;
    expect(effectiveBlockSpacing(h1)).toEqual({
      marginTop: 27, marginBottom: 8, lineHeight: 1.5,
    });
  });

  it('lets a cleared marker beat a non-default value', () => {
    // `false` is not "no information": it says the paragraph authored nothing,
    // so the style supplies the value even though it differs from the default.
    // This is what `materializeBlockSpacing` writes, and it is stronger than
    // the value sentinel — inheritance no longer depends on the block's value
    // happening to equal `DEFAULT_BLOCK_STYLE`'s.
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.style.marginTop = 999;
    h1.style.lineHeight = 3;
    h1.style.authoredMarginTop = false;
    h1.style.authoredLineHeight = false;
    expect(effectiveBlockSpacing(h1).marginTop).toBe(27);
    expect(effectiveBlockSpacing(h1).lineHeight).toBe(1.15);
  });

  it('falls back to the value sentinel when no marker is present', () => {
    // Legacy blocks — everything persisted before the marker existed, and
    // anything written by an older peer — carry no marker, and the value rule
    // is what repairs them at the next repaint with zero CRDT writes.
    const legacy = createBlock('heading', { headingLevel: 1 });
    expect(legacy.style.authoredMarginTop).toBeUndefined();
    expect(effectiveBlockSpacing(legacy)).toEqual({
      marginTop: 27, marginBottom: 8, lineHeight: 1.15,
    });
    legacy.style.marginTop = 40;
    expect(effectiveBlockSpacing(legacy).marginTop).toBe(40);
  });

  it('follows a document-level style override', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    const docStyles: DocStyles = { 'heading-1': { block: { marginTop: 44 } } };
    expect(effectiveBlockSpacing(h1, docStyles).marginTop).toBe(44);
    // Including an override *back to* the sentinel value: the lazy path reads
    // the same registry the eager one writes from, so they cannot disagree.
    expect(effectiveBlockSpacing(h1, { 'heading-1': { block: { marginTop: 0 } } }).marginTop)
      .toBe(0);
  });

  it('degrades to the block values for a corrupt style id', () => {
    const b = createBlock('heading');
    (b as { headingLevel?: number }).headingLevel = 9;
    b.style.marginTop = 0;
    b.style.marginBottom = 8;
    // `blockStyleId` clamps to heading-6, but assert the `??` guard directly
    // by resolving a style whose block sub-key is missing entirely.
    expect(resolveStyleBlock('heading-9' as never)).toEqual({});
    const orphan = createBlock('paragraph');
    orphan.style.marginTop = 0;
    expect(effectiveBlockSpacing(orphan, { 'normal': { block: {} } }))
      .toEqual({ marginTop: 0, marginBottom: 8, lineHeight: 1.5 });
  });

  it('agrees with the eager materialize path for every built-in style', () => {
    // The two paths must produce the same number, or a heading typed in the
    // browser (materialized) and one imported (not) would render differently
    // — which is the whole defect. This is the invariant that lets both live.
    for (const [type, level] of [
      ['paragraph', undefined], ['list-item', undefined],
      ['title', undefined], ['subtitle', undefined],
      ['heading', 1], ['heading', 2], ['heading', 3],
      ['heading', 4], ['heading', 5], ['heading', 6],
    ] as const) {
      const block = createBlock(type, level ? { headingLevel: level } : undefined);
      const eager = materializeBlockSpacing(block);
      // The docs context, because `materializeBlockSpacing` reads the catalog
      // unconditionally and only a docs host resolves `normal` from it.
      const lazy = effectiveBlockSpacing(block, undefined, { normalStyleSpacing: true });
      expect(lazy).toEqual({
        marginTop: eager.marginTop,
        marginBottom: eager.marginBottom,
        lineHeight: eager.lineHeight,
      });
    }
  });

  it('is a provable no-op for registry-less callers (slides / board)', () => {
    // Slides, board and the shared text-box editor lay out `paragraph` /
    // `list-item` blocks with no `DocStyles` and no context, so every one
    // resolves through `normal` — whose catalog values are now Google's body
    // rhythm and emphatically NOT what a slide wants.
    //
    // Assert the property itself rather than the mechanism that delivers it:
    // a registry-less, context-less resolve must return exactly the numbers
    // the block already carries. This survives a future refactor of *how*
    // `normalStyleSpacing` is plumbed, which the previous version of this test
    // — an equality check between `resolveStyleBlock('normal')` and the
    // sentinel — did not.
    for (const type of ['paragraph', 'list-item'] as const) {
      const block = createBlock(type);
      expect(effectiveBlockSpacing(block)).toEqual({
        marginTop: DEFAULT_BLOCK_STYLE.marginTop,
        marginBottom: DEFAULT_BLOCK_STYLE.marginBottom,
        lineHeight: DEFAULT_BLOCK_STYLE.lineHeight,
      });
    }
    // The sentinel itself is still what "unauthored" is measured against.
    expect(STYLE_OWNED_SPACING_DEFAULTS).toEqual({
      marginTop: DEFAULT_BLOCK_STYLE.marginTop,
      marginBottom: DEFAULT_BLOCK_STYLE.marginBottom,
      lineHeight: DEFAULT_BLOCK_STYLE.lineHeight,
    });
  });
});

describe('effectiveBlockSpacing — contextual list spacing', () => {
  const item = () => createBlock('list-item');
  const para = () => createBlock('paragraph');
  const on = (prev?: ReturnType<typeof para>, next?: ReturnType<typeof para>) =>
    ({ prev, next, contextualListSpacing: true });

  it('closes the gap between adjacent items and keeps it around the run', () => {
    const [a, b, c] = [item(), item(), item()];
    // First item: paragraph above, bullet below → keeps its space-before,
    // drops its space-after.
    expect(effectiveBlockSpacing(a, undefined, on(para(), b)))
      .toMatchObject({ marginTop: 0, marginBottom: 0 });
    // Middle: both gaps closed.
    expect(effectiveBlockSpacing(b, undefined, on(a, c)))
      .toMatchObject({ marginTop: 0, marginBottom: 0 });
    // Last: bullet above, paragraph below → keeps the 8px after the list.
    expect(effectiveBlockSpacing(c, undefined, on(b, para())))
      .toMatchObject({ marginTop: 0, marginBottom: 8 });
  });

  it('leaves a one-item list alone', () => {
    expect(effectiveBlockSpacing(item(), undefined, on(para(), para())))
      .toMatchObject({ marginTop: 0, marginBottom: 8 });
  });

  it('separates two lists split by a paragraph', () => {
    // The last item of the first list and the first of the second each keep
    // their outer gap, so the intervening paragraph is not glued to either.
    expect(effectiveBlockSpacing(item(), undefined, on(item(), para())).marginBottom).toBe(8);
    expect(effectiveBlockSpacing(item(), undefined, on(para(), item())).marginBottom).toBe(0);
  });

  it('never touches a paragraph, even between two list items', () => {
    expect(effectiveBlockSpacing(para(), undefined, on(item(), item())))
      .toMatchObject({ marginTop: 0, marginBottom: 8 });
  });

  it('leaves an authored gap on a middle item intact', () => {
    // Direct paragraph formatting always wins — otherwise pasting paragraphs
    // that carry custom spacing into a list would silently flatten them.
    const b = item();
    b.style.marginBottom = 20;
    expect(effectiveBlockSpacing(b, undefined, on(item(), item())).marginBottom).toBe(20);
  });

  it('is inert with the flag off (the slides / board path)', () => {
    expect(effectiveBlockSpacing(item(), undefined, { prev: item(), next: item() }))
      .toMatchObject({ marginTop: 0, marginBottom: 8 });
    expect(effectiveBlockSpacing(item(), undefined)).toMatchObject({ marginTop: 0, marginBottom: 8 });
  });
});

describe('markAuthoredSpacing', () => {
  it('stamps only the spacing fields the patch actually carries', () => {
    // The line-spacing picker's patch. It must claim the leading and nothing
    // else — the block's space-before still belongs to its named style.
    expect(markAuthoredSpacing({ lineHeight: 1.5 })).toEqual({
      lineHeight: 1.5, authoredLineHeight: true,
    });
    expect(markAuthoredSpacing({ marginTop: 0, marginBottom: 8 })).toEqual({
      marginTop: 0, marginBottom: 8,
      authoredMarginTop: true, authoredMarginBottom: true,
    });
  });

  it('claims nothing for a patch with no spacing in it', () => {
    // Alignment buttons and indent/outdent (`marginLeft`) go through the same
    // funnel; neither authors spacing, so neither may mark it.
    expect(markAuthoredSpacing({ alignment: 'center' })).toEqual({ alignment: 'center' });
    expect(markAuthoredSpacing({ marginLeft: 36 })).toEqual({ marginLeft: 36 });
    expect(markAuthoredSpacing({})).toEqual({});
  });

  it('leaves an explicit marker in the patch alone', () => {
    // The un-author affordance: a caller that means "return this field to the
    // style" passes `false` and the stamp must not overwrite it.
    expect(markAuthoredSpacing({ lineHeight: 1.5, authoredLineHeight: false })).toEqual({
      lineHeight: 1.5, authoredLineHeight: false,
    });
  });

  it('ignores a non-finite value', () => {
    expect(markAuthoredSpacing({ lineHeight: NaN }).authoredLineHeight).toBeUndefined();
  });
});

describe('materializeBlockSpacing clears the authored markers', () => {
  it('writes false, not true', () => {
    // Applying a named style is Google Docs' "clear direct paragraph
    // formatting". Marking the materialized values as *authored* instead would
    // pin the block to whatever literal it was materialized with — invisible
    // while `writeStylesAndRematerialize` keeps re-syncing, but permanent for a
    // block that leaves that loop (a copy, an `/api/v1` PUT, a document copy).
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.style.lineHeight = 2;
    h1.style.authoredLineHeight = true;
    const materialized = materializeBlockSpacing(h1);
    expect(materialized).toMatchObject({
      marginTop: 27, marginBottom: 8, lineHeight: 1.15,
      ...clearAuthoredSpacing(),
    });
    expect(clearAuthoredSpacing()).toEqual({
      authoredMarginTop: false, authoredMarginBottom: false, authoredLineHeight: false,
    });
  });

  it('leaves a materialized block tracking a later redefinition', () => {
    // The concrete failure a `true` marker would cause: materialize against
    // one registry, then resolve against another.
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.style = materializeBlockSpacing(h1);
    const redefined: DocStyles = { 'heading-1': { block: { marginTop: 40 } } };
    expect(effectiveBlockSpacing(h1, redefined).marginTop).toBe(40);
  });

  it('is what rematerializeDocSpacing writes', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.style.marginTop = 5;
    h1.style.authoredMarginTop = true;
    rematerializeDocSpacing({ blocks: [h1] } as Document);
    expect(h1.style.marginTop).toBe(27);
    expect(h1.style.authoredMarginTop).toBe(false);
  });
});

describe('the style registry never carries an authored marker', () => {
  it('effectiveBlockSpacing returns only the three numbers', () => {
    // `updateStyleToMatch` feeds this straight into `NamedStyleDef.block`. A
    // marker leaking in would inject direct-formatting flags into every block
    // the style governs on the next materialize, and `materializeBlockSpacing`
    // spreads the registry *before* it clears — so the clear would be the only
    // thing standing between the registry and a permanently pinned document.
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.style.lineHeight = 1.5;
    h1.style.authoredLineHeight = true;
    expect(Object.keys(effectiveBlockSpacing(h1)).sort())
      .toEqual(['lineHeight', 'marginBottom', 'marginTop']);
  });

  it('a marker that somehow reached the registry cannot survive materialize', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    const corrupt = {
      'heading-1': { block: { marginTop: 27, authoredMarginTop: true } },
    } as DocStyles;
    expect(materializeBlockSpacing(h1, corrupt).authoredMarginTop).toBe(false);
  });
});

describe('effectiveBlockSpacing is a no-op without a registry (slides / board)', () => {
  // Slides, board and the shared text-box editor lay out through the same
  // `computeLayout` but pass no `docStyles`, and every one of their blocks is a
  // `paragraph` or `list-item` → `normal`. The property that must hold for all
  // of them is the strongest form: whatever the block carries comes back out.
  const fields = ['marginTop', 'marginBottom', 'lineHeight'] as const;
  const markers = {
    marginTop: 'authoredMarginTop',
    marginBottom: 'authoredMarginBottom',
    lineHeight: 'authoredLineHeight',
  } as const;

  for (const type of ['paragraph', 'list-item'] as const) {
    for (const field of fields) {
      for (const marker of [true, undefined] as const) {
        for (const value of [DEFAULT_BLOCK_STYLE[field], 42.5] as const) {
          it(`${type}.${field} = ${value} (marker ${String(marker)}) round-trips`, () => {
            const b = createBlock(type);
            b.style[field] = value;
            if (marker !== undefined) b.style[markers[field]] = marker;
            expect(effectiveBlockSpacing(b)[field]).toBe(value);
          });
        }
      }
    }
  }

  it('falls back to the defaults for a BlockStyle missing its numbers', () => {
    // `BlockStyle` is a persisted shape (CRDT, /api/v1 PUT, DOCX/PPTX import),
    // so `marginTop: number` is a claim, not a guarantee. Before the
    // `authoredOr` guard this returned the raw `undefined`, which reached
    // `Math.max(1, lineHeight)` in `assignLineHeights` as `NaN` — a line box of
    // NaN height, i.e. a document that paints nothing at all. Layout used to
    // carry the defence itself (`?? 1.5`); resolving spacing here moved the
    // responsibility, so the guard has to live here.
    const bare = { ...createBlock('paragraph'), style: {} } as unknown as Parameters<
      typeof effectiveBlockSpacing
    >[0];
    const spacing = effectiveBlockSpacing(bare);
    expect(spacing).toEqual({
      marginTop: DEFAULT_BLOCK_STYLE.marginTop,
      marginBottom: DEFAULT_BLOCK_STYLE.marginBottom,
      lineHeight: DEFAULT_BLOCK_STYLE.lineHeight,
    });
    // The property that actually matters downstream.
    expect(Math.max(1, spacing.lineHeight)).not.toBeNaN();
  });

  it('the one divergent branch, `false`, is unreachable without a registry', () => {
    // `false` is written by exactly one function — `materializeBlockSpacing` —
    // which slides/board never call: no `setBlockType` on a slides text body,
    // no named-style registry, no `rematerializeDocSpacing`. Asserted here so
    // the exception is documented rather than merely absent from the matrix.
    const b = createBlock('paragraph');
    b.style.marginBottom = 0;
    b.style.authoredMarginBottom = false;
    expect(effectiveBlockSpacing(b).marginBottom).toBe(DEFAULT_BLOCK_STYLE.marginBottom);
  });
});
