import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  type Block,
  type Document,
} from '@wafflebase/docs';
import { exportPdf } from '../src/docs/pdf-export.js';
import { exportDocx } from '../src/docs/docx-export.js';
import { writeBinary, type BinaryIO } from '../src/output/binary.js';
import { parsePageRange } from '../src/docs/page-range.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KR_FONT = readFileSync(
  resolve(__dirname, '../../docs/test/export/fixtures/fonts/test-cjk.ttf'),
);
const KR_FONT_BUFFER: ArrayBuffer = KR_FONT.buffer.slice(
  KR_FONT.byteOffset,
  KR_FONT.byteOffset + KR_FONT.byteLength,
) as ArrayBuffer;

function paragraph(id: string, text: string, style: { fontFamily?: string } = {}): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

/** PDF starts with the bytes `%PDF-` (0x25 0x50 0x44 0x46 0x2D). */
function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** DOCX is a ZIP file — starts with `PK\x03\x04`. */
function looksLikeDocx(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  );
}

/**
 * Stub `PdfFonts` sources backed by the bundled test CJK font. Used to
 * keep `exportPdf` offline — the real `PdfFonts` would otherwise reach
 * jsdelivr for Korean variants.
 */
const FONT_SOURCES = {
  'kr-sans-regular': () => Promise.resolve(KR_FONT_BUFFER),
  'kr-sans-bold': () => Promise.resolve(KR_FONT_BUFFER),
  'kr-serif-regular': () => Promise.resolve(KR_FONT_BUFFER),
  'kr-serif-bold': () => Promise.resolve(KR_FONT_BUFFER),
};

describe('exportPdf', () => {
  it('produces a PDF with a %PDF- header for an ASCII document', async () => {
    const doc: Document = { blocks: [paragraph('p1', 'Hello world.')] };
    const bytes = await exportPdf(doc);
    expect(looksLikePdf(bytes)).toBe(true);
  }, 20000);

  it('round-trips through pdf-lib (page count > 0)', async () => {
    const doc: Document = { blocks: [paragraph('p1', 'Hello world.')] };
    const bytes = await exportPdf(doc);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  }, 20000);

  it('embeds Korean text using the supplied font sources (no network)', async () => {
    const doc: Document = {
      blocks: [paragraph('p1', '안녕하세요')],
    };
    const bytes = await exportPdf(doc, { fontSources: FONT_SOURCES });
    expect(looksLikePdf(bytes)).toBe(true);
  }, 20000);

  it('extracts only the requested pages when --pages is supplied', async () => {
    // Build a doc large enough that pagination produces multiple pages
    // even with the FontkitMeasurer fallback.
    const blocks: Block[] = [];
    for (let i = 0; i < 30; i++) {
      blocks.push(paragraph(`p${i}`, 'lorem '.repeat(40).trim()));
    }
    const doc: Document = { blocks, pageSetup: { ...DEFAULT_PAGE_SETUP } };

    const fullBytes = await exportPdf(doc);
    const fullPdf = await PDFDocument.load(fullBytes);
    const fullCount = fullPdf.getPageCount();
    expect(fullCount).toBeGreaterThan(1);

    const range = parsePageRange('1', fullCount);
    const slicedBytes = await exportPdf(doc, { pages: range });
    const slicedPdf = await PDFDocument.load(slicedBytes);
    expect(slicedPdf.getPageCount()).toBe(1);
  }, 30000);
});

describe('exportDocx', () => {
  it('produces a DOCX (ZIP) with a PK header', async () => {
    const doc: Document = { blocks: [paragraph('p1', 'Hello world.')] };
    const bytes = await exportDocx(doc);
    expect(looksLikeDocx(bytes)).toBe(true);
  });

  it('returns a non-empty buffer', async () => {
    const doc: Document = { blocks: [paragraph('p1', 'Hello.')] };
    const bytes = await exportDocx(doc);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe('writeBinary', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfb-binary-'));
  });

  interface Capture {
    io: BinaryIO;
    stdoutCalls: number;
    stderrLines: string[];
    files: Record<string, Uint8Array>;
  }

  function captureIO(): Capture {
    const cap: Capture = {
      stdoutCalls: 0,
      stderrLines: [],
      files: {},
      io: undefined as unknown as BinaryIO,
    };
    cap.io = {
      stdout: () => {
        cap.stdoutCalls++;
      },
      stderr: (line) => {
        cap.stderrLines.push(line);
      },
      writeFile: (path, bytes) => {
        cap.files[path] = bytes;
      },
    };
    return cap;
  }

  it('writes to file via the IO surface', () => {
    const cap = captureIO();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const target = join(dir, 'out.bin');

    writeBinary(bytes, target, {}, cap.io);

    expect(cap.files[target]).toEqual(bytes);
    expect(cap.stdoutCalls).toBe(0);
  });

  it('routes "-" to stdout', () => {
    const cap = captureIO();
    const bytes = new Uint8Array([1, 2, 3]);

    writeBinary(bytes, '-', {}, cap.io);

    expect(cap.stdoutCalls).toBe(1);
    expect(Object.keys(cap.files)).toEqual([]);
  });

  it('reports the byte count to stderr unless quiet', () => {
    const cap = captureIO();
    writeBinary(new Uint8Array([1, 2, 3]), join(dir, 'a.bin'), {}, cap.io);
    expect(cap.stderrLines.some((l) => /Wrote 3 bytes/.test(l))).toBe(true);
  });

  it('skips the stderr report when quiet', () => {
    const cap = captureIO();
    writeBinary(new Uint8Array([1, 2, 3]), join(dir, 'a.bin'), { quiet: true }, cap.io);
    expect(cap.stderrLines).toEqual([]);
  });

  it('default IO refuses to overwrite without force', () => {
    const target = join(dir, 'existing.bin');
    writeFileSync(target, 'old', 'utf-8');
    expect(() => writeBinary(new Uint8Array([1, 2, 3]), target)).toThrow(
      /Refusing to overwrite/,
    );
    expect(readFileSync(target, 'utf-8')).toBe('old');
  });

  it('default IO overwrites with force', () => {
    const target = join(dir, 'existing.bin');
    writeFileSync(target, 'old', 'utf-8');
    writeBinary(new Uint8Array([9, 9, 9]), target, { force: true, quiet: true });
    expect(readFileSync(target)).toEqual(Buffer.from([9, 9, 9]));
  });

  it('default IO writes a fresh file when target does not exist', () => {
    const target = join(dir, 'fresh.bin');
    expect(existsSync(target)).toBe(false);
    writeBinary(new Uint8Array([1, 2, 3]), target, { quiet: true });
    expect(readFileSync(target)).toEqual(Buffer.from([1, 2, 3]));
  });
});
