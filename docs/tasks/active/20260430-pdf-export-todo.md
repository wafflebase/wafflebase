# Docs PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** not-started
**Spec:** [`docs/design/docs/docs-pdf-export.md`](../../design/docs/docs-pdf-export.md)
**Lessons:** `docs/tasks/active/20260430-pdf-export-lessons.md` (created during execution)

**Goal:** Add a vector PDF export path to the Docs editor alongside existing DOCX export, producing selectable/searchable PDFs with embedded Korean fonts and PDF-native features (bookmarks, hyperlinks, page numbers).

**Architecture:** Reuse `view/pagination.ts → paginateLayout()` to compute per-line `(x, y)` coordinates, then walk the resulting `PaginatedLayout` and emit pdf-lib draw calls. Korean fonts (Noto Sans/Serif KR) are lazily fetched, IDB-cached, and subset-embedded via `@pdf-lib/fontkit`. Module split mirrors `view/`: a thin painter delegates tables and images to dedicated painters.

**Tech Stack:** TypeScript, `pdf-lib`, `@pdf-lib/fontkit`, Vitest (jsdom), existing `paginateLayout`/`computeListCounters` from `view/`.

---

## File Structure

**New files:**
```
packages/docs/src/export/
  pdf-exporter.ts              # Public entry; orchestrates the pipeline
  pdf-painter.ts               # LayoutPage → pdf-lib draw calls (text, lists)
  pdf-style-map.ts             # Pure: InlineStyle → PdfFontKey, RGB, etc.
  pdf-fonts.ts                 # Lazy fetch + IDB cache + fontkit subset embed
  pdf-table-painter.ts         # Table cells, borders, merged cells, row split
  pdf-image-painter.ts         # PNG/JPEG native + GIF/WebP/BMP via Canvas

packages/docs/src/view/
  table-geometry.ts            # Extracted from table-renderer.ts (shared)

packages/docs/test/export/
  pdf-style-map.test.ts
  pdf-fonts.test.ts
  pdf-painter.test.ts
  pdf-table-painter.test.ts
  pdf-image-painter.test.ts
  pdf-exporter.test.ts
  fixtures/
    fonts/
      test-cjk.ttf             # Small (~50 KB) public-domain CJK font for tests
      README.md                # Provenance + license note
    pdf/
      simple-paragraph.json
      mixed-korean-english.json
      with-table.json
      with-merged-cells.json
      with-split-row.json
      with-image.json
      multi-page.json
      with-headings-and-links.json
      with-header-footer-pagenumber.json

packages/frontend/src/app/docs/
  export-utils.ts              # Shared image fetcher + downloadBlob + pickFile
  pdf-actions.ts               # exportPdfAndDownload entry
```

**Modified files:**
- `packages/docs/package.json` — add `pdf-lib` + `@pdf-lib/fontkit`
- `packages/docs/src/index.ts` — export `PdfExporter`, types
- `packages/docs/src/view/table-renderer.ts` — delegate geometry to new module
- `packages/frontend/src/app/docs/docx-actions.ts` — delegate to `export-utils`
- Frontend export menu component (located via Grep in Task 7.3)
- `docs/tasks/active/README.md` — add this task to the index

---

## Phase 1 — Foundation: fonts + dependencies

### Task 1.1: Add pdf-lib and fontkit dependencies

**Files:**
- Modify: `packages/docs/package.json`
- Modify: `pnpm-lock.yaml` (auto)

- [ ] **1.1.1** Add deps to `packages/docs/package.json` under `"dependencies"`:

```json
"@pdf-lib/fontkit": "^1.1.1",
"pdf-lib": "^1.17.1"
```

- [ ] **1.1.2** Install:

```bash
pnpm install
```
Expected: lockfile updated, `node_modules/pdf-lib` present.

- [ ] **1.1.3** Verify import works (transient sanity check, no commit):

```bash
node -e "import('pdf-lib').then(m => console.log(Object.keys(m).slice(0,5)))"
```
Expected: prints `['PDFDocument', 'PDFPage', ...]`.

- [ ] **1.1.4** Commit:

```bash
git add packages/docs/package.json pnpm-lock.yaml
git commit -m "Add pdf-lib + fontkit deps to docs package"
```

---

### Task 1.2: Add test CJK font fixture

**Files:**
- Create: `packages/docs/test/export/fixtures/fonts/test-cjk.ttf`
- Create: `packages/docs/test/export/fixtures/fonts/README.md`

- [ ] **1.2.1** Download a small public-domain or SIL-OFL CJK font for tests. Use `Noto Sans KR Regular` subset (or fontTools subset locally) limited to ASCII + 한글 자모 + a handful of common 한자 (~50 KB):

```bash
# Option A: pre-subsetted Noto via Google Fonts CSS API (text= parameter)
curl -L "https://fonts.googleapis.com/css2?family=Noto+Sans+KR&text=가나다라마바사아자차카타파하ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789%20%2C.!?-" \
  -H "User-Agent: Mozilla/5.0" | grep -oE "https://[^)]+\.(otf|ttf|woff2)" | head -1 \
  | xargs curl -L -o packages/docs/test/export/fixtures/fonts/test-cjk.ttf
```

If the above shape changes (Google rotates URLs), substitute manually with a public-domain CJK font (e.g., `UnDotum`, ~50 KB).

- [ ] **1.2.2** Write `packages/docs/test/export/fixtures/fonts/README.md`:

```markdown
# Test Fonts

`test-cjk.ttf` — small CJK-capable test font used by Vitest tests for
pdf-fonts and pdf-painter. Not bundled into the production package.

**Source:** Noto Sans KR (Google Fonts) — SIL Open Font License.
Subset to ~80 glyphs (ASCII + common Hangul) for repository size.
```

- [ ] **1.2.3** Verify font loads with fontkit (sanity, no commit):

```bash
node -e "import('@pdf-lib/fontkit').then(async fk => { const fs = await import('fs'); const font = fk.default.create(fs.readFileSync('packages/docs/test/export/fixtures/fonts/test-cjk.ttf')); console.log(font.familyName); })"
```
Expected: prints a font family name (e.g., `"Noto Sans KR"`).

- [ ] **1.2.4** Commit:

```bash
git add packages/docs/test/export/fixtures/fonts/
git commit -m "Add test CJK font fixture for pdf export tests"
```

---

### Task 1.3: scanFontsUsed — analyze required fonts

**Files:**
- Create: `packages/docs/src/export/pdf-fonts.ts`
- Create: `packages/docs/test/export/pdf-fonts.test.ts`

- [ ] **1.3.1** Write the failing test:

```ts
// packages/docs/test/export/pdf-fonts.test.ts
import { describe, it, expect } from 'vitest';
import { scanFontsUsed } from '../../src/export/pdf-fonts.js';
import type { Document } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '../../src/model/types.js';

const para = (text: string, style: any = {}, fontFamily?: string): Document => ({
  blocks: [{
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: { ...style, ...(fontFamily && { fontFamily }) } }],
    style: { ...DEFAULT_BLOCK_STYLE },
  }],
});

describe('scanFontsUsed', () => {
  it('detects no Korean for ASCII-only document', () => {
    const result = scanFontsUsed(para('Hello World'));
    expect(result.needsKR).toBe(false);
    expect(result.needsKRSerif).toBe(false);
  });

  it('detects Korean sans for hangul text', () => {
    const result = scanFontsUsed(para('안녕하세요'));
    expect(result.needsKR).toBe(true);
    expect(result.needsKRSerif).toBe(false);
  });

  it('detects Korean serif when fontFamily is a serif Korean face', () => {
    const result = scanFontsUsed(para('안녕', {}, '바탕'));
    expect(result.needsKRSerif).toBe(true);
  });

  it('detects bold variant when bold is used', () => {
    const result = scanFontsUsed(para('Hi', { bold: true }));
    expect(result.needsBold).toBe(true);
  });

  it('walks tables and headers/footers', () => {
    const doc: Document = {
      blocks: [],
      header: { blocks: [{ id: 'h', type: 'paragraph', inlines: [{ text: '한글', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }] },
    };
    const result = scanFontsUsed(doc);
    expect(result.needsKR).toBe(true);
  });
});
```

- [ ] **1.3.2** Run, expect FAIL (module missing):

```bash
pnpm --filter @wafflebase/docs test pdf-fonts -- --run
```

- [ ] **1.3.3** Implement minimal module:

```ts
// packages/docs/src/export/pdf-fonts.ts
import type { Document, Block, Inline, TableData } from '../model/types.js';

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
```

- [ ] **1.3.4** Run, expect PASS:

```bash
pnpm --filter @wafflebase/docs test pdf-fonts -- --run
```

- [ ] **1.3.5** Commit:

```bash
git add packages/docs/src/export/pdf-fonts.ts packages/docs/test/export/pdf-fonts.test.ts
git commit -m "Add scanFontsUsed for pdf export font analysis"
```

---

### Task 1.4: PdfFonts class — load + IDB cache + DI

**Files:**
- Modify: `packages/docs/src/export/pdf-fonts.ts`
- Modify: `packages/docs/test/export/pdf-fonts.test.ts`

- [ ] **1.4.1** Write the failing tests:

