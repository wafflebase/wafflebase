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
}

export function scanFontsUsed(doc: Document): FontUsage {
  const usage: FontUsage = {
    needsKR: false, needsKRSerif: false,
    needsLatinSerif: false, needsBold: false, needsItalic: false,
  };
  const visit = (blocks: Block[]) => {
    for (const block of blocks) visitBlock(block, usage);
  };
  visit(doc.blocks);
  if (doc.header) visit(doc.header.blocks);
  if (doc.footer) visit(doc.footer.blocks);
  return usage;
}

function visitBlock(block: Block, u: FontUsage): void {
  // Unordered list markers (●, ○, ■) live in the U+25xx range — outside
  // pdf-lib's WinAnsi-only StandardFonts coverage. Force a Korean font
  // load so the painter has a binary that contains those glyphs.
  if (block.type === 'list-item' && block.listKind === 'unordered') {
    u.needsKR = true;
  }
  if (block.tableData) {
    for (const row of block.tableData.rows) {
      for (const cell of row.cells) {
        for (const cellBlock of cell.blocks ?? []) visitBlock(cellBlock, u);
      }
    }
  }
  for (const inline of block.inlines) visitInline(inline, u);
}

function visitInline(inline: Inline, u: FontUsage): void {
  const hasNonLatin = NEEDS_CJK_FONT.test(inline.text);
  const isSerif = SERIF_FAMILIES.has(inline.style.fontFamily ?? '');
  if (hasNonLatin) {
    u.needsKR = true;
    if (isSerif) u.needsKRSerif = true;
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
const DEFAULT_URLS: Partial<Record<PdfFontKey, string>> = {
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

  constructor(opts: PdfFontsOptions = {}) {
    this.sources = opts.sources ?? {};
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
    const url = DEFAULT_URLS[key];
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
