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
});