```ts
// Append to pdf-fonts.test.ts
import { PdfFonts } from '../../src/export/pdf-fonts.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEST_FONT = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/fonts/test-cjk.ttf'),
);

describe('PdfFonts', () => {
  it('returns ArrayBuffer from injected sources', async () => {
    const fonts = new PdfFonts({
      sources: { 'kr-sans-regular': () => Promise.resolve(TEST_FONT.buffer) },
    });
    const buf = await fonts.load('kr-sans-regular');
    expect(buf.byteLength).toBe(TEST_FONT.byteLength);
  });

  it('caches a font after first load (no second source call)', async () => {
    let calls = 0;
    const fonts = new PdfFonts({
      sources: { 'kr-sans-regular': () => { calls++; return Promise.resolve(TEST_FONT.buffer); } },
    });
    await fonts.load('kr-sans-regular');
    await fonts.load('kr-sans-regular');
    expect(calls).toBe(1);
  });

  it('throws a clear error when source is missing', async () => {
    const fonts = new PdfFonts({ sources: {} });
    await expect(fonts.load('kr-sans-regular' as any)).rejects.toThrow(/no source/i);
  });
});
```

- [ ] **1.4.2** Run, expect FAIL.

- [ ] **1.4.3** Append PdfFonts class to `pdf-fonts.ts`:

```ts
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
  // Updated: Google Fonts CSS API is the canonical source.
  // Pinned URLs as of writing — switch to a self-hosted bucket if these rotate.
  'kr-sans-regular':
    'https://fonts.gstatic.com/s/notosanskr/v36/Pby6FmXiEBPT4ITbgNA5Cgm203Tq4JJWq209pU0DPdWuqxJFA4GNDCBYtw.0.woff2',
  'kr-sans-bold':
    'https://fonts.gstatic.com/s/notosanskr/v36/Pby6FmXiEBPT4ITbgNA5Cgm203Tq4JJWq209pU0DPdWuqxJFA4GNDCBYtw.0.bold.woff2',
  'kr-serif-regular':
    'https://fonts.gstatic.com/s/notoserifkr/v29/3Jn7SDn90Gmq2mr3blnHaTZXduZp1ONyKHQ.woff2',
  'kr-serif-bold':
    'https://fonts.gstatic.com/s/notoserifkr/v29/3Jn7SDn90Gmq2mr3blnHaTZXduZp1ONyKHQ.bold.woff2',
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
```

> **NOTE for executor**: the URLs in `DEFAULT_URLS` are placeholders. Verify them against `https://fonts.googleapis.com/css2?family=Noto+Sans+KR` and `Noto+Serif+KR` at implementation time and pin to the resolved `.woff2`/`.ttf` URLs. Prefer self-hosted (S3 bucket) once we settle on a permanent solution — track in the lessons file.

- [ ] **1.4.4** Run, expect PASS.

- [ ] **1.4.5** Commit:

```bash
git add packages/docs/src/export/pdf-fonts.ts packages/docs/test/export/pdf-fonts.test.ts
git commit -m "Add PdfFonts class with IDB cache and DI sources"
```

---

### Task 1.5: Hello-world Korean PDF (foundation milestone)

**Files:**
- Create: `packages/docs/src/export/pdf-exporter.ts` (skeleton)
- Create: `packages/docs/test/export/pdf-exporter.test.ts`

- [ ] **1.5.1** Write the failing integration test:

```ts
// packages/docs/test/export/pdf-exporter.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { PdfExporter } from '../../src/export/pdf-exporter.js';
import { PdfFonts } from '../../src/export/pdf-fonts.js';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '../../src/model/types.js';
import type { Document } from '../../src/model/types.js';

// jsdom Blob shim
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  (Blob.prototype as any).arrayBuffer = function (): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}

const TEST_FONT_BUFFER = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/fonts/test-cjk.ttf'),
).buffer;

const testFonts = () =>
  new PdfFonts({
    sources: {
      'sans-regular':     () => Promise.resolve(TEST_FONT_BUFFER),
      'sans-bold':        () => Promise.resolve(TEST_FONT_BUFFER),
      'sans-italic':      () => Promise.resolve(TEST_FONT_BUFFER),
      'sans-boldItalic':  () => Promise.resolve(TEST_FONT_BUFFER),
      'kr-sans-regular':  () => Promise.resolve(TEST_FONT_BUFFER),
      'kr-sans-bold':     () => Promise.resolve(TEST_FONT_BUFFER),
      'kr-serif-regular': () => Promise.resolve(TEST_FONT_BUFFER),
      'kr-serif-bold':    () => Promise.resolve(TEST_FONT_BUFFER),
      'serif-regular':    () => Promise.resolve(TEST_FONT_BUFFER),
      'serif-bold':       () => Promise.resolve(TEST_FONT_BUFFER),
      'serif-italic':     () => Promise.resolve(TEST_FONT_BUFFER),
      'serif-boldItalic': () => Promise.resolve(TEST_FONT_BUFFER),
    },
  });

describe('PdfExporter (hello world)', () => {
  it('produces a valid PDF for a single Korean line', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: '안녕하세요', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const blob = await PdfExporter.export(doc, { fonts: testFonts() });
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');

    // Re-load the PDF to verify validity
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **1.5.2** Run, expect FAIL.

- [ ] **1.5.3** Implement minimum exporter:

```ts
// packages/docs/src/export/pdf-exporter.ts
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Document } from '../model/types.js';
import { DEFAULT_PAGE_SETUP, getEffectiveDimensions } from '../model/types.js';
import { PdfFonts } from './pdf-fonts.js';
import { scanFontsUsed } from './pdf-fonts.js';

const PX_PER_PT = 96 / 72;

export interface PdfExportOptions {
  fonts?: PdfFonts;
  imageFetcher?: (url: string) => Promise<Blob>;
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string[] };
}

export class PdfExporter {
  static async export(doc: Document, opts: PdfExportOptions = {}): Promise<Blob> {
    const fonts = opts.fonts ?? new PdfFonts();

    // Phase 1: just embed the regular sans font and draw a single text run
    const usage = scanFontsUsed(doc);
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fontKey = usage.needsKR ? 'kr-sans-regular' : 'sans-regular';
    const fontBuf = await fonts.load(fontKey);
    const embeddedFont = await pdfDoc.embedFont(fontBuf, { subset: true });

    const setup = doc.pageSetup ?? DEFAULT_PAGE_SETUP;
    const { width: wPx, height: hPx } = getEffectiveDimensions(setup);
    const pageWidth = wPx / PX_PER_PT;
    const pageHeight = hPx / PX_PER_PT;

    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const text = doc.blocks[0]?.inlines.map(i => i.text).join('') ?? '';
    const fontSize = 12;
    page.drawText(text, {
      x: setup.margins.left / PX_PER_PT,
      y: pageHeight - setup.margins.top / PX_PER_PT - fontSize,
      size: fontSize,
      font: embeddedFont,
    });

    const bytes = await pdfDoc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }
}
```

- [ ] **1.5.4** Run, expect PASS.

- [ ] **1.5.5** Commit:

```bash
git add packages/docs/src/export/pdf-exporter.ts packages/docs/test/export/pdf-exporter.test.ts
git commit -m "Add PdfExporter skeleton with hello-world Korean output"
```

---

## Phase 2 — Text + inline styles

### Task 2.1: pdf-style-map — font key resolution + run splitting

**Files:**
- Create: `packages/docs/src/export/pdf-style-map.ts`
- Create: `packages/docs/test/export/pdf-style-map.test.ts`

- [ ] **2.1.1** Write tests:

```ts
// packages/docs/test/export/pdf-style-map.test.ts
import { describe, it, expect } from 'vitest';
import {
  resolveFontKey, splitMixedScript, styleColor, isItalicShim,
} from '../../src/export/pdf-style-map.js';
import type { InlineStyle } from '../../src/model/types.js';

describe('resolveFontKey', () => {
  it('returns sans-regular for default style + Latin', () => {
    expect(resolveFontKey({} as InlineStyle, false)).toBe('sans-regular');
  });
  it('returns kr-sans-bold for bold + Korean run', () => {
    expect(resolveFontKey({ bold: true } as InlineStyle, true)).toBe('kr-sans-bold');
  });
  it('returns sans-italic for italic + Latin', () => {
    expect(resolveFontKey({ italic: true } as InlineStyle, false)).toBe('sans-italic');
  });
  it('returns serif for known serif fontFamily', () => {
    expect(resolveFontKey({ fontFamily: 'Times New Roman' } as InlineStyle, false))
      .toBe('serif-regular');
  });
  it('returns kr-serif-regular for serif Korean', () => {
    expect(resolveFontKey({ fontFamily: '바탕' } as InlineStyle, true))
      .toBe('kr-serif-regular');
  });
});

describe('splitMixedScript', () => {
  it('returns single segment for ASCII-only', () => {
    const out = splitMixedScript('Hello World');
    expect(out).toEqual([{ text: 'Hello World', isCJK: false }]);
  });
  it('splits at script boundaries', () => {
    const out = splitMixedScript('Hello 안녕 World');
    expect(out).toEqual([
      { text: 'Hello ', isCJK: false },
      { text: '안녕', isCJK: true },
      { text: ' World', isCJK: false },
    ]);
  });
});

