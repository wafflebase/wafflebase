import { describe, it, expect } from 'vitest';
import {
  buildRunPropertiesXml,
  buildParagraphPropertiesXml,
  toDocxHexColor,
} from '../../src/export/docx-style-map.js';
import { LIST_PARAGRAPH_STYLE_ID, STYLES } from '../../src/export/docx-templates.js';

describe('buildRunPropertiesXml', () => {
  it('should generate bold tag', () => {
    const xml = buildRunPropertiesXml({ bold: true });
    expect(xml).toContain('<w:b/>');
  });

  it('should generate font size in half-points', () => {
    const xml = buildRunPropertiesXml({ fontSize: 12 });
    expect(xml).toContain('<w:sz w:val="24"/>');
    expect(xml).toContain('<w:szCs w:val="24"/>');
  });

  it('should generate font family', () => {
    const xml = buildRunPropertiesXml({ fontFamily: 'Arial' });
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).toContain('w:hAnsi="Arial"');
    // Latin face: the East Asian slot defaults to Noto Sans KR so
    // Hangul runs render with Korean glyphs in Word, matching what the
    // docs view paints via the render-time Korean fallback splice.
    expect(xml).toContain('w:eastAsia="Noto Sans KR"');
  });

  it('keeps a Korean-capable family on the East Asian slot', () => {
    const xml = buildRunPropertiesXml({ fontFamily: 'Malgun Gothic' });
    expect(xml).toContain('w:ascii="Malgun Gothic"');
    expect(xml).toContain('w:eastAsia="Malgun Gothic"');
    expect(xml).not.toContain('Noto Sans KR');
  });

  it('emits Arial / Noto Sans KR defaults when no font family is set', () => {
    // Previously an undefined fontFamily skipped the rFonts block
    // entirely; Word then rendered Hangul-only runs with the doc
    // default (Calibri). Always emitting rFonts keeps Word in sync
    // with the docs view's render-time fallback.
    const xml = buildRunPropertiesXml({});
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).toContain('w:hAnsi="Arial"');
    expect(xml).toContain('w:eastAsia="Noto Sans KR"');
  });

  it('XML-escapes hostile fontFamily values in rFonts attributes', () => {
    // style.fontFamily originates from untrusted sources (PPTX/DOCX
    // imports, user input in the picker). Without escaping, a family
    // name containing XML-reserved characters (`&`, `"`, `<`, `>`)
    // would break the rFonts element or open it to attribute
    // injection in DOCX viewers.
    const xml = buildRunPropertiesXml({ fontFamily: 'A"B&<>C' });
    expect(xml).toContain('w:ascii="A&quot;B&amp;&lt;&gt;C"');
    expect(xml).toContain('w:hAnsi="A&quot;B&amp;&lt;&gt;C"');
    // The raw characters must NOT appear unescaped inside the
    // attribute — if any did, the surrounding "..." would close early
    // and Word would treat the rest as new attributes / elements.
    expect(xml).not.toContain('w:ascii="A"B');
    expect(xml).not.toContain('w:ascii="A&B');
  });

  it('escapes ampersand first so the other replacements do not re-escape it', () => {
    // If `&` were replaced after `<` / `>` / `"`, the entity references
    // those produced (`&lt;`, `&quot;`) would themselves get rewritten
    // into `&amp;lt;` / `&amp;quot;` — visibly garbled inside Word.
    const xml = buildRunPropertiesXml({ fontFamily: '<b>' });
    expect(xml).toContain('w:ascii="&lt;b&gt;"');
    expect(xml).not.toContain('w:ascii="&amp;lt;');
  });

  it('should generate color', () => {
    const xml = buildRunPropertiesXml({ color: '#FF0000' });
    expect(xml).toContain('<w:color w:val="FF0000"/>');
  });

  it('drops a hostile color value instead of emitting it into w:color', () => {
    // `defaultColorResolver` passes any string through verbatim, and
    // `InlineStyle.color` really can hold a non-palette string (DOCX/PPTX
    // import, HTML paste, the legacy '' reset of issue #728). Emitted
    // verbatim, a value carrying `"` would close the attribute and inject
    // OOXML; even escaped it would be an invalid ST_HexColor, so it is
    // dropped entirely and the run inherits the document default.
    const xml = buildRunPropertiesXml({ color: 'a" w:themeColor="dark1' });
    expect(xml).not.toContain('<w:color');
    expect(xml).not.toContain('w:themeColor="dark1"');
    expect(xml).not.toContain('dark1');
  });

  it('drops a hostile backgroundColor value instead of emitting a w:shd fill', () => {
    const xml = buildRunPropertiesXml({ backgroundColor: 'a"/><w:b' });
    expect(xml).not.toContain('<w:shd');
    expect(xml).not.toContain('w:fill="a"/>');
  });

  it('drops the legacy empty-string reset color (issue #728)', () => {
    const xml = buildRunPropertiesXml({ color: '', backgroundColor: '' });
    expect(xml).not.toContain('<w:color');
    expect(xml).not.toContain('<w:shd');
  });
});

