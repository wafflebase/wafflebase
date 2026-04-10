// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { DocxImporter } from '../../src/import/docx-importer.js';
import JSZip from 'jszip';

interface DocxOptions {
  relsXml?: string;
  extraFiles?: Record<string, Uint8Array | string>;
}

/**
 * Helper to create a minimal .docx zip in memory.
 */
async function createMinimalDocx(
  bodyXml: string,
  options: DocxOptions = {},
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <w:body>${bodyXml}</w:body>
    </w:document>`;
  zip.file('word/document.xml', docXml);
  zip.file(
    'word/_rels/document.xml.rels',
    options.relsXml ??
      `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    </Relationships>`,
  );
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="png" ContentType="image/png"/>
    </Types>`);
  if (options.extraFiles) {
    for (const [path, content] of Object.entries(options.extraFiles)) {
      zip.file(path, content);
    }
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('DocxImporter', () => {
  it('should import a simple paragraph', async () => {
    const buffer = await createMinimalDocx(`
      <w:p><w:r><w:t>Hello World</w:t></w:r></w:p>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe('paragraph');
    expect(doc.blocks[0].inlines[0].text).toBe('Hello World');
  });

  it('should import multiple paragraphs', async () => {
    const buffer = await createMinimalDocx(`
      <w:p><w:r><w:t>First</w:t></w:r></w:p>
      <w:p><w:r><w:t>Second</w:t></w:r></w:p>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0].inlines[0].text).toBe('First');
    expect(doc.blocks[1].inlines[0].text).toBe('Second');
  });

  it('should import styled text runs', async () => {
    const buffer = await createMinimalDocx(`
      <w:p>
        <w:r><w:t>Normal </w:t></w:r>
        <w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>
      </w:p>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks[0].inlines).toHaveLength(2);
    expect(doc.blocks[0].inlines[1].style.bold).toBe(true);
  });

  it('should import a simple table', async () => {
    const buffer = await createMinimalDocx(`
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe('table');
    expect(doc.blocks[0].tableData!.rows).toHaveLength(2);
    expect(doc.blocks[0].tableData!.rows[0].cells).toHaveLength(2);
    expect(doc.blocks[0].tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('A1');
  });

  it('should import page setup from sectPr', async () => {
    const buffer = await createMinimalDocx(`
      <w:p><w:r><w:t>Content</w:t></w:r></w:p>
      <w:sectPr>
        <w:pgSz w:w="11906" w:h="16838"/>
        <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
      </w:sectPr>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.pageSetup).toBeDefined();
    expect(doc.pageSetup!.paperSize.width).toBeCloseTo(794, 0);
    expect(doc.pageSetup!.margins.top).toBeCloseTo(96, 0);
  });

  it('should import image with dimensions from w:drawing extent', async () => {
    // 1 inch x 0.5 inch in EMU (914400 EMU per inch). At 96 DPI → 96 x 48 CSS px.
    const drawingXml = `
      <w:r>
        <w:drawing>
          <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
            <wp:extent cx="914400" cy="457200"/>
            <wp:docPr id="1" name="Picture 1"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:blipFill>
                    <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId5"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>`;
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
      </Relationships>`;
    // Minimal 1x1 PNG bytes (transparent) — content doesn't matter for the test.
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const buffer = await createMinimalDocx(
      `<w:p>${drawingXml}</w:p>`,
      {
        relsXml,
        extraFiles: { 'word/media/image1.png': pngBytes },
      },
    );
    const doc = await DocxImporter.import(buffer, async () => 'https://example.com/image1.png');
    const inline = doc.blocks[0].inlines.find((i) => !!i.style.image);
    expect(inline).toBeDefined();
    expect(inline!.style.image!.src).toBe('https://example.com/image1.png');
    expect(inline!.style.image!.width).toBe(96);
    expect(inline!.style.image!.height).toBe(48);
  });

  it('should resolve stacked vMerge groups in the same column', async () => {
    // Column 0: rows 0-1 merged, row 2 standalone, rows 3-4 merged.
    const buffer = await createMinimalDocx(`
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>
        <w:tr>
          <w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Group1Top</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>R0C1</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>
          <w:tc><w:p><w:r><w:t>R1C1</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>Standalone</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>R2C1</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Group2Top</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>R3C1</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>
          <w:tc><w:p><w:r><w:t>R4C1</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `);
    const doc = await DocxImporter.import(buffer);
    const table = doc.blocks[0];
    expect(table.type).toBe('table');
    const rows = table.tableData!.rows;
    expect(rows).toHaveLength(5);

    // First group anchor at row 0, col 0 should have rowSpan 2.
    const group1Top = rows[0].cells[0];
    expect(group1Top.rowSpan).toBe(2);
    expect(group1Top.blocks[0].inlines[0].text).toBe('Group1Top');

    // Row 2 col 0 is a normal standalone cell, no rowSpan.
    expect(rows[2].cells[0].rowSpan).toBeUndefined();
    expect(rows[2].cells[0].blocks[0].inlines[0].text).toBe('Standalone');

    // Second group anchor at row 3, col 0 should have rowSpan 2.
    const group2Top = rows[3].cells[0];
    expect(group2Top.rowSpan).toBe(2);
    expect(group2Top.blocks[0].inlines[0].text).toBe('Group2Top');
  });

  it('should not duplicate content when flattening deeply nested tables', async () => {
    // Outer table with a nested table that itself contains another nested
    // table. The flattened outer cell should contain "DEEP" exactly once.
    const buffer = await createMinimalDocx(`
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid>
        <w:tr>
          <w:tc>
            <w:tbl>
              <w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>
              <w:tr>
                <w:tc>
                  <w:tbl>
                    <w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>
                    <w:tr><w:tc><w:p><w:r><w:t>DEEP</w:t></w:r></w:p></w:tc></w:tr>
                  </w:tbl>
                </w:tc>
              </w:tr>
            </w:tbl>
          </w:tc>
        </w:tr>
      </w:tbl>
    `);
    const doc = await DocxImporter.import(buffer);
    const table = doc.blocks[0];
    expect(table.type).toBe('table');
    const cellBlocks = table.tableData!.rows[0].cells[0].blocks;
    const allText = cellBlocks.map((b) => b.inlines.map((i) => i.text).join('')).join('\n');
    // "DEEP" should appear exactly once even though the inner flatten code
    // used to recurse via getElementsByTagNameNS.
    const occurrences = allText.split('DEEP').length - 1;
    expect(occurrences).toBe(1);
  });

  it('should flatten nested tables to text', async () => {
    const buffer = await createMinimalDocx(`
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid>
        <w:tr>
          <w:tc>
            <w:tbl>
              <w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>
              <w:tr><w:tc><w:p><w:r><w:t>Nested</w:t></w:r></w:p></w:tc></w:tr>
            </w:tbl>
          </w:tc>
        </w:tr>
      </w:tbl>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks[0].type).toBe('table');
    // Nested table is flattened — cell should contain a paragraph with "Nested"
    const cellBlocks = doc.blocks[0].tableData!.rows[0].cells[0].blocks;
    const allText = cellBlocks.map(b => b.inlines.map(i => i.text).join('')).join('');
    expect(allText).toContain('Nested');
  });
});