describe('styleColor', () => {
  it('parses #RRGGBB to {r,g,b} 0..1', () => {
    expect(styleColor('#FF8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
  });
  it('falls back to black for invalid', () => {
    expect(styleColor('not-a-color')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('isItalicShim', () => {
  it('shims Korean italic (no real italic font)', () => {
    expect(isItalicShim({ italic: true } as InlineStyle, true)).toBe(true);
  });
  it('does not shim Latin italic', () => {
    expect(isItalicShim({ italic: true } as InlineStyle, false)).toBe(false);
  });
});
```

- [ ] **2.1.2** Run, expect FAIL.

- [ ] **2.1.3** Implement:

```ts
// packages/docs/src/export/pdf-style-map.ts
import type { InlineStyle } from '../model/types.js';
import type { PdfFontKey } from './pdf-fonts.js';

const KR_RANGE_GLOBAL = /[\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]+|[^\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]+/g;
const KR_RANGE = /[\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/;
const SERIF_FAMILIES = new Set([
  '바탕', 'Batang', 'Noto Serif KR',
  'Times New Roman', 'Times', 'Georgia',
]);

export interface ScriptSegment {
  text: string;
  isCJK: boolean;
}

export function splitMixedScript(text: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  for (const match of text.matchAll(KR_RANGE_GLOBAL)) {
    const seg = match[0];
    segments.push({ text: seg, isCJK: KR_RANGE.test(seg) });
  }
  return segments;
}

export function resolveFontKey(style: InlineStyle, isCJK: boolean): PdfFontKey {
  const isSerif = SERIF_FAMILIES.has(style.fontFamily ?? 'Arial');
  const isBold = !!style.bold;
  const isItalic = !!style.italic;
  if (isCJK) {
    // Noto KR has no italic — caller must apply oblique transform; key falls
    // back to regular/bold and isItalicShim() reports the shim need.
    if (isSerif) return isBold ? 'kr-serif-bold' : 'kr-serif-regular';
    return isBold ? 'kr-sans-bold' : 'kr-sans-regular';
  }
  if (isSerif) {
    if (isBold && isItalic) return 'serif-boldItalic';
    if (isBold) return 'serif-bold';
    if (isItalic) return 'serif-italic';
    return 'serif-regular';
  }
  if (isBold && isItalic) return 'sans-boldItalic';
  if (isBold) return 'sans-bold';
  if (isItalic) return 'sans-italic';
  return 'sans-regular';
}

export function isItalicShim(style: InlineStyle, isCJK: boolean): boolean {
  return !!style.italic && isCJK;
}

export function styleColor(hex: string | undefined): { r: number; g: number; b: number } {
  if (!hex) return { r: 0, g: 0, b: 0 };
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}
```

- [ ] **2.1.4** Run, expect PASS.

- [ ] **2.1.5** Commit:

```bash
git add packages/docs/src/export/pdf-style-map.ts packages/docs/test/export/pdf-style-map.test.ts
git commit -m "Add pdf-style-map with font key resolution and run splitting"
```

---

### Task 2.2: PdfPainter — paragraph + simple text run

**Files:**
- Create: `packages/docs/src/export/pdf-painter.ts`
- Create: `packages/docs/test/export/pdf-painter.test.ts`

- [ ] **2.2.1** Write the failing test:

```ts
// packages/docs/test/export/pdf-painter.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PdfPainter } from '../../src/export/pdf-painter.js';
import { PdfFonts } from '../../src/export/pdf-fonts.js';
import { layoutDocument } from '../../src/view/layout.js';
import { paginateLayout } from '../../src/view/pagination.js';
import { DEFAULT_BLOCK_STYLE, DEFAULT_PAGE_SETUP, generateBlockId } from '../../src/model/types.js';
import type { Document } from '../../src/model/types.js';

const TEST_FONT = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/fonts/test-cjk.ttf'),
).buffer;

describe('PdfPainter', () => {
  it('paints a simple paragraph onto a PDF page', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fonts = await PdfPainter.embedAllFonts(pdfDoc, new PdfFonts({
      sources: Object.fromEntries(
        ['sans-regular','sans-bold','sans-italic','sans-boldItalic',
         'serif-regular','serif-bold','serif-italic','serif-boldItalic',
         'kr-sans-regular','kr-sans-bold',
         'kr-serif-regular','kr-serif-bold']
          .map(k => [k, () => Promise.resolve(TEST_FONT)]),
      ) as any,
    }));

    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'Hello', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
      pageSetup: { ...DEFAULT_PAGE_SETUP },
    };
    const layout = layoutDocument(doc, /* editContext */ null as any);
    const pagination = paginateLayout(layout, doc.pageSetup!);
    const page = pdfDoc.addPage([pagination.pages[0].width / 96 * 72,
                                  pagination.pages[0].height / 96 * 72]);

    PdfPainter.paintPage(page, pagination.pages[0], pagination.pageSetup, fonts, {
      doc, imageMap: new Map(),
    });

    const bytes = await pdfDoc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });
});
```

- [ ] **2.2.2** Run, expect FAIL.

- [ ] **2.2.3** Implement skeleton + simple-text path:

```ts
// packages/docs/src/export/pdf-painter.ts
import { PDFDocument, PDFPage, PDFFont, rgb } from 'pdf-lib';
import type { Document, PageSetup } from '../model/types.js';
import type { LayoutPage, PageLine } from '../view/pagination.js';
import type { LayoutRun } from '../view/layout.js';
import { PdfFonts, type PdfFontKey } from './pdf-fonts.js';
import { resolveFontKey, splitMixedScript, styleColor } from './pdf-style-map.js';

const PX_PER_PT = 96 / 72;
const px2pt = (px: number) => px / PX_PER_PT;

export type EmbeddedFonts = Record<PdfFontKey, PDFFont>;

export interface PaintContext {
  doc: Document;
  imageMap: Map<string, { embedded: any; width: number; height: number }>;
  pageNumber?: number;
}

export class PdfPainter {
  static async embedAllFonts(pdfDoc: PDFDocument, fonts: PdfFonts): Promise<EmbeddedFonts> {
    const keys: PdfFontKey[] = [
      'sans-regular','sans-bold','sans-italic','sans-boldItalic',
      'serif-regular','serif-bold','serif-italic','serif-boldItalic',
      'kr-sans-regular','kr-sans-bold',
      'kr-serif-regular','kr-serif-bold',
    ];
    const out: Partial<EmbeddedFonts> = {};
    for (const key of keys) {
      const buf = await fonts.load(key);
      out[key] = await pdfDoc.embedFont(buf, { subset: true });
    }
    return out as EmbeddedFonts;
  }

  static paintPage(
    page: PDFPage,
    layoutPage: LayoutPage,
    pageSetup: PageSetup,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    const pageHeightPt = page.getHeight();
    for (const pl of layoutPage.lines) {
      PdfPainter.paintLine(page, pl, pageHeightPt, fonts, ctx);
    }
  }

  private static paintLine(
    page: PDFPage,
    pl: PageLine,
    pageHeightPt: number,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    const baseY = pl.y + pl.line.baseline;
    for (const run of pl.line.runs) {
      PdfPainter.paintRun(page, run, pl.x, baseY, pageHeightPt, fonts, ctx);
    }
  }

  private static paintRun(
    page: PDFPage,
    run: LayoutRun,
    lineX: number,
    baseYpx: number,
    pageHeightPt: number,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    const style = run.inline.style;
    const sizePt = (style.fontSize ?? 11);
    let xpx = lineX + run.x;
    const segments = splitMixedScript(run.text);
    for (const seg of segments) {
      const key = resolveFontKey(style, seg.isCJK);
      const font = fonts[key];
      const widthPt = font.widthOfTextAtSize(seg.text, sizePt);
      page.drawText(seg.text, {
        x: px2pt(xpx),
        y: pageHeightPt - px2pt(baseYpx),
        size: sizePt,
        font,
        color: rgb(...Object.values(styleColor(style.color)) as [number, number, number]),
      });
      xpx += widthPt * PX_PER_PT;
    }
  }
}
```

> **NOTE for executor:** `LayoutRun.x`, `pl.line.baseline`, and the per-line structure assume the public shape of `view/layout.ts` and `view/pagination.ts`. If the field names differ (e.g., `runs` vs `inlineRuns`), adapt locally and document the actual shape in the lessons file.

- [ ] **2.2.4** Run, expect PASS.

- [ ] **2.2.5** Commit:

```bash
git add packages/docs/src/export/pdf-painter.ts packages/docs/test/export/pdf-painter.test.ts
git commit -m "Add PdfPainter for paragraph + simple text run"
```

---

### Task 2.3: Background color, underline, strikethrough

**Files:**
- Modify: `packages/docs/src/export/pdf-painter.ts`
- Modify: `packages/docs/test/export/pdf-painter.test.ts`

- [ ] **2.3.1** Add a parameterized helper and three tests (background, underline, strike):

```ts
// Append to pdf-painter.test.ts
async function renderWithStyle(style: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fonts = await PdfPainter.embedAllFonts(pdfDoc, new PdfFonts({
    sources: Object.fromEntries(
      ['sans-regular','sans-bold','sans-italic','sans-boldItalic',
       'serif-regular','serif-bold','serif-italic','serif-boldItalic',
       'kr-sans-regular','kr-sans-bold','kr-serif-regular','kr-serif-bold']
        .map(k => [k, () => Promise.resolve(TEST_FONT)]),
    ) as any,
  }));
  const doc: Document = {
    blocks: [{
      id: generateBlockId(), type: 'paragraph',
      inlines: [{ text: 'Sample', style }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }],
    pageSetup: { ...DEFAULT_PAGE_SETUP },
  };
  const layout = layoutDocument(doc, null as any);
  const pagination = paginateLayout(layout, doc.pageSetup!);
  const lp = pagination.pages[0];
  const page = pdfDoc.addPage([lp.width / 96 * 72, lp.height / 96 * 72]);
  PdfPainter.paintPage(page, lp, pagination.pageSetup, fonts, { doc, imageMap: new Map() });
  return pdfDoc.save();
}

it('draws underline below baseline for underlined runs', async () => {
  const plain = await renderWithStyle({});
  const underlined = await renderWithStyle({ underline: true });
  expect(underlined.byteLength).toBeGreaterThan(plain.byteLength);
});

it('draws background rectangle for backgroundColor runs', async () => {
  const plain = await renderWithStyle({});
  const colored = await renderWithStyle({ backgroundColor: '#FFFF00' });
  expect(colored.byteLength).toBeGreaterThan(plain.byteLength);
});

it('draws strike line for strikethrough runs', async () => {
  const plain = await renderWithStyle({});
  const struck = await renderWithStyle({ strikethrough: true });
  expect(struck.byteLength).toBeGreaterThan(plain.byteLength);
});
```

- [ ] **2.3.2** Run — initial structural fail expected.

- [ ] **2.3.3** Implement underline + strike + background. In `paintRun`, before drawing text:

```ts
// Background rectangle — draw before text so text overlays it
if (style.backgroundColor) {
  const bg = styleColor(style.backgroundColor);
  page.drawRectangle({
    x: px2pt(xpx),
    y: pageHeightPt - px2pt(baseYpx + run.descent),
    width: px2pt(run.width),
    height: px2pt(run.ascent + run.descent),
    color: rgb(bg.r, bg.g, bg.b),
  });
}
```

After drawing text, before advancing `xpx`:

```ts
// Underline 1pt below baseline
if (style.underline) {
  const c = styleColor(style.color);
  page.drawLine({
    start: { x: px2pt(xpx), y: pageHeightPt - px2pt(baseYpx + 1) },
    end:   { x: px2pt(xpx + widthPt * PX_PER_PT), y: pageHeightPt - px2pt(baseYpx + 1) },
    thickness: Math.max(0.5, sizePt / 16),
    color: rgb(c.r, c.g, c.b),
  });
}
// Strikethrough at baseline - ascent/2
if (style.strikethrough) {
  const c = styleColor(style.color);
  const yStrike = baseYpx - run.ascent / 2;
  page.drawLine({
    start: { x: px2pt(xpx), y: pageHeightPt - px2pt(yStrike) },
    end:   { x: px2pt(xpx + widthPt * PX_PER_PT), y: pageHeightPt - px2pt(yStrike) },
    thickness: Math.max(0.5, sizePt / 16),
    color: rgb(c.r, c.g, c.b),
  });
}
```

> **Note:** `run.ascent` / `run.descent` may not be on `LayoutRun` directly — read them from the embedded font metrics (`font.heightAtSize(sizePt) * ratio`) if absent. Adapt at implementation time.

- [ ] **2.3.4** Run the painter tests, expect PASS:

```bash
pnpm --filter @wafflebase/docs test pdf-painter -- --run
```

- [ ] **2.3.5** Commit:

```bash
git add packages/docs/src/export/pdf-painter.ts packages/docs/test/export/pdf-painter.test.ts
git commit -m "Draw background, underline, strikethrough in PDF painter"
```

---

### Task 2.4: Superscript / subscript

- [ ] **2.4.1** Add a test that compares run y-position when `superscript: true` is set vs not (PDF text matrix x/y appears in raw bytes — assert distinct outputs).

- [ ] **2.4.2** Run, expect FAIL.

- [ ] **2.4.3** In `paintRun`, before the text draw:

```ts
let drawSize = sizePt;
let drawY = pageHeightPt - px2pt(baseYpx);
if (style.superscript) {
  drawSize = sizePt * 0.7;
  drawY = pageHeightPt - px2pt(baseYpx - run.ascent * 0.4);
} else if (style.subscript) {
  drawSize = sizePt * 0.7;
  drawY = pageHeightPt - px2pt(baseYpx + run.ascent * 0.2);
}
// ... pass drawSize and drawY to drawText
```

- [ ] **2.4.4** Run, expect PASS.

- [ ] **2.4.5** Commit:

```bash
git add packages/docs/src/export/pdf-painter.ts packages/docs/test/export/pdf-painter.test.ts
git commit -m "Add superscript/subscript scaling and y-offset"
```

---

### Task 2.5: Italic Korean (oblique transform)

- [ ] **2.5.1** Add a test that confirms `italic: true` on Korean text still produces a valid PDF (re-loadable, page count 1) and is byte-different from non-italic equivalent.

- [ ] **2.5.2** Run, expect FAIL.

- [ ] **2.5.3** In `paintRun`, when `isItalicShim(style, seg.isCJK)`, push a text matrix with horizontal skew before drawing, then pop:

```ts
import { pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib';

if (isItalicShim(style, seg.isCJK)) {
  const skew = Math.tan(12 * Math.PI / 180); // ~12 degrees
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(1, 0, skew, 1,
      px2pt(xpx) - skew * (pageHeightPt - px2pt(baseYpx)), 0),
  );
  page.drawText(seg.text, { x: px2pt(xpx), y: pageHeightPt - px2pt(baseYpx), size: drawSize, font, color: rgb(c.r, c.g, c.b) });
  page.pushOperators(popGraphicsState());
} else {
  page.drawText(seg.text, { /* as before */ });
}
```

> **Note for executor:** the matrix tx/ty are dependent on the chosen origin; verify visually in Phase 1's hello-world output. The `(skew * y)` offset compensates for the y-shift introduced by skew.

- [ ] **2.5.4** Run, expect PASS.

- [ ] **2.5.5** Commit:

```bash
git add packages/docs/src/export/pdf-painter.ts packages/docs/test/export/pdf-painter.test.ts
git commit -m "Shim italic Korean via PDF text matrix skew"
```

---

### Task 2.6: PdfExporter — wire layout + pagination + painter

**Files:**
- Modify: `packages/docs/src/export/pdf-exporter.ts`
- Modify: `packages/docs/test/export/pdf-exporter.test.ts`
- Create: `packages/docs/test/export/fixtures/pdf/simple-paragraph.json`
- Create: `packages/docs/test/export/fixtures/pdf/mixed-korean-english.json`

- [ ] **2.6.1** Create fixtures:

```json
// packages/docs/test/export/fixtures/pdf/simple-paragraph.json
{
  "blocks": [{
    "id": "b1",
    "type": "paragraph",
    "inlines": [{ "text": "The quick brown fox.", "style": {} }],
    "style": { "alignment": "left", "lineHeight": 1.5, "marginTop": 0, "marginBottom": 8, "textIndent": 0, "marginLeft": 0 }
  }]
}
```

```json
// packages/docs/test/export/fixtures/pdf/mixed-korean-english.json
{
  "blocks": [{
    "id": "b1",
    "type": "paragraph",
    "inlines": [
      { "text": "Hello ", "style": {} },
      { "text": "안녕하세요", "style": { "bold": true } },
      { "text": " World", "style": { "italic": true } }
    ],
    "style": { "alignment": "left", "lineHeight": 1.5, "marginTop": 0, "marginBottom": 8, "textIndent": 0, "marginLeft": 0 }
  }]
}
```

- [ ] **2.6.2** Write fixture-driven tests:

```ts
// Append to pdf-exporter.test.ts
import simpleFixture from './fixtures/pdf/simple-paragraph.json';
import mixedFixture from './fixtures/pdf/mixed-korean-english.json';

it('exports the simple-paragraph fixture', async () => {
  const blob = await PdfExporter.export(simpleFixture as any, { fonts: testFonts() });
  const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
  expect(pdfDoc.getPageCount()).toBe(1);
});

it('exports the mixed-korean-english fixture', async () => {
  const blob = await PdfExporter.export(mixedFixture as any, { fonts: testFonts() });
  const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
  expect(pdfDoc.getPageCount()).toBe(1);
  expect(blob.size).toBeGreaterThan(1000);
});
```

- [ ] **2.6.3** Run, expect FAIL (current exporter only draws first inline naively).

- [ ] **2.6.4** Replace the body of `PdfExporter.export` with the full pipeline:

```ts
import { layoutDocument } from '../view/layout.js';
import { paginateLayout } from '../view/pagination.js';
import { PdfPainter } from './pdf-painter.js';
import { collectImages } from './pdf-image-painter.js'; // stub for now

static async export(doc: Document, opts: PdfExportOptions = {}): Promise<Blob> {
  const fonts = opts.fonts ?? new PdfFonts();

  // 1. Pre-load Noto KR into document.fonts so Canvas measureText is consistent
  await ensureCanvasFontsLoaded(scanFontsUsed(doc));

  // 2. Layout + paginate (reuse view modules)
  const layout = layoutDocument(doc, /* editContext */ null as any);
  const pagination = paginateLayout(layout, doc.pageSetup ?? DEFAULT_PAGE_SETUP);

  // 3. Image fetch (Phase 5)
  const imageMap = new Map();

  // 4. PDF setup
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const embeddedFonts = await PdfPainter.embedAllFonts(pdfDoc, fonts);

  // 5. Per-page paint
  for (let i = 0; i < pagination.pages.length; i++) {
    const lp = pagination.pages[i];
    const page = pdfDoc.addPage([lp.width / PX_PER_PT, lp.height / PX_PER_PT]);
    PdfPainter.paintPage(page, lp, pagination.pageSetup, embeddedFonts, {
      doc, imageMap, pageNumber: i + 1,
    });
  }

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

async function ensureCanvasFontsLoaded(usage: ReturnType<typeof scanFontsUsed>): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const families: string[] = [];
  if (usage.needsKR) families.push('Noto Sans KR');
  if (usage.needsKRSerif) families.push('Noto Serif KR');
  await Promise.all(families.map(f =>
    document.fonts.load(`12px "${f}"`).catch(() => {/* ignore */}),
  ));
}
```

- [ ] **2.6.5** Stub `pdf-image-painter.ts` to keep imports happy (full impl in Phase 5):

```ts
// packages/docs/src/export/pdf-image-painter.ts
export async function collectImages() {
  return new Map();
}
```

- [ ] **2.6.6** Run, expect PASS.

- [ ] **2.6.7** Commit:

```bash
git add packages/docs/src/export/pdf-exporter.ts packages/docs/src/export/pdf-image-painter.ts \
        packages/docs/test/export/pdf-exporter.test.ts packages/docs/test/export/fixtures/pdf/
git commit -m "Wire PdfExporter pipeline through layout + paginate + painter"
```

---

### Task 2.7: Hyperlink annotations on `href` runs

- [ ] **2.7.1** Add a test using a fixture with an `href` run; reload PDF and assert the page has `Annots` referencing a `Link` annotation:

```ts
it('emits link annotations for href runs', async () => {
  const doc = {
    blocks: [{ id: 'b1', type: 'paragraph', style: {...}, inlines: [
      { text: 'click here', style: { href: 'https://example.com' } },
    ]}],
  };
  const blob = await PdfExporter.export(doc as any, { fonts: testFonts() });
  const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
  const page = pdfDoc.getPage(0);
  const annots = page.node.Annots();
  expect(annots).toBeDefined();
  expect(annots!.size()).toBeGreaterThanOrEqual(1);
});
```

- [ ] **2.7.2** Run, expect FAIL.

- [ ] **2.7.3** In `paintRun`, after drawing each segment:

```ts
import { PDFName, PDFString } from 'pdf-lib';

if (style.href) {
  const x1 = px2pt(xpx);
  const y2 = pageHeightPt - px2pt(baseYpx - run.ascent);
  const x2 = px2pt(xpx + widthPt * PX_PER_PT);
  const y1 = pageHeightPt - px2pt(baseYpx + run.descent);
  const annot = page.doc.context.obj({
    Type: 'Annot', Subtype: 'Link',
    Rect: [x1, y1, x2, y2],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(style.href) },
  });
  const annotRef = page.doc.context.register(annot);
  const existing = page.node.Annots() ?? page.doc.context.obj([]);
  existing.push(annotRef);
  page.node.set(PDFName.of('Annots'), existing);
}
```

- [ ] **2.7.4** Run, expect PASS.

- [ ] **2.7.5** Commit:

```bash
git add packages/docs/src/export/pdf-painter.ts packages/docs/test/export/pdf-painter.test.ts
git commit -m "Emit link annotations for href inline runs"
```

---

## Phase 3 — Pages, header/footer, page numbers

### Task 3.1: Multi-page rendering loop verified

**Files:**
- Create: `packages/docs/test/export/fixtures/pdf/multi-page.json`
- Modify: `packages/docs/test/export/pdf-exporter.test.ts`

- [ ] **3.1.1** Create a fixture with enough text to span 3 pages. Generate programmatically:

```ts
// In the test file, before the multi-page test:
const longDoc: Document = {
  blocks: Array.from({ length: 200 }, (_, i) => ({
    id: `p${i}`,
    type: 'paragraph' as const,
    inlines: [{ text: `Paragraph ${i}: lorem ipsum dolor sit amet consectetur.`, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  })),
};
```

- [ ] **3.1.2** Add the test:

```ts
it('produces multiple pages for long content', async () => {
  const blob = await PdfExporter.export(longDoc, { fonts: testFonts() });
  const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
  expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(2);
});
```

- [ ] **3.1.3** Run. If the existing pipeline already produces multiple pages, this passes immediately — record that in lessons. If only 1 page, debug `paginateLayout` integration.

- [ ] **3.1.4** Commit (assertion-only, no source change expected):

```bash
git add packages/docs/test/export/pdf-exporter.test.ts
git commit -m "Add multi-page integration test"
```

---

### Task 3.2: Headers, footers, page-number substitution

**Files:**
- Modify: `packages/docs/src/export/pdf-painter.ts`
- Create: `packages/docs/test/export/fixtures/pdf/with-header-footer-pagenumber.json`

- [ ] **3.2.1** Create fixture with `header` + `footer` containing `{ pageNumber: true }` inline:

```json
{
  "blocks": [
    { "id": "b1", "type": "paragraph",
      "inlines": [{ "text": "Body line 1", "style": {} }],
      "style": { "alignment": "left", "lineHeight": 1.5, "marginTop": 0, "marginBottom": 8, "textIndent": 0, "marginLeft": 0 } }
  ],
  "header": { "blocks": [
    { "id": "h1", "type": "paragraph",
      "inlines": [{ "text": "My Document", "style": {} }],
      "style": { "alignment": "right", "lineHeight": 1.5, "marginTop": 0, "marginBottom": 0, "textIndent": 0, "marginLeft": 0 } }
  ]},
  "footer": { "blocks": [
    { "id": "f1", "type": "paragraph",
      "inlines": [
        { "text": "Page ", "style": {} },
        { "text": "X", "style": { "pageNumber": true } }
      ],
      "style": { "alignment": "center", "lineHeight": 1.5, "marginTop": 0, "marginBottom": 0, "textIndent": 0, "marginLeft": 0 } }
  ]}
}
```

- [ ] **3.2.2** Add an integration test that exports the fixture, asserts `getPageCount() >= 1` and that the resulting PDF size is larger than the version with empty header/footer (proving header/footer drew text).

- [ ] **3.2.3** Run, expect FAIL (header/footer not drawn).

- [ ] **3.2.4** Extend `PdfPainter.paintPage` to render header/footer regions. The `LayoutPage` does **not** include header/footer lines today — `view/pagination.ts` exposes `getHeaderYStart` / `getFooterYStart` and the doc-canvas re-lays out header/footer per page (see `doc-canvas.ts`). Mirror that:

```ts
import { layoutDocument } from '../view/layout.js';
import { getHeaderYStart, getFooterYStart } from '../view/pagination.js';

static paintPage(page, layoutPage, pageSetup, fonts, ctx) {
  const pageHeightPt = page.getHeight();
  // Body
  for (const pl of layoutPage.lines) PdfPainter.paintLine(page, pl, pageHeightPt, fonts, ctx);
  // Header
  if (ctx.doc.header) {
    const headerLayout = layoutDocument({ blocks: ctx.doc.header.blocks } as Document, null as any);
    const startY = getHeaderYStart(pageSetup);
    for (const lb of headerLayout.blocks) {
      for (const line of lb.lines) {
        const pseudoPl = { line, x: lb.x, y: startY + line.y, blockIndex: 0, lineIndex: 0 };
        PdfPainter.paintLine(page, pseudoPl as any, pageHeightPt, fonts, { ...ctx, isHeader: true });
      }
    }
  }
  // Footer (analogous, using getFooterYStart)
  // ...
}
```

> **Note for executor:** the `layoutDocument` and `paginateLayout` API on header/footer subdocs may need a small adapter — verify against the actual signatures and adjust. This is the largest "shape uncertainty" task — record findings in lessons.

- [ ] **3.2.5** In `paintRun`, when run inline has `style.pageNumber === true`, substitute its text with `String(ctx.pageNumber)` before splitMixedScript.

- [ ] **3.2.6** Run, expect PASS.

- [ ] **3.2.7** Commit:

```bash
git add packages/docs/src/export/pdf-painter.ts packages/docs/test/export/pdf-exporter.test.ts \
        packages/docs/test/export/fixtures/pdf/with-header-footer-pagenumber.json
git commit -m "Render headers/footers and substitute page numbers"
```

---

### Task 3.3: List markers (bullets + numbered)

**Files:**
- Modify: `packages/docs/src/export/pdf-painter.ts`
- Create: `packages/docs/test/export/fixtures/pdf/with-list.json`

- [ ] **3.3.1** Create a fixture with bullet + numbered list items.

- [ ] **3.3.2** Add a test asserting export succeeds and PDF size > equivalent flat paragraph version (proves marker drew).

- [ ] **3.3.3** Run, expect FAIL.

- [ ] **3.3.4** In `paintPage`, before painting body lines, compute the list-counter map once per document and pass into the painter:

```ts
import { computeListCounters } from '../view/layout.js';

// In PdfExporter.export, before the per-page loop:
const listCounters = computeListCounters(doc.blocks);
// ...pass into ctx as ctx.listCounters
```

In `paintLine`, if the source block is a list item AND `pl.lineIndex === 0` (first wrapped line of the block), draw the marker:

```ts
const block = ctx.doc.blocks[pl.blockIndex];
if (block?.type === 'list-item' && pl.lineIndex === 0) {
  const marker = ctx.listCounters.get(block.id) ?? '•';
  const markerStyle = block.inlines[0]?.style ?? {};
  // Draw marker at line.x - LIST_INDENT_PX
  // Use same baseline as first line
  // ... (analogous to paintRun for the marker text)
}
```

- [ ] **3.3.5** Run, expect PASS.

- [ ] **3.3.6** Commit:

```bash
git add packages/docs/src/export/pdf-painter.ts packages/docs/test/export/pdf-exporter.test.ts \
        packages/docs/test/export/fixtures/pdf/with-list.json
git commit -m "Draw list markers in PDF painter"
```

---

## Phase 4 — Tables

### Task 4.1: Extract table-geometry from table-renderer

**Files:**
- Create: `packages/docs/src/view/table-geometry.ts`
- Modify: `packages/docs/src/view/table-renderer.ts`
- Modify: `packages/docs/test/view/*` (only if tests directly exercise the moved code)

- [ ] **4.1.1** Identify pure-geometry helpers in `table-renderer.ts`:
  - `computeTableRangeForPageLine` (already shown in `doc-canvas.ts`-imported APIs)
  - cell rect helpers (col x-offset, row y-offset, cell width/height)
  - merged-cell coverage check

- [ ] **4.1.2** Create `view/table-geometry.ts` and copy the helpers verbatim:

```ts
// packages/docs/src/view/table-geometry.ts
// Pure geometry for table layout — shared between Canvas renderer and PDF painter.
import type { LayoutBlock, LayoutPage, PageLine } from './pagination.js';

export function computeTableRangeForPageLine(/* same signature */) {
  // (paste body)
}

export function cellOriginPx(tableData: any, row: number, col: number): { x: number; y: number; w: number; h: number } {
  // (paste / extract)
}
```

- [ ] **4.1.3** In `table-renderer.ts`, replace the duplicated bodies with imports from `table-geometry.ts`. Keep behavior identical.

- [ ] **4.1.4** Run all docs tests:

```bash
pnpm --filter @wafflebase/docs test -- --run
```
Expected: all 622+ tests still PASS.

- [ ] **4.1.5** Commit:

```bash
git add packages/docs/src/view/table-geometry.ts packages/docs/src/view/table-renderer.ts
git commit -m "Extract pure table geometry helpers into view/table-geometry"
```

---

### Task 4.2: Table backgrounds + borders

**Files:**
- Create: `packages/docs/src/export/pdf-table-painter.ts`
- Create: `packages/docs/test/export/pdf-table-painter.test.ts`
- Create: `packages/docs/test/export/fixtures/pdf/with-table.json`

- [ ] **4.2.1** Create fixture with a 3x3 table.

- [ ] **4.2.2** Write a test asserting the exported PDF has 1 page and size > a no-table baseline (proves rectangles + lines were drawn).

- [ ] **4.2.3** Run, expect FAIL.

- [ ] **4.2.4** Implement `pdf-table-painter.ts`:

```ts
// packages/docs/src/export/pdf-table-painter.ts
import { PDFPage, rgb } from 'pdf-lib';
import type { LayoutPage, PageLine } from '../view/pagination.js';
import { computeTableRangeForPageLine, cellOriginPx } from '../view/table-geometry.js';
import { styleColor } from './pdf-style-map.js';
import type { EmbeddedFonts, PaintContext } from './pdf-painter.js';

const PX_PER_PT = 96 / 72;
const px2pt = (px: number) => px / PX_PER_PT;

export function paintTablePageRange(
  page: PDFPage,
  layoutPage: LayoutPage,
  pl: PageLine,
  plIndex: number,
  pageHeightPt: number,
  fonts: EmbeddedFonts,
  ctx: PaintContext,
  paintCellContent: (cellBlocks: Block[], rect: Rect) => void,
): void {
  const layoutBlock = /* lookup from ctx by pl.blockIndex */ null as any;
  const range = computeTableRangeForPageLine(layoutPage, layoutBlock, pl, plIndex);
  const tableData = layoutBlock.block.tableData;

  // 1. backgrounds
  for (let r = range.renderStartRow; r < range.endRowIndex; r++) {
    for (let c = 0; c < tableData.rows[r].cells.length; c++) {
      const cell = tableData.rows[r].cells[c];
      if (cell.colSpan === 0) continue; // covered cell
      const { x, y, w, h } = cellOriginPx(tableData, r, c);
      if (cell.style?.backgroundColor) {
        const bg = styleColor(cell.style.backgroundColor);
        page.drawRectangle({
          x: px2pt(x), y: pageHeightPt - px2pt(y + h),
          width: px2pt(w), height: px2pt(h),
          color: rgb(bg.r, bg.g, bg.b),
        });
      }
    }
  }

  // 2. borders (top/right/bottom/left per cell)
  for (let r = range.renderStartRow; r < range.endRowIndex; r++) {
    for (let c = 0; c < tableData.rows[r].cells.length; c++) {
      const cell = tableData.rows[r].cells[c];
      if (cell.colSpan === 0) continue;
      const { x, y, w, h } = cellOriginPx(tableData, r, c);
      drawCellBorders(page, cell, x, y, w, h, pageHeightPt);
    }
  }

  // 3. cell content (delegated)
  for (let r = range.renderStartRow; r < range.endRowIndex; r++) {
    for (let c = 0; c < tableData.rows[r].cells.length; c++) {
      const cell = tableData.rows[r].cells[c];
      if (cell.colSpan === 0) continue;
      const { x, y, w, h } = cellOriginPx(tableData, r, c);
      paintCellContent(cell.blocks ?? [], { x, y, w, h });
    }
  }
}

function drawCellBorders(page: PDFPage, cell: any, x: number, y: number, w: number, h: number, pageHeightPt: number) {
  const borders = cell.style?.borders ?? {};
  for (const side of ['top','right','bottom','left'] as const) {
    if (borders[side]?.style === 'none') continue;
    const c = styleColor(borders[side]?.color ?? '#000000');
    const t = borders[side]?.width ?? 0.5;
    const ptColor = rgb(c.r, c.g, c.b);
    let x1 = x, y1 = y, x2 = x, y2 = y;
    if (side === 'top')    { x1 = x;       y1 = y;       x2 = x + w;   y2 = y;       }
    if (side === 'bottom') { x1 = x;       y1 = y + h;   x2 = x + w;   y2 = y + h;   }
    if (side === 'left')   { x1 = x;       y1 = y;       x2 = x;       y2 = y + h;   }
    if (side === 'right')  { x1 = x + w;   y1 = y;       x2 = x + w;   y2 = y + h;   }
    page.drawLine({
      start: { x: px2pt(x1), y: pageHeightPt - px2pt(y1) },
      end:   { x: px2pt(x2), y: pageHeightPt - px2pt(y2) },
      thickness: Math.max(0.25, t / PX_PER_PT),
      color: ptColor,
    });
  }
}

interface Rect { x: number; y: number; w: number; h: number; }
```

- [ ] **4.2.5** Wire into `PdfPainter.paintPage`: when a `PageLine` belongs to a table block (its corresponding `LayoutBlock.block.tableData` is set), delegate to `paintTablePageRange` and skip ahead by the range size.

- [ ] **4.2.6** Run, expect PASS.

- [ ] **4.2.7** Commit:

```bash
git add packages/docs/src/export/pdf-table-painter.ts packages/docs/src/export/pdf-painter.ts \
        packages/docs/test/export/pdf-table-painter.test.ts packages/docs/test/export/fixtures/pdf/with-table.json
git commit -m "Paint table backgrounds and borders in PDF"
```

---

### Task 4.3: Cell content (recursive paint)

- [ ] **4.3.1** In `paintTablePageRange`, the `paintCellContent` callback delegates back to `PdfPainter.paintLine` per cell-block-line. Implement using a cell-local layout (call `layoutDocument` on `cell.blocks` with cell width as the effective width).

- [ ] **4.3.2** Add a test asserting that text content of cells appears in the PDF (size >= empty-cells baseline + delta).

- [ ] **4.3.3** Run, expect PASS.

- [ ] **4.3.4** Commit:

```bash
git add packages/docs/src/export/pdf-table-painter.ts packages/docs/test/export/pdf-table-painter.test.ts
git commit -m "Recursively paint cell content in PDF tables"
```

---

### Task 4.4: Merged cells (colSpan / rowSpan)

**Files:**
- Create: `packages/docs/test/export/fixtures/pdf/with-merged-cells.json`

- [ ] **4.4.1** Create fixture with a 3×3 table containing one `colSpan: 2` and one `rowSpan: 2`.

- [ ] **4.4.2** Add test asserting export succeeds (1 page, size > non-merged baseline) and that re-loading the PDF doesn't error.

- [ ] **4.4.3** Run; the previous geometry handling should already support merged cells (the geometry helper extracted in 4.1 covers this). If not, debug.

- [ ] **4.4.4** Commit:

```bash
git add packages/docs/test/export/pdf-table-painter.test.ts packages/docs/test/export/fixtures/pdf/with-merged-cells.json
git commit -m "Add merged-cells PDF table integration test"
```

---

### Task 4.5: Row split across pages

**Files:**
- Create: `packages/docs/test/export/fixtures/pdf/with-split-row.json`

- [ ] **4.5.1** Create fixture: a table with one tall row (lots of text in a cell) such that it forces a row split across two pages.

- [ ] **4.5.2** Add test asserting `getPageCount() === 2` and both pages have non-trivial size.

- [ ] **4.5.3** Run, expect FAIL or PASS depending on whether `pl.rowSplitOffset/rowSplitHeight` is currently honored.

- [ ] **4.5.4** If FAIL: in `paintTablePageRange`, when `pl.rowSplitOffset !== undefined`, clip the cell rect's vertical span using `pl.rowSplitOffset` and `pl.rowSplitHeight` and translate the cell-content origin accordingly. Use `pdf-lib` graphics state push/pop with a clip rectangle.

- [ ] **4.5.5** Run, expect PASS.

- [ ] **4.5.6** Commit:

```bash
git add packages/docs/src/export/pdf-table-painter.ts packages/docs/test/export/pdf-table-painter.test.ts \
        packages/docs/test/export/fixtures/pdf/with-split-row.json
git commit -m "Honor row split offsets when painting tables across pages"
```

---

## Phase 5 — Images

### Task 5.1: Image collection + native PNG/JPEG embed

**Files:**
- Modify: `packages/docs/src/export/pdf-image-painter.ts` (replace stub)
- Create: `packages/docs/test/export/pdf-image-painter.test.ts`
- Create: `packages/docs/test/export/fixtures/pdf/with-image.json`
- Create: `packages/docs/test/export/fixtures/pdf/test-image.png` (small PNG)

- [ ] **5.1.1** Create a tiny test PNG (e.g., 10×10 red square via `Buffer` literal, or commit a small file).

- [ ] **5.1.2** Create fixture `with-image.json` with a single inline whose `style.image = { src: 'test://image1', width: 100, height: 100 }`.

- [ ] **5.1.3** Add test:

```ts
it('embeds an image inline', async () => {
  const pngBytes = fs.readFileSync(path.resolve(__dirname, 'fixtures/pdf/test-image.png'));
  const blob = await PdfExporter.export(imageFixture as any, {
    fonts: testFonts(),
    imageFetcher: async () => new Blob([pngBytes], { type: 'image/png' }),
  });
  const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
  expect(pdfDoc.getPageCount()).toBe(1);
  // pdf-lib Document does not expose XObject count cleanly; assert size delta:
  expect(blob.size).toBeGreaterThan(pngBytes.byteLength);
});
```

- [ ] **5.1.4** Run, expect FAIL.

- [ ] **5.1.5** Replace `pdf-image-painter.ts` stub:

```ts
// packages/docs/src/export/pdf-image-painter.ts
import { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import type { Document, Block, Inline } from '../model/types.js';
import type { PaintContext } from './pdf-painter.js';

export type ImageFetcher = (url: string) => Promise<Blob>;

export interface EmbeddedImage {
  embedded: PDFImage;
  width: number;
  height: number;
}

export async function collectAndEmbedImages(
  doc: Document,
  pdfDoc: PDFDocument,
  fetcher?: ImageFetcher,
): Promise<Map<string, EmbeddedImage>> {
  const out = new Map<string, EmbeddedImage>();
  const srcs = new Set<string>();
  collectSrcs(doc.blocks, srcs);
  if (doc.header) collectSrcs(doc.header.blocks, srcs);
  if (doc.footer) collectSrcs(doc.footer.blocks, srcs);
  if (srcs.size === 0) return out;
  if (!fetcher) throw new Error('imageFetcher required: document contains image inlines');

  for (const src of srcs) {
    const blob = await fetcher(src);
    const buf = await blob.arrayBuffer();
    const mime = blob.type.toLowerCase();
    let img: PDFImage;
    if (mime === 'image/png') img = await pdfDoc.embedPng(buf);
    else if (mime === 'image/jpeg' || mime === 'image/jpg') img = await pdfDoc.embedJpg(buf);
    else img = await embedAsPng(pdfDoc, buf, mime);
    out.set(src, { embedded: img, width: img.width, height: img.height });
  }
  return out;
}

async function embedAsPng(pdfDoc: PDFDocument, buf: ArrayBuffer, mime: string): Promise<PDFImage> {
  // Decode via Canvas, re-encode as PNG. Browser-only path.
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    const pngBlob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/png')!);
    return pdfDoc.embedPng(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function collectSrcs(blocks: Block[], out: Set<string>): void {
  for (const block of blocks) {
    if (block.tableData) {
      for (const row of block.tableData.rows) {
        for (const cell of row.cells) collectSrcs(cell.blocks ?? [], out);
      }
    }
    for (const inline of block.inlines) {
      if (inline.style.image) out.add(inline.style.image.src);
    }
  }
}
```

- [ ] **5.1.6** In `PdfExporter.export`, call `collectAndEmbedImages(doc, pdfDoc, opts.imageFetcher)` and pass the result through `ctx.imageMap`.

- [ ] **5.1.7** In `PdfPainter.paintRun`, when `style.image` is set, draw via `page.drawImage`:

```ts
if (style.image) {
  const entry = ctx.imageMap.get(style.image.src);
  if (entry) {
    page.drawImage(entry.embedded, {
      x: px2pt(xpx),
      y: pageHeightPt - px2pt(baseYpx + style.image.height),
      width: px2pt(style.image.width),
      height: px2pt(style.image.height),
    });
  }
  return; // skip text rendering for image inline
}
```

- [ ] **5.1.8** Run, expect PASS.

- [ ] **5.1.9** Commit:

```bash
git add packages/docs/src/export/pdf-image-painter.ts packages/docs/src/export/pdf-painter.ts \
        packages/docs/src/export/pdf-exporter.ts packages/docs/test/export/pdf-image-painter.test.ts \
        packages/docs/test/export/fixtures/pdf/test-image.png packages/docs/test/export/fixtures/pdf/with-image.json
git commit -m "Embed and draw inline images in PDF export"
```

---

## Phase 6 — PDF-native features

### Task 6.1: Document metadata

**Files:**
- Modify: `packages/docs/src/export/pdf-exporter.ts`
- Modify: `packages/docs/test/export/pdf-exporter.test.ts`

- [ ] **6.1.1** Add test:

```ts
it('writes title and author into PDF metadata', async () => {
  const blob = await PdfExporter.export(simpleFixture as any, {
    fonts: testFonts(),
    metadata: { title: 'My Doc', author: 'Alice' },
  });
  const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
  expect(pdfDoc.getTitle()).toBe('My Doc');
  expect(pdfDoc.getAuthor()).toBe('Alice');
});
```

- [ ] **6.1.2** Run, expect FAIL.

- [ ] **6.1.3** In `PdfExporter.export`, after creating `pdfDoc`:

```ts
if (opts.metadata?.title) pdfDoc.setTitle(opts.metadata.title);
if (opts.metadata?.author) pdfDoc.setAuthor(opts.metadata.author);
if (opts.metadata?.subject) pdfDoc.setSubject(opts.metadata.subject);
if (opts.metadata?.keywords) pdfDoc.setKeywords(opts.metadata.keywords);
pdfDoc.setCreationDate(new Date());
pdfDoc.setModificationDate(new Date());
pdfDoc.setProducer('Wafflebase Docs');
pdfDoc.setCreator('Wafflebase Docs');
```

- [ ] **6.1.4** Run, expect PASS.

- [ ] **6.1.5** Commit:

```bash
git add packages/docs/src/export/pdf-exporter.ts packages/docs/test/export/pdf-exporter.test.ts
git commit -m "Set PDF metadata fields from options"
```

---

### Task 6.2: Heading-driven outline / bookmarks

**Files:**
- Create: `packages/docs/test/export/fixtures/pdf/with-headings-and-links.json`
- Modify: `packages/docs/src/export/pdf-exporter.ts`

- [ ] **6.2.1** Create fixture with 3 heading blocks (levels 1, 2, 2).

- [ ] **6.2.2** Add test asserting that the PDF Catalog has an `Outlines` entry with at least 3 children:

```ts
it('emits a heading outline tree', async () => {
  const blob = await PdfExporter.export(headingFixture as any, { fonts: testFonts() });
  const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
  const catalog = pdfDoc.catalog;
  const outlines = catalog.lookup(PDFName.of('Outlines'));
  expect(outlines).toBeDefined();
});
```

- [ ] **6.2.3** Run, expect FAIL.

- [ ] **6.2.4** Implement `addOutlineFromHeadings` in `pdf-exporter.ts`:

```ts
import { PDFDict, PDFName, PDFRef, PDFString, PDFArray, PDFNumber } from 'pdf-lib';

function addOutlineFromHeadings(
  pdfDoc: PDFDocument,
  doc: Document,
  pagination: PaginatedLayout,
  blockToPage: Map<string, number>,
): void {
  const headings = doc.blocks
    .filter(b => b.type === 'heading')
    .map(b => ({
      title: b.inlines.map(i => i.text).join(''),
      level: b.headingLevel ?? 1,
      page: blockToPage.get(b.id) ?? 0,
    }));
  if (headings.length === 0) return;

  const ctx = pdfDoc.context;
  const outlinesRef = ctx.nextRef();
  const itemRefs = headings.map(() => ctx.nextRef());
  // Build sibling chain (flat for now — nest in follow-up if needed)
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const dest = ctx.obj([pdfDoc.getPage(h.page).ref, PDFName.of('Fit')]);
    const item = ctx.obj({
      Title: PDFString.of(h.title),
      Parent: outlinesRef,
      Dest: dest,
      ...(i > 0 && { Prev: itemRefs[i - 1] }),
      ...(i < headings.length - 1 && { Next: itemRefs[i + 1] }),
    });
    ctx.assign(itemRefs[i], item);
  }
  const outlines = ctx.obj({
    Type: PDFName.of('Outlines'),
    First: itemRefs[0],
    Last: itemRefs[itemRefs.length - 1],
    Count: headings.length,
  });
  ctx.assign(outlinesRef, outlines);
  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);
}
```

Build `blockToPage` while paginating: in the per-page paint loop, record the first occurrence of each `pl.blockIndex` per page.

- [ ] **6.2.5** Run, expect PASS.

- [ ] **6.2.6** Commit:

```bash
git add packages/docs/src/export/pdf-exporter.ts packages/docs/test/export/pdf-exporter.test.ts \
        packages/docs/test/export/fixtures/pdf/with-headings-and-links.json
git commit -m "Emit PDF outline tree from heading blocks"
```

---

## Phase 7 — Frontend integration

### Task 7.1: Extract export-utils from docx-actions

**Files:**
- Create: `packages/frontend/src/app/docs/export-utils.ts`
- Modify: `packages/frontend/src/app/docs/docx-actions.ts`

- [ ] **7.1.1** Create `export-utils.ts` with the shared helpers from `docx-actions.ts`:

```ts
// packages/frontend/src/app/docs/export-utils.ts
import type { ImageFetcher, ImageUploader } from '@wafflebase/docs';
import { fetchWithAuth } from '@/api/auth';

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? '';

export function resolveImageUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!BACKEND_BASE) return url;
  return `${BACKEND_BASE.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
}

export const docsImageUploader: ImageUploader = async (blob, filename) => {
  const formData = new FormData();
  formData.append('file', blob, filename);
  const res = await fetchWithAuth(`${BACKEND_BASE}/images`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`Image upload failed: ${res.status} ${res.statusText}`);
  const { url } = (await res.json()) as { id: string; url: string };
  return resolveImageUrl(url);
};

export const docsImageFetcher: ImageFetcher = async (url) => {
  const resolved = resolveImageUrl(url);
  const res = await fetch(resolved, { credentials: 'include' });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${res.statusText}`);
  return res.blob();
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.style.display = 'none';
    let settled = false;
    input.onchange = () => { settled = true; const f = input.files?.[0] ?? null; cleanup(); resolve(f); };
    const onFocus = () => { window.removeEventListener('focus', onFocus); setTimeout(() => { if (!settled) { cleanup(); resolve(null); } }, 300); };
    window.addEventListener('focus', onFocus);
    const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };
    document.body.appendChild(input);
    input.click();
  });
}

export function safeFilename(title: string, ext: 'docx' | 'pdf'): string {
  const safe = (title || 'document').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return safe.toLowerCase().endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
}
```

- [ ] **7.1.2** Refactor `docx-actions.ts` to import from `export-utils.ts`:

```ts
// docx-actions.ts (replace duplicate code with imports)
import {
  docsImageUploader, docsImageFetcher, downloadBlob, pickFile, safeFilename,
} from './export-utils';

export const docxImageUploader = docsImageUploader;   // back-compat alias
export const docxImageFetcher = docsImageFetcher;

export async function pickAndImportDocx() {
  const file = await pickFile('.docx');
  if (!file) return null;
  const buffer = await file.arrayBuffer();
  const doc = await DocxImporter.import(buffer, docsImageUploader);
  return { doc, fileName: file.name };
}

export async function exportDocxAndDownload(doc: DocsDocument, title: string): Promise<void> {
  const blob = await DocxExporter.export(doc, docsImageFetcher);
  downloadBlob(blob, safeFilename(title, 'docx'));
}
```

- [ ] **7.1.3** Run frontend tests:

```bash
pnpm --filter @wafflebase/frontend test -- --run
```
Expected: PASS.

- [ ] **7.1.4** Commit:

```bash
git add packages/frontend/src/app/docs/export-utils.ts packages/frontend/src/app/docs/docx-actions.ts
git commit -m "Extract shared export-utils from docx-actions"
```

---

### Task 7.2: pdf-actions with dynamic import

**Files:**
- Create: `packages/frontend/src/app/docs/pdf-actions.ts`

- [ ] **7.2.1** Create:

```ts
// packages/frontend/src/app/docs/pdf-actions.ts
import type { Document as DocsDocument } from '@wafflebase/docs';
import { docsImageFetcher, downloadBlob, safeFilename } from './export-utils';

export async function exportPdfAndDownload(
  doc: DocsDocument,
  title: string,
  metadata?: { title?: string; author?: string },
): Promise<void> {
  // Lazy: only loads pdf-lib + fontkit when the user actually exports
  const { PdfExporter } = await import('@wafflebase/docs/pdf-exporter');
  const blob = await PdfExporter.export(doc, {
    imageFetcher: docsImageFetcher,
    metadata: { title: metadata?.title ?? title, author: metadata?.author },
  });
  downloadBlob(blob, safeFilename(title, 'pdf'));
}
```

- [ ] **7.2.2** Add a sub-export to the docs package so the dynamic import works:

```jsonc
// packages/docs/package.json — add to "exports"
"./pdf-exporter": {
  "types": "./dist/wafflebase-document.es.d.ts",
  "import": "./dist/wafflebase-document.es.js",
  "default": "./dist/wafflebase-document.es.js"
}
```

(Or alternately export `PdfExporter` from the main index and accept that pdf-lib gets bundled — discuss tradeoff in task 7.5.)

- [ ] **7.2.3** Build the docs package and verify the new entry exists:

```bash
pnpm --filter @wafflebase/docs build
```

- [ ] **7.2.4** Commit:

```bash
git add packages/frontend/src/app/docs/pdf-actions.ts packages/docs/package.json
git commit -m "Add pdf-actions with dynamic import"
```

---

### Task 7.3: Export menu UI dropdown

**Files:**
- Modify: existing menu component in `packages/frontend/src/app/docs/` (locate via search at start of task)

- [ ] **7.3.1** Find the current "Export DOCX" trigger:

```bash
# Run via Grep tool, not Bash:
# pattern: exportDocxAndDownload, files in packages/frontend
```

- [ ] **7.3.2** Replace the single button with a dropdown (Radix `DropdownMenu` if already in the project, else a simple `<details>`/`<button>` group):

```tsx
<DropdownMenu>
  <DropdownMenuTrigger>Export ▾</DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => exportDocxAndDownload(doc, title)}>
      Word (.docx)
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => exportPdfAndDownload(doc, title)}>
      PDF (.pdf)
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