describe('toDocxHexColor', () => {
  it('normalizes hex forms to six upper-case digits', () => {
    expect(toDocxHexColor('#ff0000')).toBe('FF0000');
    expect(toDocxHexColor('ff0000')).toBe('FF0000');
    expect(toDocxHexColor('#abc')).toBe('AABBCC');
    // #RRGGBBAA — DOCX has no per-run alpha, so the alpha byte is dropped.
    expect(toDocxHexColor('#11223344')).toBe('112233');
  });

  it('drops a fully transparent color rather than shading it solid', () => {
    // `w:shd` has no alpha channel, so keeping the triplet would paint a
    // solid block behind text that is invisible on screen.
    expect(toDocxHexColor('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(toDocxHexColor('#11223300')).toBeUndefined();
  });

  it('converts the CSS rgb()/rgba() forms browsers hand back on paste', () => {
    // `view/clipboard.ts` copies the pasted HTML's CSS straight into
    // style.color, and every browser normalizes colors to `rgb(...)`.
    expect(toDocxHexColor('rgb(255, 0, 0)')).toBe('FF0000');
    expect(toDocxHexColor('rgba(0, 128, 255, 0.5)')).toBe('0080FF');
    // Out-of-range channels clamp rather than producing >2 hex digits.
    expect(toDocxHexColor('rgb(300, -5, 0)')).toBe('FF0000');
  });

  it('returns undefined for anything not expressible as ST_HexColor', () => {
    expect(toDocxHexColor('')).toBeUndefined();
    expect(toDocxHexColor(undefined)).toBeUndefined();
    expect(toDocxHexColor('red')).toBeUndefined();
    expect(toDocxHexColor('var(--fg)')).toBeUndefined();
    expect(toDocxHexColor('a" w:themeColor="dark1')).toBeUndefined();
  });
});

const BODY_STYLE = {
  alignment: 'left' as const,
  lineHeight: 1.5,
  marginTop: 0,
  marginBottom: 8,
  textIndent: 0,
  marginLeft: 0,
};

describe('buildParagraphPropertiesXml', () => {
  it('should generate center alignment', () => {
    const xml = buildParagraphPropertiesXml({ alignment: 'center', lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 });
    expect(xml).toContain('<w:jc w:val="center"/>');
  });

  it('should generate justify as "both"', () => {
    const xml = buildParagraphPropertiesXml({ alignment: 'justify', lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 });
    expect(xml).toContain('<w:jc w:val="both"/>');
  });

  it('emits the heading style for a real level', () => {
    const xml = buildParagraphPropertiesXml(BODY_STYLE, 3);
    expect(xml).toContain('<w:pStyle w:val="Heading3"/>');
  });

  it('drops an alignment that is not an ST_Jc token instead of interpolating it', () => {
    // `alignment` is typed, but the value reaching the exporter is whatever
    // was persisted into the CRDT (import, the content PUT API), so a
    // hostile string must not reach the `w:val` attribute.
    const xml = buildParagraphPropertiesXml({
      alignment: 'center"/><w:jc w:val="right' as never,
      lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0,
    });
    expect(xml).not.toContain('<w:jc');
  });

  it('omits w:line for the inherit sentinel and emits it for an authored leading', () => {
    // "Omit" here means the same thing `effectiveBlockSpacing` means by it:
    // the paragraph overrode nothing, so Word applies its own style leading —
    // which is the .docx analogue of resolving through the named style.
    const at = (lineHeight: number) => buildParagraphPropertiesXml({
      alignment: 'left', lineHeight, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0,
    });
    expect(at(1.5)).not.toContain('w:line');
    expect(at(2)).toContain('w:line="480"');
    // `w:lineRule` is written explicitly: `auto` is ECMA-376's default for the
    // attribute, but Word always writes it and the importer's `w:line / 240`
    // only makes sense under `auto`.
    expect(at(2)).toContain('w:lineRule="auto"');
  });

  it('round-trips an authored value that equals the default', () => {
    // Without the marker, an authored `lineHeight: 1.5` on a Heading 1 exports
    // to nothing (1.5 *is* `DEFAULT_BLOCK_STYLE.lineHeight`) and re-imports as
    // the style's 1.2, and an authored `marginTop: 0` exports to nothing and
    // re-imports as 27 — one export→import cycle would destroy the very
    // distinction the marker exists to record.
    const xml = buildParagraphPropertiesXml({
      alignment: 'left', lineHeight: 1.5, marginTop: 0, marginBottom: 8,
      textIndent: 0, marginLeft: 0,
      authoredLineHeight: true, authoredMarginTop: true, authoredMarginBottom: true,
    });
    expect(xml).toContain('w:line="360"');
    expect(xml).toContain('w:before="0"');
    expect(xml).toContain('w:after="120"');
  });

  it('a cleared marker still exports today\'s value-based output', () => {
    // `||`, not `??`: a materialized Heading 1 (`authored* === false`,
    // `marginTop: 27`) keeps exporting the `w:before="405"` it exports today.
    // That output is arguably wrong — it doubles Word's own Heading 1
    // space-before — but it is pre-existing and changing it touches every
    // heading in every exported file, so it is a follow-up with its own
    // baselines rather than a side effect of the marker.
    const xml = buildParagraphPropertiesXml({
      alignment: 'left', lineHeight: 1.2, marginTop: 27, marginBottom: 8,
      textIndent: 0, marginLeft: 0,
      authoredLineHeight: false, authoredMarginTop: false, authoredMarginBottom: false,
    });
    expect(xml).toContain('w:before="405"');
    expect(xml).toContain('w:line="288"');
  });

  it('emits <w:contextualSpacing/> only for a list item', () => {
    // Word's own "Don't add space between paragraphs of the same style" — how
    // the editor's contextual list rhythm survives an export. The computed
    // zero is deliberately not exported instead: it depends on the block's
    // neighbours, so a bullet inserted or removed *in Word* would re-resolve
    // against a stale baked-in number.
    expect(buildParagraphPropertiesXml(BODY_STYLE, undefined, { listItem: true }))
      .toContain('<w:contextualSpacing/>');
    expect(buildParagraphPropertiesXml(BODY_STYLE)).not.toContain('<w:contextualSpacing/>');
    expect(buildParagraphPropertiesXml(BODY_STYLE, undefined, { listItem: false }))
      .not.toContain('<w:contextualSpacing/>');
  });

  it('pairs <w:contextualSpacing/> with the ListParagraph style', () => {
    // The defect this pins: ECMA-376 §17.3.1.9 scopes `w:contextualSpacing` to
    // paragraphs "of the same style", and this exporter gives body paragraphs
    // no `w:pStyle` at all. Emitting the element on an otherwise-unstyled
    // paragraph therefore suppressed the space after the LAST bullet too,
    // against the plain paragraph that follows the list — the editor paints
    // 8 px there, Word rendered 0. A distinct paragraph style is the fix, so
    // the two elements must always travel together.
    const xml = buildParagraphPropertiesXml(BODY_STYLE, undefined, { listItem: true });
    expect(xml).toContain('<w:pStyle w:val="ListParagraph"/>');
    expect(xml).toContain('<w:contextualSpacing/>');
    // …and a body paragraph must stay style-less, which is the other half of
    // "different style": giving both the same id would restore the bug.
    expect(buildParagraphPropertiesXml(BODY_STYLE)).not.toContain('<w:pStyle');
  });

  it('never emits two <w:pStyle> elements in one <w:pPr>', () => {
    // `Block.type` is either `heading` or `list-item`, never both, so this is
    // defensive — but two `w:pStyle` children violate `CT_PPr` and Word
    // refuses the file outright, which is a worse failure than a mis-spaced
    // bullet. The heading style wins.
    const xml = buildParagraphPropertiesXml(BODY_STYLE, 2, { listItem: true });
    expect(xml.match(/<w:pStyle /g)).toHaveLength(1);
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
  });

  it('places <w:contextualSpacing/> after <w:ind>, per CT_PPr', () => {
    // `CT_PPr` sequences …`w:spacing`, `w:ind`, `w:contextualSpacing`… A newly
    // added element gets its schema slot; `w:jc`'s pre-existing early position
    // is left alone because every file this exporter has already shipped
    // carries it.
    const xml = buildParagraphPropertiesXml(
      { ...BODY_STYLE, marginLeft: 36 },
      undefined,
      { listItem: true },
    );
    expect(xml.indexOf('<w:ind ')).toBeLessThan(xml.indexOf('<w:contextualSpacing/>'));
  });
});

describe('styles.xml defines every style a paragraph references', () => {
  // A `w:pStyle` naming a style `styles.xml` does not define resolves to the
  // default style. For `ListParagraph` that is not a cosmetic loss: it makes
  // every exported list item `Normal` again, which is precisely the state in
  // which `w:contextualSpacing` eats the gap after the last bullet. Word would
  // also fill the gap from its own built-in "List Paragraph" gallery entry —
  // including its `w:ind w:left="720"` — indenting items the editor painted
  // flush. Both failures are silent in the file, so assert the definition.
  it('defines ListParagraph, based on Normal, with no metrics of its own', () => {
    expect(STYLES).toContain('w:styleId="ListParagraph"');
    expect(STYLES).toContain('<w:name w:val="List Paragraph"/>');
    expect(STYLES).toContain('<w:basedOn w:val="Normal"/>');
    // No indent, no spacing: the style exists to be a distinct *identity*, not
    // to move anything.
    const listStyle = STYLES.slice(STYLES.indexOf('w:styleId="ListParagraph"'));
    expect(listStyle).not.toContain('<w:ind');
    expect(listStyle).not.toContain('<w:spacing');
  });

  it('uses the same style id the paragraph writer references', () => {
    expect(LIST_PARAGRAPH_STYLE_ID).toBe('ListParagraph');
    expect(STYLES).toContain(`w:styleId="${LIST_PARAGRAPH_STYLE_ID}"`);
    expect(buildParagraphPropertiesXml(BODY_STYLE, undefined, { listItem: true }))
      .toContain(`<w:pStyle w:val="${LIST_PARAGRAPH_STYLE_ID}"/>`);
  });
});

describe('DOCX_ALIGNMENTS is a closed lookup', () => {
  // A plain object literal consults the prototype chain, so `toString` and
  // friends would resolve to an inherited member, survive the `?? 'left'`
  // fallback and be stringified into the attribute
  // (`<w:jc w:val="function toString() { [native code] }"/>`).
  it.each(['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty'])(
    'ignores the inherited key %s',
    (key) => {
      const xml = buildParagraphPropertiesXml({
        alignment: key as never,
        lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0,
      });
      expect(xml).not.toContain('<w:jc');
    },
  );
});

describe('heading level → <w:pStyle w:val>', () => {
  const style = {
    lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0,
  } as never;

  it('emits HeadingN for each of the six built-in levels', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(buildParagraphPropertiesXml(style, level)).toContain(
        `<w:pStyle w:val="Heading${level}"/>`,
      );
    }
  });

  it('emits no pStyle when there is no heading level', () => {
    expect(buildParagraphPropertiesXml(style)).not.toContain('<w:pStyle');
    expect(buildParagraphPropertiesXml(style, undefined)).not.toContain('<w:pStyle');
  });

  it('drops an out-of-range or non-integer level rather than emitting it', () => {
    for (const level of [0, -1, 7, 99, 1.5, NaN, Infinity]) {
      expect(buildParagraphPropertiesXml(style, level)).not.toContain('<w:pStyle');
    }
  });

  it('never interpolates a hostile heading level into the attribute', () => {
    // `headingLevel` reaches this exporter as whatever was persisted (DOCX
    // import, the content PUT API) — both CRDT readers coerce it with
    // `Number(...)`, which yields NaN rather than failing.
    const hostile = '1"/><w:pStyle w:val="Evil' as unknown as number;
    const xml = buildParagraphPropertiesXml(style, hostile);
    expect(xml).not.toContain('<w:pStyle');
    expect(xml).not.toContain('Evil');
    expect(buildParagraphPropertiesXml(style, 'constructor' as unknown as number))
      .not.toContain('<w:pStyle');
  });
});
