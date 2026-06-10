import { describe, it, test, expect } from 'vitest';
import { FontRegistry, resolveFontFamily } from '../../src/view/fonts.js';

describe('FontRegistry', () => {
  it('should resolve known Korean font to fallback chain', () => {
    expect(resolveFontFamily('맑은 고딕')).toBe("'Malgun Gothic', 'Noto Sans KR', sans-serif");
  });

  it('should resolve HY헤드라인M to Noto Sans KR fallback', () => {
    expect(resolveFontFamily('HY헤드라인M')).toBe("'Noto Sans KR', sans-serif");
  });

  it('Latin sans family gets Korean fallback spliced before generic', () => {
    // Hangul runs that the importer tagged with a Latin face (e.g. Arial)
    // must still render with proper Korean glyphs. The browser picks Noto
    // Sans KR per-glyph thanks to the spliced fallback.
    expect(resolveFontFamily('Arial')).toBe("'Arial', 'Noto Sans KR', sans-serif");
  });

  it('unknown family gets generic + Korean fallback', () => {
    // PPTX decks often carry brand fonts like "NanumSquare Neo OTF Bold"
    // that no client machine has and we have no catalog entry for. The
    // family name still survives, but Korean text needs a fallback.
    expect(resolveFontFamily('SomeRandomFont')).toBe(
      "'SomeRandomFont', 'Noto Sans KR', sans-serif",
    );
    expect(resolveFontFamily('NanumSquare Neo OTF Bold')).toBe(
      "'NanumSquare Neo OTF Bold', 'Noto Sans KR', sans-serif",
    );
  });

  it('should resolve 바탕 to serif chain', () => {
    expect(resolveFontFamily('바탕')).toBe("'Batang', 'Noto Serif KR', serif");
  });

  it('serif family gets Noto Serif KR fallback (not Noto Sans KR)', () => {
    expect(resolveFontFamily('Times New Roman')).toBe(
      "'Times New Roman', 'Times', 'Noto Serif KR', serif",
    );
    expect(resolveFontFamily('Georgia')).toBe("'Georgia', 'Noto Serif KR', serif");
  });

  it('does not double-append Korean fallback when chain already contains it', () => {
    // Noto Sans KR is itself Korean-capable; injecting Noto Sans KR again
    // would just duplicate the entry. Same for chains that already include
    // 'Malgun Gothic' (which maps to a stack that already names Noto Sans KR).
    expect(resolveFontFamily('Noto Sans KR')).toBe("'Noto Sans KR', sans-serif");
    expect(resolveFontFamily('맑은 고딕')).toBe(
      "'Malgun Gothic', 'Noto Sans KR', sans-serif",
    );
    // Sanity: Noto Sans KR appears exactly once.
    expect(
      resolveFontFamily('맑은 고딕').match(/Noto Sans KR/g)?.length,
    ).toBe(1);
  });

  it('monospace family skips Korean fallback (variable-width KR would break alignment)', () => {
    expect(resolveFontFamily('Courier New')).toBe("'Courier New', 'Courier', monospace");
    expect(resolveFontFamily('Courier New')).not.toMatch(/Noto Sans KR/);
  });

  it('FontRegistry should report pending status for unknown font', () => {
    const registry = new FontRegistry();
    expect(registry.getFontStatus('Arial')).toBe('pending');
  });

  it('should escape single quotes in unknown font family names', () => {
    // Issue 3: A font name containing a single quote (e.g. from a DOCX file)
    // must produce valid CSS — the quote must be escaped so it does not break
    // out of the surrounding single-quoted string.
    const result = resolveFontFamily("O'Connor Sans");
    expect(result).toBe("'O\\'Connor Sans', 'Noto Sans KR', sans-serif");
    // Ensure the raw string is valid: it must not contain an unescaped ' that
    // would terminate the CSS quoted string prematurely.
    expect(result.indexOf("'O'")).toBe(-1);
  });

  it('should escape backslashes in unknown font family names', () => {
    const result = resolveFontFamily('Font\\Name');
    expect(result).toBe("'Font\\\\Name', 'Noto Sans KR', sans-serif");
  });
});

describe('resolveFontFamily — catalog coverage', () => {
  test.each([
    ['맑은 고딕', /Malgun Gothic/],
    ['Noto Sans KR', /Noto Sans KR/],
    ['Noto Serif KR', /Noto Serif KR/],
    ['Nanum Gothic', /Nanum Gothic/],
    ['Nanum Myeongjo', /Nanum Myeongjo/],
    ['Gothic A1', /Gothic A1/],
    ['Gowun Dodum', /Gowun Dodum/],
    ['Gowun Batang', /Gowun Batang/],
    ['Roboto', /Roboto/],
    ['Helvetica', /Helvetica/],
    ['Georgia', /Georgia/],
    ['Cambria', /Cambria/],
    ['Times New Roman', /Times New Roman/],
    ['Courier New', /Courier New/],
  ])('resolves %s with a fallback chain', (family, expected) => {
    expect(resolveFontFamily(family)).toMatch(expected);
  });

  test('Noto Serif KR ends in serif fallback', () => {
    expect(resolveFontFamily('Noto Serif KR')).toMatch(/serif$/);
  });

  test('Courier New ends in monospace fallback', () => {
    expect(resolveFontFamily('Courier New')).toMatch(/monospace$/);
  });

  test('Korean serif catalog entries end in serif', () => {
    expect(resolveFontFamily('Nanum Myeongjo')).toMatch(/serif$/);
    expect(resolveFontFamily('Gowun Batang')).toMatch(/serif$/);
  });
});

