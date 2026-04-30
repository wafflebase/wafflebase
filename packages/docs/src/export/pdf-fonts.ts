import type { Document, Block, Inline } from '../model/types.js';

const KR_RANGE = /[\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/;
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
  const hasKR = KR_RANGE.test(inline.text);
  const isSerif = SERIF_FAMILIES.has(inline.style.fontFamily ?? '');
  if (hasKR) {
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

const DEFAULT_URLS: Partial<Record<PdfFontKey, string>> = {
  // Resolved via Google Fonts CSS API. Pinned URLs may rotate; if so,
  // update them or self-host. The PdfFonts.idb cache means a one-time
  // breakage isn't catastrophic for users who already exported once.
  // Tests inject sources so they don't rely on these.
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
