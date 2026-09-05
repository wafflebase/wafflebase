// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DocxExporter } from '../../src/export/docx-exporter.js';
import { DocxImporter } from '../../src/import/docx-importer.js';
import type { Document } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '../../src/model/types.js';
import { setThemeMode } from '../../src/view/theme.js';

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

  it('should emit per-cell <w:tcW> widths matching the column ratios', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'table',
        inlines: [],
        style: { ...DEFAULT_BLOCK_STYLE },
        tableData: {
          rows: [{
            cells: [
              { blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: 'A', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], style: {} },
              { blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: 'B', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], style: {} },
            ],
          }],
          columnWidths: [0.25, 0.75],
        },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const docXml = await zip.file('word/document.xml')!.async('string');
    // totalTwips = 9000 → 0.25×9000 = 2250, 0.75×9000 = 6750.
    expect(docXml).toContain('<w:tcW w:w="2250" w:type="dxa"/>');
    expect(docXml).toContain('<w:tcW w:w="6750" w:type="dxa"/>');
  });

  it('normalizes a table cell background into w:shd and drops a hostile one', async () => {
    // `CellStyle.backgroundColor` is untrusted: the DOCX importer copies
    // `w:shd/@w:fill` verbatim and HTML paste copies browser CSS. Emitted
    // raw it both injects into document.xml and produces an invalid
    // ST_HexColor, so it goes through the same normalizer as run props.
    const cell = (text: string, backgroundColor?: string) => ({
      blocks: [{ id: generateBlockId(), type: 'paragraph' as const, inlines: [{ text, style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
      style: backgroundColor !== undefined ? { backgroundColor } : {},
    });
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'table',
        inlines: [],
        style: { ...DEFAULT_BLOCK_STYLE },
        tableData: {
          rows: [{
            cells: [
              cell('A', '#ff0000'),
              cell('B', 'a"/><w:b'),
              cell('C', 'rgb(0, 128, 255)'),
            ],
          }],
          columnWidths: [0.34, 0.33, 0.33],
        },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="FF0000"/>');
    expect(docXml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="0080FF"/>');
    // The hostile value must not reach the attribute in any form — raw
    // (attribute injection) or escaped (invalid ST_HexColor).
    expect(docXml).not.toContain('w:fill="a"/>');
    expect(docXml).not.toContain('a&quot;/&gt;&lt;w:b');
    expect(docXml.match(/<w:shd /g)!.length).toBe(2);
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

  it('should drop a failed image when the caller reports errors', async () => {
    // An image URL is document content and can be stale, unreachable, or
    // refused by the CLI's SSRF guard; the export is what the user asked for.
    // A caller that supplies a reporter has said so, and then the run is
    // omitted (no dangling r:embed) and the rest still exports.
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: 'before ', style: {} },
          { text: '￼', style: { image: { src: 'http://10.0.0.5/photo.jpg', width: 100, height: 80 } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const reported: Array<[string, string]> = [];
    const blob = await DocxExporter.export(
      doc,
      async () => {
        throw new Error('Refusing to fetch image from a non-public address');
      },
      undefined,
      (src, error) => reported.push([src, (error as Error).message]),
    );
    expect(reported).toEqual([
      ['http://10.0.0.5/photo.jpg', 'Refusing to fetch image from a non-public address'],
    ]);

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('before ');
    expect(documentXml).not.toContain('<w:drawing>');
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(rels).not.toContain('/image"');
  });

  it('should fail the export when a failed image is not opted into', async () => {
    // The browser exporter passes no reporter: there a failed fetch is a real
    // fault and the export UI reports the thrown error. Dropping the image
    // quietly would produce a .docx missing content the user can still see
    // on screen, with nothing to tell them why.
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: '￼', style: { image: { src: 'https://cdn.example.com/photo.jpg', width: 100, height: 80 } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        DocxExporter.export(doc, async () => {
          throw new Error('Image fetch failed: 404 Not Found');
        }),
      ).rejects.toThrow(/Image fetch failed: 404/);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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

  it('reports per-image progress ending at total', async () => {
    const PNG = new Blob(
      [Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII='
      ), (c) => c.charCodeAt(0))],
      { type: 'image/png' },
    );
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: '', style: { image: { src: 'a.png', width: 10, height: 10 } } },
          { text: '', style: { image: { src: 'b.png', width: 10, height: 10 } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };
    const calls: Array<[number, number, string]> = [];
    await DocxExporter.export(doc, async () => PNG, (d, t, p) => calls.push([d, t, p]));
    expect(calls[0]).toEqual([0, 2, 'images']);
    expect(calls[calls.length - 1]).toEqual([2, 2, 'images']);
    const dones = calls.map((c) => c[0]);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    expect(calls.every((c) => c[1] === 2 && c[2] === 'images')).toBe(true);
  });

  it('emits no progress when onProgress is given without an imageFetcher', async () => {
    // A doc with images but no fetcher still throws the existing guard. The
    // point of this test: we must NOT emit a misleading (0, N) beforehand —
    // that would briefly show a progress bar stuck at 0 before the error.
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: '', style: { image: { src: 'a.png', width: 10, height: 10 } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };
    const calls: Array<[number, number, string]> = [];
    await expect(
      DocxExporter.export(doc, undefined, (d, t, p) => calls.push([d, t, p])),
    ).rejects.toThrow(/imageFetcher/);
    expect(calls).toEqual([]);
  });

  it('emits no progress for an image-free document', async () => {
    // total would be 0; reporting (0, 0) then nothing is pointless noise, and
    // the toast layer would flash a descriptionless spinner. Emit nothing.
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'No images here', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };
    const calls: Array<[number, number, string]> = [];
    await DocxExporter.export(doc, async () => new Blob(), (d, t, p) =>
      calls.push([d, t, p]),
    );
    expect(calls).toEqual([[0, 0, 'images']]);
  });

  it('should export and re-import a table inside a header', async () => {
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
          type: 'table',
          inlines: [],
          style: { ...DEFAULT_BLOCK_STYLE },
          tableData: {
            rows: [{
              cells: [
                { blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: 'Left', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], style: {} },
                { blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: 'Right', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], style: {} },
              ],
            }],
            columnWidths: [0.5, 0.5],
          },
        }],
        marginFromEdge: 48,
      },
    };

    const blob = await DocxExporter.export(doc);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const headerXml = await zip.file('word/header1.xml')?.async('string');
    expect(headerXml!).toContain('<w:tbl>');
    // A header part must not end with a table; a trailing paragraph follows it.
    expect(headerXml!.trimEnd().endsWith('</w:hdr>')).toBe(true);
    expect(headerXml!).toMatch(/<\/w:tbl>\s*<w:p\/>/);

    const reimported = await DocxImporter.import(await blob.arrayBuffer());
    const tableBlock = reimported.header!.blocks.find((b) => b.type === 'table');
    expect(tableBlock).toBeDefined();
    expect(tableBlock!.tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('Left');
    expect(tableBlock!.tableData!.rows[0].cells[1].blocks[0].inlines[0].text).toBe('Right');
  });
});