describe('resolveFontFamily — PPTX typeface normalization', () => {
  test('strips trailing weight suffix to hit the catalog', () => {
    // PPTX writes each weight as its own family name. The canonical
    // family is in FONT_MAP; the verbose form should normalize to it
    // so Google Fonts serves the matching face. The verbatim name is
    // PREPENDED before the canonical entry so a user with the
    // weight-specific cut installed locally ("Gothic A1 Bold" as its
    // own face) still gets the real glyph rather than CSS-synthesized
    // bold off the regular weight.
    expect(resolveFontFamily('Gothic A1 Bold')).toBe(
      "'Gothic A1 Bold', 'Gothic A1', 'Noto Sans KR', sans-serif",
    );
    expect(resolveFontFamily('Nanum Gothic ExtraBold')).toBe(
      "'Nanum Gothic ExtraBold', 'Nanum Gothic', 'Noto Sans KR', sans-serif",
    );
  });

  test('strips OTF + weight suffixes together', () => {
    // Repro file uses "NanumSquare Neo OTF Bold". NanumSquare Neo
    // itself isn't in the catalog yet (not on Google Fonts), so the
    // normalized form still falls through to the generic path — but
    // crucially the Korean fallback gets spliced in regardless, so
    // Hangul renders properly via Noto Sans KR. The verbatim family
    // name stays on the chain in case the user's machine has the
    // brand font installed locally.
    expect(resolveFontFamily('NanumSquare Neo OTF Bold')).toBe(
      "'NanumSquare Neo OTF Bold', 'Noto Sans KR', sans-serif",
    );
    expect(resolveFontFamily('NanumSquare Neo OTF Regular')).toBe(
      "'NanumSquare Neo OTF Regular', 'Noto Sans KR', sans-serif",
    );
    // When the normalized base IS in the catalog, the verbatim form
    // is prepended to the canonical mapping so installed-Bold faces
    // are tried first.
    expect(resolveFontFamily('Gothic A1 OTF Bold')).toBe(
      "'Gothic A1 OTF Bold', 'Gothic A1', 'Noto Sans KR', sans-serif",
    );
  });

  test('case-insensitive suffix matching matches LibreOffice / Google output', () => {
    // LibreOffice often emits 'Pretendard Semibold' (lowercase b);
    // Google Slides sometimes lowercases the whole word. Stripping
    // must hit the catalog either way.
    expect(resolveFontFamily('Gothic A1 bold')).toBe(
      "'Gothic A1 bold', 'Gothic A1', 'Noto Sans KR', sans-serif",
    );
    expect(resolveFontFamily('Gothic A1 BOLD')).toBe(
      "'Gothic A1 BOLD', 'Gothic A1', 'Noto Sans KR', sans-serif",
    );
    expect(resolveFontFamily('Nanum Gothic semibold')).toBe(
      "'Nanum Gothic semibold', 'Nanum Gothic', 'Noto Sans KR', sans-serif",
    );
  });

  test('does not strip "Italic" (style axis, not a weight)', () => {
    // Many real families ship with 'Italic' baked into the canonical
    // family name (e.g. 'Lucida Sans Italic'). Stripping it would
    // route the lookup to the upright cut, dropping the italic axis
    // entirely. The italic style is carried separately by
    // `InlineStyle.italic`.
    expect(resolveFontFamily('Lucida Sans Italic')).toBe(
      "'Lucida Sans Italic', 'Noto Sans KR', sans-serif",
    );
  });

  test('resolveFontFamily is idempotent (a resolved chain returns unchanged)', () => {
    // The exported API may be called by external surfaces (or future
    // code paths) on a value that has already been resolved. Without
    // idempotency, the escape path would re-wrap the inner quotes into
    // garbage CSS. Detection: any comma in the input means it's
    // already a chain (CSS forbids unescaped commas in identifiers).
    const chain = "'Arial', 'Noto Sans KR', sans-serif";
    expect(resolveFontFamily(chain)).toBe(chain);
  });

  test('canonical family without suffix is unaffected', () => {
    // Sanity check: the normalizer is a fallback path, never overrides
    // a direct catalog hit. "Cambria" without a weight suffix resolves
    // through FONT_MAP['Cambria'] verbatim, not through the normalizer.
    expect(resolveFontFamily('Cambria')).toBe(
      "'Cambria', 'Georgia', 'Noto Serif KR', serif",
    );
  });
});
