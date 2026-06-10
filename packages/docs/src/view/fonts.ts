/**
 * Font registry — maps font family names to web-safe fallback chains
 * and handles on-demand font loading via the CSS Font Loading API.
 */

const FONT_MAP: Record<string, string> = {
  // Korean families — every chain ends with a Noto KR safety net before
  // the generic so missing-glyph coverage is uniform (some catalog
  // faces, e.g. Nanum Gothic, lack a few rare Hangul codepoints that
  // Noto KR covers). The trailing Noto KR is also what
  // `stackContainsKoreanFamily` keys off when deciding whether to
  // double-append the script fallback, so keeping Korean entries
  // consistent here makes the capability set self-deriving.
  '맑은 고딕': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  'Malgun Gothic': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  '바탕': "'Batang', 'Noto Serif KR', serif",
  'Batang': "'Batang', 'Noto Serif KR', serif",
  'Noto Sans KR': "'Noto Sans KR', sans-serif",
  'Noto Serif KR': "'Noto Serif KR', serif",
  'Nanum Gothic': "'Nanum Gothic', 'Noto Sans KR', sans-serif",
  'Nanum Myeongjo': "'Nanum Myeongjo', 'Noto Serif KR', serif",
  'Gothic A1': "'Gothic A1', 'Noto Sans KR', sans-serif",
  'Gowun Dodum': "'Gowun Dodum', 'Noto Sans KR', sans-serif",
  'Gowun Batang': "'Gowun Batang', 'Noto Serif KR', serif",
  'HY헤드라인M': "'Noto Sans KR', sans-serif",
  'Arial': "'Arial', sans-serif",
  'Helvetica': "'Helvetica', 'Arial', sans-serif",
  'Roboto': "'Roboto', sans-serif",
  'Tahoma': "'Tahoma', sans-serif",
  'Verdana': "'Verdana', sans-serif",
  'Times New Roman': "'Times New Roman', 'Times', serif",
  'Georgia': "'Georgia', serif",
  'Cambria': "'Cambria', 'Georgia', serif",
  'Courier New': "'Courier New', 'Courier', monospace",
};

const SERIF_FONTS = new Set([
  '바탕', 'Batang',
  'Noto Serif KR',
  'Nanum Myeongjo', 'Gowun Batang',
  'Times New Roman', 'Georgia', 'Cambria',
]);

const MONOSPACE_FONTS = new Set(['Courier New', 'Courier', 'Consolas']);

/**
 * Lowercase-keyed view of FONT_MAP that holds both the canonical name
 * and its resolved chain. Lookups in `resolveFontFamily` are
 * case-insensitive so PPTX/DOCX inputs that vary the casing of the
 * canonical family ('gothic a1', 'GOTHIC A1') hit the same entry as
 * the PascalCase key. The case-insensitive suffix strip only takes us
 * halfway — without a case-insensitive lookup table the normalized
 * `'gothic a1'` would still miss `FONT_MAP['Gothic A1']`.
 */
const FONT_MAP_INDEX: ReadonlyMap<string, { canonical: string; stack: string }> = (() => {
  const map = new Map<string, { canonical: string; stack: string }>();
  for (const [key, stack] of Object.entries(FONT_MAP)) {
    map.set(key.toLowerCase(), { canonical: key, stack });
  }
  return map;
})();

const SERIF_FONTS_INDEX: ReadonlySet<string> = new Set(
  [...SERIF_FONTS].map((f) => f.toLowerCase()),
);
const MONOSPACE_FONTS_INDEX: ReadonlySet<string> = new Set(
  [...MONOSPACE_FONTS].map((f) => f.toLowerCase()),
);

/**
 * Families that already carry Korean glyph coverage — derived at module
 * init from FONT_MAP entries whose stack names a Noto KR face, plus
 * Noto Sans/Serif KR themselves. Stored lowercase so DOCX export's
 * `isKoreanCapableFamily` query and the in-chain de-dup check both
 * accept any casing the importer hands them.
 */
const KOREAN_CAPABLE_INDEX: ReadonlySet<string> = (() => {
  const set = new Set<string>(['noto sans kr', 'noto serif kr']);
  for (const [key, stack] of Object.entries(FONT_MAP)) {
    if (stack.includes("'Noto Sans KR'") || stack.includes("'Noto Serif KR'")) {
      set.add(key.toLowerCase());
    }
  }
  return set;
})();

