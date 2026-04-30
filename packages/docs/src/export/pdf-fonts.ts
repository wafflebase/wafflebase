import type { Document, Block, Inline } from '../model/types.js';

// Match `splitMixedScript`'s definition in pdf-style-map.ts: any character
// pdf-lib's WinAnsi-encoded StandardFonts cannot encode. Detecting these
// here triggers Korean font embed so the painter has glyphs for CJK
// punctuation (※, 「」), geometric shapes (●○■), and Hangul/Han characters.
const LATIN_SAFE_CHARS = '\\u0000-\\u00FF\\u0152\\u0153\\u0160\\u0161\\u017D\\u017E\\u0192\\u02C6\\u02DC\\u2013\\u2014\\u2018-\\u201E\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122';
const NEEDS_CJK_FONT = new RegExp(`[^${LATIN_SAFE_CHARS}]`);
const SERIF_FAMILIES = new Set([
  '바탕', 'Batang', 'Noto Serif KR',
  'Times New Roman', 'Times', 'Georgia',
]);

export interface FontUsage {
  needsKR: boolean;
  needsKRSerif: boolean;
  needsLatinSerif: boolean;
  needsBold: boolean;
  needsItalic: boolean;
  /**
   * Concatenation of every non-Latin character that appeared in the
   * document (plus list-marker glyphs). Forwarded as Google Fonts'
   * `text=` parameter so the CSS API returns a single subsetted font
   * containing exactly these glyphs — without it, the API splits the
   * font into multiple `unicode-range` chunks and we'd lose Hangul.
   */
  subsetText: string;
}

export function scanFontsUsed(doc: Document): FontUsage {
  const subsetChars = new Set<string>();
  const usage: FontUsage = {
    needsKR: false, needsKRSerif: false,
    needsLatinSerif: false, needsBold: false, needsItalic: false,
    subsetText: '',
  };
  const visit = (blocks: Block[]) => {
    for (const block of blocks) visitBlock(block, usage, subsetChars);
  };
  visit(doc.blocks);
  if (doc.header) visit(doc.header.blocks);
  if (doc.footer) visit(doc.footer.blocks);

  // Bullet markers live in U+25xx — outside any inline text but still
  // need to be in the subset so list-item glyphs render.
  if (usage.needsKR) {
    for (const ch of '●○■') subsetChars.add(ch);
  }
  usage.subsetText = Array.from(subsetChars).join('');
  return usage;
}

function visitBlock(block: Block, u: FontUsage, subsetChars: Set<string>): void {
  // Unordered list markers (●, ○, ■) live in the U+25xx range — outside
  // pdf-lib's WinAnsi-only StandardFonts coverage. Force a Korean font
  // load so the painter has a binary that contains those glyphs.
  if (block.type === 'list-item' && block.listKind === 'unordered') {
    u.needsKR = true;
  }
  if (block.tableData) {
    for (const row of block.tableData.rows) {
      for (const cell of row.cells) {
        for (const cellBlock of cell.blocks ?? []) visitBlock(cellBlock, u, subsetChars);
      }
    }
  }
  for (const inline of block.inlines) visitInline(inline, u, subsetChars);
}

function visitInline(inline: Inline, u: FontUsage, subsetChars: Set<string>): void {
  const hasNonLatin = NEEDS_CJK_FONT.test(inline.text);
  const isSerif = SERIF_FAMILIES.has(inline.style.fontFamily ?? '');
  if (hasNonLatin) {
    u.needsKR = true;
    if (isSerif) u.needsKRSerif = true;
    // Collect every non-Latin character (each contributes a glyph the
    // painter will need at draw time).
    for (const ch of inline.text) {
      if (NEEDS_CJK_FONT.test(ch)) subsetChars.add(ch);
    }
  } else if (isSerif) {
    u.needsLatinSerif = true;
  }
  if (inline.style.bold) u.needsBold = true;
  if (inline.style.italic) u.needsItalic = true;
}

export type PdfFontKey =
  | 'sans-regular' | 'sans-bold' | 'sans-italic' | 'sans-boldItalic'
  | 'serif-regular' | 'serif-bold' | 'serif-italic' | 'serif-boldItalic'
  | 'kr-sans-regular' | 'kr-sans-bold'
  | 'kr-serif-regular' | 'kr-serif-bold';

type FontSource = () => Promise<ArrayBuffer>;

export interface PdfFontsOptions {
  /** Override font sources. Used in tests to inject local files and in
   *  prod to swap fetch URLs. Keys absent here fall through to the
   *  default network source.
   */
  sources?: Partial<Record<PdfFontKey, FontSource>>;
}