- [ ] **7.3.3** Run dev server, manually verify the menu opens and both export paths work:

```bash
pnpm dev
# Open http://localhost:5173, create a doc, click Export → PDF.
# Open the resulting .pdf in macOS Preview and verify text renders.
```

- [ ] **7.3.4** Run frontend tests:

```bash
pnpm --filter @wafflebase/frontend test -- --run
```

- [ ] **7.3.5** Commit:

```bash
git add packages/frontend/src/app/docs/<menu-file>.tsx
git commit -m "Add PDF item to Docs export dropdown"
```

---

### Task 7.4: Public re-exports + verify:fast

**Files:**
- Modify: `packages/docs/src/index.ts`

- [ ] **7.4.1** Add re-exports to `packages/docs/src/index.ts`:

```ts
export { PdfExporter } from './export/pdf-exporter.js';
export type { PdfExportOptions } from './export/pdf-exporter.js';
export { PdfFonts } from './export/pdf-fonts.js';
export type { PdfFontKey, FontUsage } from './export/pdf-fonts.js';
```

- [ ] **7.4.2** Run the project-wide pre-commit gate:

```bash
pnpm verify:fast
```
Expected: lint + all unit tests PASS.

- [ ] **7.4.3** Commit:

```bash
git add packages/docs/src/index.ts
git commit -m "Re-export PdfExporter from docs package index"
```

