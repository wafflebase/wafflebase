import type { Document, Block, Inline } from '../model/types.js';

// Match `splitMixedScript`'s definition in pdf-style-map.ts: any character
// pdf-lib's WinAnsi-encoded StandardFonts cannot encode. Detecting these
// here triggers Korean font embed so the painter has glyphs for CJK
// punctuation (※, 「」), geometric shapes (●○■), and Hangul/Han characters.
// The WinAnsi "specials" beyond Latin-1 (U+0000–U+00FF) that pdf-lib's
// StandardFonts can still encode: typographic quotes, dashes, the Euro
// sign, etc. Factored out so both regexes below derive from one source.
// The quote block is split around U+201B (reversed-9 quote), which CP1252
// can't encode — it must route to the Korean font. Keep in sync with the
// `LATIN_SAFE_CHARS` definition in `pdf-style-map.ts`.
const LATIN_SPECIAL_CHARS = '\\u0152\\u0153\\u0160\\u0161\\u017D\\u017E\\u0192\\u02C6\\u02DC\\u2013\\u2014\\u2018-\\u201A\\u201C-\\u201E\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122';
// Match `splitMixedScript`'s definition in pdf-style-map.ts: any character
// pdf-lib's WinAnsi-encoded StandardFonts cannot encode. Detecting these
// here triggers Korean font embed so the painter has glyphs for CJK
// punctuation (※, 「」), geometric shapes (●○■), and Hangul/Han characters.
const LATIN_SAFE_CHARS = `\\u0000-\\u00FF${LATIN_SPECIAL_CHARS}`;
const NEEDS_CJK_FONT = new RegExp(`[^${LATIN_SAFE_CHARS}]`);
// True when the text carries at least one *visible* Latin glyph (printable
// ASCII + Latin-1 minus the C0/C1 control ranges, plus the WinAnsi
// specials). Used to decide whether a custom Google Font is worth
// embedding: a family used only on all-CJK text routes to the Noto path,
// so embedding (and fetching) it would be wasted.
const HAS_LATIN_GLYPH = new RegExp(`[\\u0021-\\u00FF${LATIN_SPECIAL_CHARS}]`);
const SERIF_FAMILIES = new Set([
  '바탕', 'Batang', 'Noto Serif KR',
  'Times New Roman', 'Times', 'Georgia',
]);

/**
 * Files a custom Google Font resolves to for PDF embedding. Italic is
 * synthesized via the painter's oblique shim, so no italic file is needed.
 */
export interface CustomFontFiles {
  /** Static TTF URL for the regular (400) cut. */
  regular: string;
  /** Static TTF URL for the bold cut, if the family has one. */
  bold?: string;
}

/**
 * Maps an `InlineStyle.fontFamily` to its embeddable TTF URLs, or
 * `undefined` for families with no curated embed (system fonts, Korean
 * families handled by the Noto path, full-library picks). Injected from
 * the frontend (`font-files.data.ts`) since the docs package can't import
 * the frontend catalog.
 */
export type PdfFontResolver = (family: string) => CustomFontFiles | undefined;

/** Per-family custom-font requirement gathered while scanning a document. */
export interface CustomFontUsage {
  needsBold: boolean;
  regular: string;
  bold?: string;
}

export interface FontUsage {
  needsKR: boolean;
  needsKRSerif: boolean;
  needsLatinSerif: boolean;
  needsBold: boolean;
  needsItalic: boolean;
  /** Curated Google Fonts the document uses on Latin text, keyed by family. */
  customFamilies: Map<string, CustomFontUsage>;
}

export function scanFontsUsed(doc: Document, resolver?: PdfFontResolver): FontUsage {
  const usage: FontUsage = {
    needsKR: false, needsKRSerif: false,
    needsLatinSerif: false, needsBold: false, needsItalic: false,
    customFamilies: new Map(),
  };
  const visit = (blocks: Block[]) => {
    for (const block of blocks) visitBlock(block, usage, resolver);
  };
  visit(doc.blocks);
  if (doc.header) visit(doc.header.blocks);
  if (doc.footer) visit(doc.footer.blocks);
  return usage;
}

function visitBlock(block: Block, u: FontUsage, resolver?: PdfFontResolver): void {
  // Unordered list markers (●, ○, ■) live in the U+25xx range — outside
  // pdf-lib's WinAnsi-only StandardFonts coverage. Force a Korean font
  // load so the painter has a binary that contains those glyphs.
  // CONTRACT: `pdf-painter.ts:paintListMarker` (and the cell-content
  // marker draw inside `paintCellContent`) reach into
  // `fonts['kr-sans-regular']` for unordered markers. Both sides depend
  // on this flag being set, so any future change to either site must
  // keep them in sync.
  if (block.type === 'list-item' && block.listKind === 'unordered') {
    u.needsKR = true;
  }
  if (block.tableData) {
    for (const row of block.tableData.rows) {
      for (const cell of row.cells) {
        for (const cellBlock of cell.blocks ?? []) visitBlock(cellBlock, u, resolver);
      }
    }
  }
  for (const inline of block.inlines) visitInline(inline, u, resolver);
}