/**
 * Weight / style suffixes a typeface name from PPTX/DOCX may carry that
 * we want to peel off before matching against the catalog. PowerPoint
 * stores each weight as a separate family name
 * (`"NanumSquare Neo OTF Bold"`, `"Gothic A1 Bold"`), but our catalog
 * is keyed on the canonical family (`"Gothic A1"`).
 *
 * Matching is case-insensitive so families written by LibreOffice
 * (`'Pretendard Semibold'`) and Google Slides (often lowercase) hit the
 * same catalog entry as PowerPoint's PascalCase. Italic / Oblique are
 * style axes, not weights, and are excluded — many real families ship
 * with `Italic` in the canonical family name (`Lucida Sans Italic`).
 */
const WEIGHT_SUFFIXES = [
  'ExtraBold', 'ExtraLight', 'UltraBold', 'UltraLight',
  'SemiBold', 'DemiBold',
  'Medium', 'Regular', 'Light', 'Heavy', 'Black', 'Thin',
  'Bold',
];

const FORMAT_SUFFIXES = ['OTF', 'TTF'];

function stripTrailingSuffix(input: string, suffixes: readonly string[]): string | null {
  const lower = input.toLowerCase();
  for (const suffix of suffixes) {
    const candidate = ' ' + suffix;
    if (lower.endsWith(candidate.toLowerCase())) {
      return input.slice(0, -candidate.length);
    }
  }
  return null;
}

function stripTypefaceSuffixes(face: string): string {
  let trimmed = face.trim();
  // Peel trailing format and weight tokens until no rule matches. PPTX
  // emits combinations like `"NanumSquare Neo OTF Bold"`; PowerPoint and
  // Apple Keynote occasionally append three tokens (`X OTF Bold Light`,
  // for designer error). A `while (changed)` loop normalizes any depth
  // without a hardcoded pass count.
  while (true) {
    const formatStripped = stripTrailingSuffix(trimmed, FORMAT_SUFFIXES);
    if (formatStripped !== null) {
      trimmed = formatStripped;
      continue;
    }
    const weightStripped = stripTrailingSuffix(trimmed, WEIGHT_SUFFIXES);
    if (weightStripped !== null) {
      trimmed = weightStripped;
      continue;
    }
    break;
  }
  return trimmed;
}

/**
 * Escape a font family name for use in a CSS single-quoted string.
 * The CSS spec requires backslashes and single quotes to be escaped.
 */
