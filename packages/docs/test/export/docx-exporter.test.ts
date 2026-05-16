// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { DocxExporter } from '../../src/export/docx-exporter.js';
import { DocxImporter } from '../../src/import/docx-importer.js';
import type { Document } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '../../src/model/types.js';

// jsdom's Blob shim lacks arrayBuffer(); polyfill via FileReader.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Blob.prototype as any).arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

describe('DocxExporter', () => {
  it('should export a simple paragraph and re-import it', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'Hello World', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const blob = await DocxExporter.export(doc);
    expect(blob.size).toBeGreaterThan(0);

    // Re-import and verify round-trip
    const buffer = await blob.arrayBuffer();
    const reimported = await DocxImporter.import(buffer);
    expect(reimported.blocks).toHaveLength(1);
    expect(reimported.blocks[0].inlines[0].text).toBe('Hello World');
  });

  it('should export styled text', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: 'Normal ', style: {} },
          { text: 'Bold', style: { bold: true } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const buffer = await blob.arrayBuffer();
    const reimported = await DocxImporter.import(buffer);
    expect(reimported.blocks[0].inlines).toHaveLength(2);
    expect(reimported.blocks[0].inlines[1].style.bold).toBe(true);
  });

  it('should export a table', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'table',
        inlines: [],
        style: { ...DEFAULT_BLOCK_STYLE },
        tableData: {
          rows: [{
            cells: [
              { blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: 'A1', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], style: {} },
              { blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: 'B1', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], style: {} },
            ],
          }],
          columnWidths: [0.5, 0.5],
        },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const buffer = await blob.arrayBuffer();
    const reimported = await DocxImporter.import(buffer);
    expect(reimported.blocks[0].type).toBe('table');
    expect(reimported.blocks[0].tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('A1');
  });

  it('should skip horizontal merge placeholder cells (no extra w:tc with w:vMerge)', async () => {
    // Owner with colSpan=2 covers the next grid column; the placeholder
    // at cell index 1 must NOT round-trip as a stray vMerge continuation,
    // because that would push the trailing real cell off the grid.
    const cell = (text: string, colSpan?: number) => ({
      blocks: [{ id: generateBlockId(), type: 'paragraph' as const, inlines: [{ text, style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
      style: {},
      ...(colSpan !== undefined ? { colSpan } : {}),
    });
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'table',
        inlines: [],
        style: { ...DEFAULT_BLOCK_STYLE },
        tableData: {
          rows: [{
            cells: [cell('AB', 2), cell('', 0), cell('C')],
          }],
          columnWidths: [1 / 3, 1 / 3, 1 / 3],
        },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const docXml = await zip.file('word/document.xml')!.async('string');
    // The single row must contain exactly two <w:tc> elements (owner + C),
    // not three with a spurious <w:vMerge/>.
    const tcCount = (docXml.match(/<w:tc[ >]/g) ?? []).length;
    expect(tcCount).toBe(2);
    expect(docXml).not.toContain('<w:vMerge/>');

    const reimported = await DocxImporter.import(await blob.arrayBuffer());
    const cells = reimported.blocks[0].tableData!.rows[0].cells;
    expect(cells).toHaveLength(3);
    expect(cells[0].colSpan).toBe(2);
    expect(cells[1].colSpan).toBe(0);
    expect(cells[2].blocks[0].inlines[0].text).toBe('C');
  });

  it('should round-trip vertical merge with w:vMerge restart/continue', async () => {
    const cell = (text: string, opts: { colSpan?: number; rowSpan?: number } = {}) => ({
      blocks: [{ id: generateBlockId(), type: 'paragraph' as const, inlines: [{ text, style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
      style: {},
      ...(opts.colSpan !== undefined ? { colSpan: opts.colSpan } : {}),
      ...(opts.rowSpan !== undefined ? { rowSpan: opts.rowSpan } : {}),
    });
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'table',
        inlines: [],
        style: { ...DEFAULT_BLOCK_STYLE },
        tableData: {
          rows: [
            { cells: [cell('A', { rowSpan: 2 }), cell('B1')] },
            { cells: [cell('', { colSpan: 0 }), cell('B2')] },
          ],
          columnWidths: [0.5, 0.5],
        },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const docXml = await (await (await import('jszip')).default.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(docXml).toContain('w:vMerge w:val="restart"');
    expect(docXml).toMatch(/<w:vMerge\/>/);

    const reimported = await DocxImporter.import(await blob.arrayBuffer());
    const rows = reimported.blocks[0].tableData!.rows;
    expect(rows[0].cells[0].rowSpan).toBe(2);
    expect(rows[1].cells[0].colSpan).toBe(0);
    expect(rows[1].cells[1].blocks[0].inlines[0].text).toBe('B2');
  });

  it('should emit gridBefore for leading placeholders with no vMerge owner above', async () => {
    // Leading covered cell in the first row cannot be a vMerge continue
    // (no row above), so it must round-trip as <w:gridBefore w:val="1"/>
    // rather than a stray <w:vMerge/> tc.
    const cell = (text: string, colSpan?: number) => ({
      blocks: [{ id: generateBlockId(), type: 'paragraph' as const, inlines: [{ text, style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
      style: {},
      ...(colSpan !== undefined ? { colSpan } : {}),
    });
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'table',
        inlines: [],
        style: { ...DEFAULT_BLOCK_STYLE },
        tableData: {
          rows: [{
            cells: [cell('', 0), cell('B')],
          }],
          columnWidths: [0.5, 0.5],
        },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const docXml = await (await (await import('jszip')).default.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(docXml).toContain('<w:gridBefore w:val="1"/>');
    expect(docXml).not.toContain('<w:vMerge/>');

    const reimported = await DocxImporter.import(await blob.arrayBuffer());
    const cells = reimported.blocks[0].tableData!.rows[0].cells;
    expect(cells).toHaveLength(2);
    expect(cells[0].colSpan).toBe(0);
    expect(cells[1].blocks[0].inlines[0].text).toBe('B');
  });

  it('should emit gridAfter for trailing placeholders with no vMerge owner above', async () => {
    const cell = (text: string, colSpan?: number) => ({
      blocks: [{ id: generateBlockId(), type: 'paragraph' as const, inlines: [{ text, style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
      style: {},
      ...(colSpan !== undefined ? { colSpan } : {}),
    });
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'table',
        inlines: [],
        style: { ...DEFAULT_BLOCK_STYLE },
        tableData: {
          rows: [{
            cells: [cell('A'), cell('', 0)],
          }],
          columnWidths: [0.5, 0.5],
        },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const docXml = await (await (await import('jszip')).default.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(docXml).toContain('<w:gridAfter w:val="1"/>');
    expect(docXml).not.toContain('<w:vMerge/>');

    const reimported = await DocxImporter.import(await blob.arrayBuffer());
    const cells = reimported.blocks[0].tableData!.rows[0].cells;
    expect(cells).toHaveLength(2);
    expect(cells[0].blocks[0].inlines[0].text).toBe('A');
    expect(cells[1].colSpan).toBe(0);
  });

  it('should produce a valid .docx zip', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'Test', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('_rels/.rels')).not.toBeNull();
  });

  it('should throw when image inline has no matching media entry (no imageFetcher)', async () => {
    // Issue 1: When a document contains an image inline but no imageFetcher is
    // provided (so no media entries are collected), the exporter must throw a
    // descriptive error rather than silently falling through to a text run.
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: '\uFFFC', style: { image: { src: 'https://example.com/photo.jpg', width: 100, height: 80 } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    await expect(DocxExporter.export(doc)).rejects.toThrow(
      'DOCX export: image inline references https://example.com/photo.jpg but no matching media entry was collected.',
    );
  });

  it('should derive media extension from blob MIME type, not URL', async () => {
    // Issue 2: Extension must come from blob.type so that JPEG bytes served
    // under a .png URL (or an extensionless URL) are packaged correctly.
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          // URL has no extension — previously would fall back to 'png'
          { text: '\uFFFC', style: { image: { src: 'https://cdn.example.com/images/abcdef', width: 100, height: 80 } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    // Return a JPEG blob despite the URL having no extension
    const fetcher = async (_url: string): Promise<Blob> =>
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

    const blob = await DocxExporter.export(doc, fetcher);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    // The media file should be stored as .jpg, not .png or 'abcdef'
    const mediaFiles: string[] = [];
    zip.forEach((path, entry) => {
      if (path.startsWith('word/media/') && !entry.dir) mediaFiles.push(path);
    });
    expect(mediaFiles).toHaveLength(1);
    expect(mediaFiles[0]).toMatch(/\.jpg$/);
  });

  it('should package header/footer images with part-scoped rels', async () => {
    // Header/footer blocks with image inlines must be accompanied by
    // media files in the zip AND their own part-scoped .rels files
    // (word/_rels/header1.xml.rels, word/_rels/footer1.xml.rels).
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'Body', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
      header: {
        blocks: [{
          id: generateBlockId(),
          type: 'paragraph',
          inlines: [
            { text: '\uFFFC', style: { image: { src: 'https://example.com/logo.png', width: 80, height: 20 } } },
          ],
          style: { ...DEFAULT_BLOCK_STYLE },
        }],
        marginFromEdge: 48,
      },
      footer: {
        blocks: [{
          id: generateBlockId(),
          type: 'paragraph',
          inlines: [
            { text: '\uFFFC', style: { image: { src: 'https://example.com/stamp.png', width: 40, height: 40 } } },
          ],
          style: { ...DEFAULT_BLOCK_STYLE },
        }],
        marginFromEdge: 48,
      },
    };

    const fetches: string[] = [];
    const fakeFetcher = async (url: string): Promise<Blob> => {
      fetches.push(url);
      return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    };

    const blob = await DocxExporter.export(doc, fakeFetcher);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    // Both header and footer images should be fetched and packaged.
    expect(fetches).toContain('https://example.com/logo.png');
    expect(fetches).toContain('https://example.com/stamp.png');

    // Header and footer rels files must exist and reference image relationships.
    const headerRels = await zip.file('word/_rels/header1.xml.rels')?.async('string');
    const footerRels = await zip.file('word/_rels/footer1.xml.rels')?.async('string');
    expect(headerRels).toBeDefined();
    expect(footerRels).toBeDefined();
    expect(headerRels!).toContain('relationships/image');
    expect(footerRels!).toContain('relationships/image');

    // Header xml should reference the image via a:blip r:embed.
    const headerXml = await zip.file('word/header1.xml')?.async('string');
    const footerXml = await zip.file('word/footer1.xml')?.async('string');
    expect(headerXml!).toContain('a:blip');
    expect(footerXml!).toContain('a:blip');

    // Media files from header and footer should not collide in word/media/.
    const mediaFiles: string[] = [];
    zip.forEach((path, entry) => {
      if (path.startsWith('word/media/') && !entry.dir) {
        mediaFiles.push(path);
      }
    });
    expect(mediaFiles.length).toBe(2);
    expect(new Set(mediaFiles).size).toBe(2);
  });
});
