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
 * Direct TTF URLs for each Korean variant. These are TrueType-outline
 * variable fonts hosted in `google/fonts`; fontkit can subset them
 * cleanly (unlike CFF-flavored OTFs, which trigger a "value argument
 * out of bounds" RangeError in `@pdf-lib/fontkit`'s CFF subset encoder).
 *
 * The files carry a `wght` axis from 100 to 900. fontkit instantiates
 * at the axis default (400) when subsetting, so bold runs currently
 * inherit the regular weight visually. A future improvement would feed
 * fontkit an explicit `wght=700` instance for the bold keys.
 *
 * Both `Sans` and `Serif` variable TTFs return 200 from
 * raw.githubusercontent.com. jsdelivr's `gh` mirror returns 403 on the
 * Serif file (presumably hitting a per-file size threshold), so we
 * use raw.githubusercontent for both to keep the source consistent.
 */
const DEFAULT_URLS: Partial<Record<PdfFontKey, string>> = {
  'kr-sans-regular':  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf',
  'kr-sans-bold':     'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf',
  'kr-serif-regular': 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf',
  'kr-serif-bold':    'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf',
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