function escapeFontFamily(family: string): string {
  // Escape backslashes first, then single quotes.
  return family.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * True when `family` (a raw face name) carries Korean glyph coverage,
 * either as a Noto KR face or via a FONT_MAP entry that ends in one.
 * Exported so downstream surfaces — most notably the DOCX exporter's
 * `w:rFonts` East Asian slot — can decide whether to keep the user's
 * face or fall back to Noto Sans KR for the EA script axis.
 */
export function isKoreanCapableFamily(family: string): boolean {
  if (KOREAN_CAPABLE_INDEX.has(family.toLowerCase())) return true;
  const normalized = stripTypefaceSuffixes(family);
  return (
    normalized !== family &&
    KOREAN_CAPABLE_INDEX.has(normalized.toLowerCase())
  );
}

function stackContainsKoreanFamily(stack: string): boolean {
  // The stack always carries canonical casing (FONT_MAP values use the
  // canonical family name), so substring search against the original
  // FONT_MAP keys is safe — no need to lowercase the stack.
  for (const family of KOREAN_CAPABLE_INDEX) {
    if (stack.toLowerCase().includes(`'${family}'`)) return true;
  }
  return false;
}

/**
 * Splice a Korean-capable family into `stack` right before the trailing
 * CSS generic so the browser's per-glyph font selection has a Korean
 * face available even when the original `family` only carries Latin
 * glyphs. No-op when `stack` already names a Korean-capable family.
 */
function injectKoreanFallback(stack: string, generic: 'sans-serif' | 'serif'): string {
  if (stackContainsKoreanFamily(stack)) return stack;
  const ko = generic === 'serif' ? "'Noto Serif KR'" : "'Noto Sans KR'";
  const suffix = `, ${generic}`;
  if (stack.endsWith(suffix)) {
    return stack.slice(0, -suffix.length) + `, ${ko}${suffix}`;
  }
  return `${stack}, ${ko}, ${generic}`;
}

/**
 * Memo for `resolveFontFamily`. Inputs are bounded by the document's
 * unique typeface names (catalog size + a handful of brand fonts per
 * deck), so the map size never grows materially during a session. Pre-
 * vents the per-frame resolver work from showing up on the Canvas paint
 * profile during scroll/typing on dense decks.
 */
const RESOLVE_CACHE = new Map<string, string>();

/**
 * Resolve a font family name to a CSS fallback chain string.
 *
 * Every sans-serif or serif resolution ends with a Noto KR fallback so
 * Hangul text remains legible even when the requested family has no
 * Korean glyphs (e.g. Arial, or a brand font like "NanumSquare Neo OTF
 * Bold" that the user's machine does not have installed). The browser
 * picks the Korean face per-glyph via the standard CSS cascade.
 *
 * Monospace resolutions are NOT augmented — mixing Noto Sans KR's
 * variable-width glyphs into a Courier stack would break code alignment.
 *
 * Idempotent — a chain already in the resolved shape returns unchanged.
 * The exported API can therefore be called by external surfaces without
 * worrying about double-wrap escaping the inner quotes.
 */
export function resolveFontFamily(family: string): string {
  // Idempotency guard: a CSS chain contains commas; a raw family never
  // does (CSS doesn't permit unescaped commas in identifiers). If the
  // caller already passed a resolved chain, return it verbatim so the
  // escape path doesn't re-wrap the inner quotes into garbage.
  if (family.includes(',')) return family;

  const memoed = RESOLVE_CACHE.get(family);
  if (memoed !== undefined) return memoed;

  // PPTX/DOCX often serialize per-weight families as separate names
  // ("NanumSquare Neo OTF Bold"). Try the verbatim name first so a
  // direct catalog hit wins; if it misses, strip standard weight/format
  // suffixes and try the canonical name. The stored `style.fontFamily`
  // is left untouched — we only normalize the lookup key.
  // Direct + normalized lookups both go through the lowercase index so
  // PPTX inputs like `'gothic a1 bold'` (LibreOffice / Google Slides
  // sometimes emit non-PascalCase) hit the same catalog entry as
  // `'Gothic A1 Bold'`. Without the index, the case-insensitive suffix
  // strip would leave us with `'gothic a1'` and still miss
  // `FONT_MAP['Gothic A1']`.
  const direct = FONT_MAP_INDEX.get(family.toLowerCase());
  const normalized = direct ? family : stripTypefaceSuffixes(family);
  const mapped = direct ?? FONT_MAP_INDEX.get(normalized.toLowerCase());
  const lookupKey = (mapped?.canonical ?? family).toLowerCase();
  const generic: 'sans-serif' | 'serif' | 'monospace' = MONOSPACE_FONTS_INDEX.has(lookupKey)
    ? 'monospace'
    : SERIF_FONTS_INDEX.has(lookupKey)
      ? 'serif'
      : 'sans-serif';

  // When the normalized form hits the catalog AND it differs from the
  // verbatim, prepend the verbatim face: a user who has the weight-
  // specific cut installed locally ("Roboto Bold" as its own PostScript
  // face) still gets the real glyph rather than CSS-synthesized bold
  // off the regular weight. Compare lowercase so a pure case difference
  // ('gothic a1' vs canonical 'Gothic A1') doesn't trigger a redundant
  // prepend.
  let base: string;
  if (mapped) {
    base =
      family.toLowerCase() !== mapped.canonical.toLowerCase()
        ? `'${escapeFontFamily(family)}', ${mapped.stack}`
        : mapped.stack;
  } else {
    base = `'${escapeFontFamily(family)}', ${generic}`;
  }

  const result = generic === 'monospace' ? base : injectKoreanFallback(base, generic);
  RESOLVE_CACHE.set(family, result);
  return result;
}

type FontStatus = 'pending' | 'loading' | 'loaded' | 'error';

/**
 * FontRegistry manages on-demand web font loading and notifies
 * listeners when fonts finish loading (to trigger re-layout).
 */
export class FontRegistry {
  private status = new Map<string, FontStatus>();
  private listeners: Array<() => void> = [];

  /**
   * Register a callback to be called when any font finishes loading.
   */
  onFontLoaded(cb: () => void): void {
    this.listeners.push(cb);
  }

  /**
   * Ensure a font is loaded. If not yet loaded, triggers async loading
   * and calls listeners when done.
   */
  async ensureFont(family: string): Promise<void> {
    if (typeof document === 'undefined') return; // SSR guard
    const key = family;
    const current = this.status.get(key);
    if (current === 'loaded' || current === 'loading') return;

    // Use JSON.stringify to produce a correctly quoted font name for the
    // Font Loading API, handling embedded quotes and special characters.
    const fontSpec = `12px ${JSON.stringify(family)}`;
    if (document.fonts.check(fontSpec)) {
      this.status.set(key, 'loaded');
      return;
    }

    this.status.set(key, 'loading');
    try {
      await document.fonts.load(fontSpec);
      this.status.set(key, 'loaded');
    } catch {
      this.status.set(key, 'error');
      return;
    }

    // Listeners are invoked after the status is settled so that a
    // listener throwing cannot flip the font into 'error' via the
    // surrounding catch block. Each callback is wrapped individually so
    // one failing subscriber does not block notifications for the rest.
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('FontRegistry listener threw:', e);
      }
    }
  }

  getFontStatus(family: string): FontStatus {
    return this.status.get(family) ?? 'pending';
  }
}