function visitInline(inline: Inline, u: FontUsage, resolver?: PdfFontResolver): void {
  const hasNonLatin = NEEDS_CJK_FONT.test(inline.text);
  const family = inline.style.fontFamily ?? '';
  const isSerif = SERIF_FAMILIES.has(family);
  if (hasNonLatin) {
    u.needsKR = true;
    if (isSerif) u.needsKRSerif = true;
  } else if (isSerif) {
    u.needsLatinSerif = true;
  }
  if (inline.style.bold) u.needsBold = true;
  if (inline.style.italic) u.needsItalic = true;

  // A curated Google Font used on Latin text embeds its real face instead
  // of falling back to Helvetica/Times. CJK glyphs in the same run still
  // route to the Noto path via `splitMixedScript`, so we only embed when
  // there is Latin content to render.
  if (resolver && family && HAS_LATIN_GLYPH.test(inline.text)) {
    const files = resolver(family);
    if (files) {
      const existing = u.customFamilies.get(family);
      if (existing) {
        existing.needsBold = existing.needsBold || !!inline.style.bold;
      } else {
        u.customFamilies.set(family, {
          needsBold: !!inline.style.bold,
          regular: files.regular,
          bold: files.bold,
        });
      }
    }
  }
}

export type PdfStandardFontKey =
  | 'sans-regular' | 'sans-bold' | 'sans-italic' | 'sans-boldItalic'
  | 'serif-regular' | 'serif-bold' | 'serif-italic' | 'serif-boldItalic'
  | 'kr-sans-regular' | 'kr-sans-bold'
  | 'kr-serif-regular' | 'kr-serif-bold';

/**
 * Either one of the 12 fixed standard/Korean keys or a per-family custom
 * key (`custom:<family>:regular|bold`) for an embedded Google Font.
 */
export type PdfFontKey = PdfStandardFontKey | `custom:${string}`;

/** Build the custom embed key for a family + weight. Shared by
 *  `resolveFontKey` and `embedAllFonts` so the two sides agree. */
export function customFontKey(family: string, bold: boolean): PdfFontKey {
  return `custom:${family}:${bold ? 'bold' : 'regular'}`;
}

type FontSource = () => Promise<ArrayBuffer>;

export interface PdfFontsOptions {
  /** Override font sources. Used in tests to inject local files and in
   *  prod to swap fetch URLs. Keys absent here fall through to the
   *  default network source.
   */
  sources?: Partial<Record<PdfFontKey, FontSource>>;
}

/**
 * Direct OTF URLs for each Korean variant. We download the full subset
 * OTF (each ~5-7 MB) once per font variant; fontkit then subsets it
 * further at embed time so only glyphs the document references end up
 * in the resulting PDF.
 *
 * Why not Google Fonts CSS API: that endpoint serves WOFF2 to modern
 * user-agents, and `@pdf-lib/fontkit` doesn't include a Brotli decoder —
 * loading WOFF2 produced gibberish glyphs. Going to OTF directly avoids
 * the format-detection mess.
 *
 * URLs pin to specific release tags (`Sans2.004` / `Serif2.003`) rather
 * than `@main` so first-time exports can't break on upstream changes
 * to noto-cjk's main branch. When a newer release ships, bump these
 * tags after smoke-testing the new fonts in dev. jsdelivr mirrors the
 * tags identically; raw.githubusercontent serves the same paths under
 * `https://raw.githubusercontent.com/notofonts/noto-cjk/<tag>/...` if
 * jsdelivr changes its routing.
 */
const DEFAULT_URLS: Partial<Record<PdfStandardFontKey, string>> = {
  'kr-sans-regular':  'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf',
  'kr-sans-bold':     'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/KR/NotoSansKR-Bold.otf',
  'kr-serif-regular': 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Serif2.003/Serif/SubsetOTF/KR/NotoSerifKR-Regular.otf',
  'kr-serif-bold':    'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Serif2.003/Serif/SubsetOTF/KR/NotoSerifKR-Bold.otf',
};

const IDB_NAME = 'wafflebase-pdf-fonts';
const IDB_STORE = 'fonts';

export class PdfFonts {
  private cache = new Map<PdfFontKey, ArrayBuffer>();
  private sources: Partial<Record<PdfFontKey, FontSource>>;
  /** Per-key fetch URLs for custom (`custom:…`) Google Font embeds,
   *  registered at embed time from the injected resolver. */
  private customUrls = new Map<PdfFontKey, string>();

  constructor(opts: PdfFontsOptions = {}) {
    this.sources = opts.sources ?? {};
  }

  /** Register a download URL for a custom font key so `load(key)` (and
   *  the IndexedDB cache) can resolve it like the built-in fonts. */
  registerCustom(key: PdfFontKey, url: string): void {
    this.customUrls.set(key, url);
  }

  async load(key: PdfFontKey): Promise<ArrayBuffer> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const idbHit = await this.idbGet(key);
    if (idbHit) {
      this.cache.set(key, idbHit);
      return idbHit;
    }

    const source = this.sources[key] ?? this.defaultSource(key);
    if (!source) throw new Error(`PdfFonts: no source for "${key}"`);
    const buf = await source();
    this.cache.set(key, buf);
    void this.idbPut(key, buf);
    return buf;
  }

  private defaultSource(key: PdfFontKey): FontSource | undefined {
    const url = this.customUrls.get(key)
      ?? (key.startsWith('custom:') ? undefined : DEFAULT_URLS[key as PdfStandardFontKey]);
    if (!url) return undefined;
    return async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Font fetch failed: ${url}`);
      return res.arrayBuffer();
    };
  }

  private async idbGet(key: PdfFontKey): Promise<ArrayBuffer | null> {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve) => {
      const open = indexedDB.open(IDB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
      open.onsuccess = () => {
        const tx = open.result.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
        req.onerror = () => resolve(null);
      };
      open.onerror = () => resolve(null);
    });
  }

  private async idbPut(key: PdfFontKey, buf: ArrayBuffer): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    return new Promise((resolve) => {
      const open = indexedDB.open(IDB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
      open.onsuccess = () => {
        const tx = open.result.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(buf, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      open.onerror = () => resolve();
    });
  }
}