---

### Task 7.5: Manual verification + docs

- [ ] **7.5.1** Run the manual verification checklist (record results in the lessons file):
  - [ ] Adobe Reader: Korean renders correctly
  - [ ] macOS Preview: Korean renders correctly
  - [ ] Cmd+C / Cmd+V: produces real Unicode
  - [ ] Cmd+F search finds Korean and Latin
  - [ ] Hyperlink click opens browser
  - [ ] Outline panel shows headings
  - [ ] Print preview pagination matches on-screen
  - [ ] 30-page mixed document exports under 5s

- [ ] **7.5.2** If the design doc needs updates (any deviations from the spec discovered during implementation), edit `docs/design/docs/docs-pdf-export.md` to match what was actually built.

- [ ] **7.5.3** Run `pnpm verify:fast` once more to confirm everything still passes.

- [ ] **7.5.4** Update the active task index:

```bash
pnpm tasks:index
```

- [ ] **7.5.5** Archive when done:

```bash
pnpm tasks:archive   # moves todo + lessons to docs/tasks/archive/
pnpm tasks:index
```

- [ ] **7.5.6** Final commit:

```bash
git add docs/design/docs/docs-pdf-export.md docs/tasks/
git commit -m "Finalize PDF export — lessons + archive task"
```

---

## Verification