// ---------------------------------------------------------------------------
// Unusable stored geometry
// ---------------------------------------------------------------------------
// `resolvePageSetup` is the model's single read path for a stored page setup,
// and the only place that sees geometry nobody validated. `EditorAPI.
// setPageSetup` guards the write it owns, but two paths never touch that
// write: a `.docx` import stores parsed geometry through `setDocument`, and a
// collaborator's CRDT write lands in `document.pageSetup` unchecked — where
// `YorkieDocStore.readPageSetup` turns a missing or non-numeric field into
// `NaN` via `Number(undefined)`. Reading `doc.pageSetup` raw here hands that
// NaN straight to the twips conversion and writes `w:w="NaN"` into
// `word/document.xml`, which is not a smaller page but an unopenable file.
describe('DocxExporter — unusable stored page setup', () => {
  const nanSetup = {
    // Exactly the shape `YorkieDocStore.readPageSetup` produces for a
    // `pageSetup` whose fields never made it into the CRDT.
    paperSize: { name: 'Letter', width: NaN, height: NaN },
    orientation: 'portrait' as const,
    margins: { top: NaN, bottom: NaN, left: NaN, right: NaN },
  };

  const docWith = (pageSetup: unknown): Document => ({
    blocks: [{
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [{ text: 'Hello', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pageSetup: pageSetup as any,
  });

  async function documentXml(doc: Document): Promise<string> {
    const blob = await DocxExporter.export(doc);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    return (await zip.file('word/document.xml')?.async('string'))!;
  }

  it('never writes NaN geometry into the section properties', async () => {
    const xml = await documentXml(docWith(nanSetup));
    expect(xml).not.toContain('NaN');
    // It falls back to the resolver's defaults rather than emitting nothing.
    expect(xml).toMatch(/<w:pgSz w:w="\d+" w:h="\d+"/);
    expect(xml).toMatch(/<w:pgMar w:top="\d+"/);
  });

  it('survives a page setup missing paperSize and margins entirely', async () => {
    const xml = await documentXml(docWith({ orientation: 'portrait' }));
    expect(xml).not.toContain('NaN');
    expect(xml).not.toContain('undefined');
    expect(xml).toMatch(/<w:pgSz w:w="\d+" w:h="\d+"/);
  });

  it('re-imports to a document a reader can open', async () => {
    const blob = await DocxExporter.export(docWith(nanSetup));
    const reimported = await DocxImporter.import(await blob.arrayBuffer());
    expect(reimported.blocks[0].inlines[0].text).toBe('Hello');
  });
});

describe('DocxExporter and the named-style greys', () => {
  afterEach(() => {
    setThemeMode('light');
  });

  // DOCX export serializes `block.inlines` raw and emits a `w:pStyle` for
  // headings — it never calls `resolveStyleInline`, so the catalog's greys
  // (light or dark) do not reach the file at all and Word applies its own
  // Heading N color. That is a pre-existing fidelity gap, unaffected by the
  // dark-surface work; this pins that the theme mode cannot leak into it.
  const heading3Doc = (): Document => ({
    blocks: [{
      id: generateBlockId(),
      type: 'heading',
      headingLevel: 3,
      inlines: [{ text: 'Heading three', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }],
  });

  it('carries no named-style color into the run, in either theme mode', async () => {
    setThemeMode('dark');
    const dark = await DocxImporter.import(await (await DocxExporter.export(heading3Doc())).arrayBuffer());
    setThemeMode('light');
    const light = await DocxImporter.import(await (await DocxExporter.export(heading3Doc())).arrayBuffer());

    for (const imported of [dark, light]) {
      const color = imported.blocks[0].inlines[0]?.style.color;
      expect(color).not.toBe('#B0B0B0');
      expect(color).not.toBe('#434343');
    }
    expect(dark.blocks[0].inlines[0]?.style.color)
      .toEqual(light.blocks[0].inlines[0]?.style.color);
  });
});

describe('DocxExporter and the contextual list rhythm', () => {
  // The editor's rule (`effectiveBlockSpacing` + `contextualListSpacing`) zeroes
  // the gap only *between adjacent* `list-item` blocks; the last bullet keeps
  // its 8 px against whatever follows the list.
  //
  // Word's rule is not "between bullets" — ECMA-376 §17.3.1.9 scopes
  // `<w:contextualSpacing/>` to paragraphs of the **same style**. Since this
  // exporter emits no `<w:pStyle>` for body paragraphs, every `<w:p>` in an
  // exported file used to be the default `Normal`, so the element also
  // suppressed the last bullet's space-after against the paragraph following
  // the list. 8 px on screen, 0 in Word — the two rules disagreed.
  //
  // These assert the export in the terms of Word's rule rather than ours: what
  // each paragraph's *effective style* is, and which pairs the element can
  // therefore reach.
  const doc = (): Document => ({
    blocks: [
      {
        id: generateBlockId(), type: 'paragraph',
        inlines: [{ text: 'Intro', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      },
      {
        id: generateBlockId(), type: 'list-item', listKind: 'unordered', listLevel: 0,
        inlines: [{ text: 'First', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      },
      {
        id: generateBlockId(), type: 'list-item', listKind: 'unordered', listLevel: 0,
        inlines: [{ text: 'Second', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      },
      {
        id: generateBlockId(), type: 'paragraph',
        inlines: [{ text: 'Outro', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      },
    ],
  });

  /** Each `<w:p>` as `{ style, contextual }` — Word's view of the body. */
  async function paragraphs(): Promise<Array<{ style: string; contextual: boolean }>> {
    const blob = await DocxExporter.export(doc());
    const zip = await (await import('jszip')).default.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    return [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((m) => ({
      // No `w:pStyle` means the default style, which `styles.xml` marks
      // `w:default="1"` on `Normal` — that fallback is the whole bug.
      style: /<w:pStyle w:val="([^"]*)"\/>/.exec(m[1])?.[1] ?? 'Normal',
      contextual: m[1].includes('<w:contextualSpacing/>'),
    }));
  }

  it('gives list items a style body paragraphs do not share', async () => {
    const ps = await paragraphs();
    expect(ps.map((p) => p.style)).toEqual([
      'Normal', 'ListParagraph', 'ListParagraph', 'Normal',
    ]);
    expect(ps.map((p) => p.contextual)).toEqual([false, true, true, false]);
  });

  it('never lets contextual spacing reach a paragraph outside the list', async () => {
    const ps = await paragraphs();
    // Word suppresses the gap between i and i+1 exactly when one of them
    // carries the element AND both resolve to the same style. Encode that and
    // compare against what the editor paints for the same four blocks.
    const suppressed = ps.slice(0, -1).map((p, i) => {
      const next = ps[i + 1];
      return (p.contextual || next.contextual) && p.style === next.style;
    });
    // paragraph|bullet: kept. bullet|bullet: suppressed. bullet|paragraph: kept.
    expect(suppressed).toEqual([false, true, false]);
  });

  it('still emits the space-after every paragraph carries', async () => {
    // The suppression above must come from the style scoping, not from the
    // exporter having dropped `w:after` on list items — otherwise the gap after
    // the list would be gone for a different reason.
    const blob = await DocxExporter.export(doc());
    const zip = await (await import('jszip')).default.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml.match(/w:after="120"/g)).toHaveLength(4);
  });

  it('defines ListParagraph in the package it references it from', async () => {
    // A dangling `w:pStyle` resolves to the default style, which would silently
    // put all four paragraphs back on `Normal` and restore the defect.
    const blob = await DocxExporter.export(doc());
    const zip = await (await import('jszip')).default.loadAsync(await blob.arrayBuffer());
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('w:styleId="ListParagraph"');
  });

  it('re-imports the list paragraphs as readable text', async () => {
    // `ListParagraph` must not be mistaken for a heading id by the importer's
    // `pStyle` matcher (`/^(?:Heading|heading)(\d)$/`, plus the bare-digit
    // Korean case), and the round-trip must not lose the text.
    const blob = await DocxExporter.export(doc());
    const reimported = await DocxImporter.import(await blob.arrayBuffer());
    expect(reimported.blocks.map((b) => b.inlines[0]?.text))
      .toEqual(['Intro', 'First', 'Second', 'Outro']);
    expect(reimported.blocks.every((b) => b.type !== 'heading')).toBe(true);
  });
});