/**
 * Google Fonts CSS2 API requests for each Korean variant. Without a
 * `text=` parameter the CSS API splits the font into many `unicode-range`
 * chunks and returns one URL per chunk — fetching only the first chunk
 * yields a Latin-only font that lacks Hangul glyphs (the symptom: text
 * is in the PDF but doesn't render visually). With `text=` the API
 * returns a single subsetted file containing exactly the glyphs we
 * pass in, which is what we want for embed.
 */
const GOOGLE_FONTS_QUERIES: Partial<Record<PdfFontKey, string>> = {
  'kr-sans-regular':  'family=Noto+Sans+KR:wght@400',
  'kr-sans-bold':     'family=Noto+Sans+KR:wght@700',
  'kr-serif-regular': 'family=Noto+Serif+KR:wght@400',
  'kr-serif-bold':    'family=Noto+Serif+KR:wght@700',
};

async function resolveGoogleFontsUrl(query: string): Promise<string> {
  const css = await fetch(`https://fonts.googleapis.com/css2?${query}`, {
    // Spoof a desktop UA so Google Fonts returns the woff2/ttf URL
    // (without this, it serves a different font format that fontkit
    // may not parse cleanly).
    headers: { 'User-Agent': 'Mozilla/5.0' },
  }).then((r) => {
    if (!r.ok) throw new Error(`Google Fonts CSS fetch failed: ${r.status}`);
    return r.text();
  });
  const match = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(css);
  if (!match) throw new Error(`Could not parse font URL from CSS: ${query}`);
  return match[1];
}

/**
 * Cheap deterministic hash for cache keys (djb2). Used so distinct
 * subset-text payloads don't collide in IDB while identical payloads
 * (e.g., the same document re-exported) hit cache.
 */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Reduce a free-form character set to a canonical sorted-deduped string
 * so two documents with the same unique non-Latin chars share a cache.
 */
function canonicalSubset(text: string): string {
  return Array.from(new Set(text)).sort().join('');
}

const IDB_NAME = 'wafflebase-pdf-fonts';
const IDB_STORE = 'fonts';

export class PdfFonts {
  private cache = new Map<string, ArrayBuffer>();
  private sources: Partial<Record<PdfFontKey, FontSource>>;

  constructor(opts: PdfFontsOptions = {}) {
    this.sources = opts.sources ?? {};
  }

  /**
   * Load a font binary, optionally subsetted to a specific character set.
   *
   * `subsetText` (when provided) is forwarded to the Google Fonts CSS API
   * via `&text=`, returning a single file with exactly the glyphs needed.
   * Without it, Google's API would split the font into multiple
   * `unicode-range` chunks and we'd only fetch the first — losing Hangul.
   *
   * Cache key is `${key}|${hash(canonical subset)}` so different subsets
   * stay distinct while two docs with the same character set share cache.
   */
  async load(key: PdfFontKey, subsetText?: string): Promise<ArrayBuffer> {
    const subset = subsetText ? canonicalSubset(subsetText) : '';
    const cacheKey = subset ? `${key}|${djb2(subset)}` : key;

    const memHit = this.cache.get(cacheKey);
    if (memHit) return memHit;

    const idbHit = await this.idbGet(cacheKey);
    if (idbHit) {
      this.cache.set(cacheKey, idbHit);
      return idbHit;
    }

    // Custom-injected sources (tests, alternate CDNs) don't take a
    // subset hint — they're expected to return a complete font binary.
    // Only the default Google Fonts source applies the subset.
    const source = this.sources[key] ?? this.defaultSource(key, subset);
    if (!source) throw new Error(`PdfFonts: no source for "${key}"`);
    const buf = await source();
    this.cache.set(cacheKey, buf);
    void this.idbPut(cacheKey, buf);
    return buf;
  }

  private defaultSource(key: PdfFontKey, subset: string): FontSource | undefined {
    const baseQuery = GOOGLE_FONTS_QUERIES[key];
    if (!baseQuery) return undefined;
    const query = subset
      ? `${baseQuery}&text=${encodeURIComponent(subset)}`
      : baseQuery;
    return async () => {
      const url = await resolveGoogleFontsUrl(query);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Font fetch failed: ${url}`);
      return res.arrayBuffer();
    };
  }

  private async idbGet(key: string): Promise<ArrayBuffer | null> {
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

  private async idbPut(key: string, buf: ArrayBuffer): Promise<void> {
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