After completing all phases, verify:

1. `pnpm verify:fast` passes
2. `pnpm verify:self` passes (lint + builds)
3. Manual checklist (Task 7.5.1) all checked
4. The docs package builds: `pnpm --filter @wafflebase/docs build`
5. Frontend bundle size delta is acceptable (< +50 KB initial, ~200 KB lazy on Export → PDF click)

## Risks During Execution

- **Layout/pagination API shape mismatches** (Phase 2/3) — `LayoutRun.x`, `pl.line.baseline`, ascent/descent, header/footer adapter. Read the source before implementing each step; record actual shapes in the lessons file.
- **Italic Korean skew** (Task 2.5) — visual correctness needs eyeball verification; automated test only checks "is bytes-different".
- **Font CDN URLs** (Task 1.4) — the placeholder URLs WILL drift; verify before commit. Consider self-hosting Noto KR in `packages/docs/public/fonts/` as a follow-up.
- **Test font fixture** (Task 1.2) — if Google Fonts URL changes shape, fall back to a manually subsetted font.
- **Row split clipping** (Task 4.5) — pdf-lib graphics clip is ergonomically rough; pushOperators may be needed.
- **Outline destination references** (Task 6.2) — page refs must exist before assigning to the catalog; ensure all pages are added before `addOutlineFromHeadings` is called.
