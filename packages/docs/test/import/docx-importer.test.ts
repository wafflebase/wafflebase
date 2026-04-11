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

  it('should derive column widths from the outer tblGrid ratios', async () => {
    // Outer table: 3 cols with widths 1000/2000/3000 (1/6, 2/6, 3/6 of total).
    const buffer = await createMinimalDocx(`
      <w:tbl>
        <w:tblGrid>
          <w:gridCol w:w="1000"/>
          <w:gridCol w:w="2000"/>
          <w:gridCol w:w="3000"/>
        </w:tblGrid>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `);
    const doc = await DocxImporter.import(buffer);
    const td = doc.blocks[0].tableData!;
    expect(td.columnWidths).toHaveLength(3);
    expect(td.columnWidths[0]).toBeCloseTo(1 / 6, 5);
    expect(td.columnWidths[1]).toBeCloseTo(2 / 6, 5);
    expect(td.columnWidths[2]).toBeCloseTo(3 / 6, 5);
  });

  it('should ignore gridCol elements from nested tables when computing outer widths', async () => {
    // Regression for v0.3.2: getElementsByTagNameNS('gridCol') is recursive
    // and would pick up the nested 5-col grid, collapsing the outer 1-col
    // table to ~1/6 of its width. The row walk already uses direct-child
    // traversal so the real-world form.docx "별첨 인적사항" tables became
    // ~8%-wide strips on later pages. The outer columnWidths must come
    // from the outer tblGrid alone.
    const buffer = await createMinimalDocx(`
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid>
        <w:tr>
          <w:tc>
            <w:tbl>
              <w:tblGrid>
                <w:gridCol w:w="1800"/>
                <w:gridCol w:w="1800"/>
                <w:gridCol w:w="1800"/>
                <w:gridCol w:w="1800"/>
                <w:gridCol w:w="1800"/>
              </w:tblGrid>
              <w:tr>
                <w:tc><w:p><w:r><w:t>n1</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>n2</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>n3</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>n4</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>n5</w:t></w:r></w:p></w:tc>
              </w:tr>
            </w:tbl>
          </w:tc>
        </w:tr>
      </w:tbl>
    `);
    const doc = await DocxImporter.import(buffer);
    const td = doc.blocks[0].tableData!;
    // Outer table: a single column, rendered at the full content width.
    expect(td.columnWidths).toEqual([1]);
    // And the outer table still has exactly one row with one cell, because
    // the nested row walk is also direct-child only.
    expect(td.rows).toHaveLength(1);
    expect(td.rows[0].cells).toHaveLength(1);
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

  it('should drop pending image inlines when no uploader is supplied', async () => {
    // Parser inserts a pending placeholder for every <w:drawing>. Without
    // an uploader, convertParagraph must drop it instead of leaving an
    // `__pending__:*` src in the final document.
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
    const buffer = await createMinimalDocx(
      `<w:p>${drawingXml}<w:r><w:t>Fallback</w:t></w:r></w:p>`,
    );
    // Intentionally omit the imageUploader argument.
    const doc = await DocxImporter.import(buffer);
    for (const inline of doc.blocks[0].inlines) {
      expect(inline.style.image?.src?.startsWith('__pending__')).toBeFalsy();
    }
    const allText = doc.blocks[0].inlines.map((i) => i.text).join('');
    expect(allText).toContain('Fallback');
  });

  it('should pick the default header referenced from sectPr, not first rel', async () => {
    // Two header relationships exist in the rels map; only header2 is
    // referenced from the sectPr as the default. The importer must pick
    // header2 rather than the first rel in iteration order.
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
        <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
      </Relationships>`;
    const header1Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:p><w:r><w:t>First header (unused)</w:t></w:r></w:p>
      </w:hdr>`;
    const header2Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:p><w:r><w:t>Active header</w:t></w:r></w:p>
      </w:hdr>`;
    const buffer = await createMinimalDocx(
      `<w:p><w:r><w:t>Body</w:t></w:r></w:p>
       <w:sectPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
         <w:headerReference w:type="default" r:id="rId11"/>
         <w:pgSz w:w="11906" w:h="16838"/>
         <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/>
       </w:sectPr>`,
      {
        relsXml,
        extraFiles: {
          'word/header1.xml': header1Xml,
          'word/header2.xml': header2Xml,
        },
      },
    );
    const doc = await DocxImporter.import(buffer);
    expect(doc.header).toBeDefined();
    const headerText = doc.header!.blocks
      .map((b) => b.inlines.map((i) => i.text).join(''))
      .join('');
    expect(headerText).toBe('Active header');
  });

  it('should upload images referenced only from a header .rels file', async () => {
    // Image rId "rId3" belongs to header1.xml.rels and has no counterpart
    // in document.xml.rels. Without per-part rels walking, the header
    // image would resolve to a __pending__:* src. With the fix, the
    // uploader is called with the header-local image.
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
      </Relationships>`;
    const header1Rels = `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/header-image.png"/>
      </Relationships>`;
    const header1Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <w:p>
          <w:r>
            <w:drawing>
              <wp:inline>
                <wp:extent cx="914400" cy="457200"/>
                <wp:docPr id="1" name="Picture 1"/>
                <a:graphic>
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:pic>
                      <pic:blipFill><a:blip r:embed="rId3"/></pic:blipFill>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>
      </w:hdr>`;
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const buffer = await createMinimalDocx(
      `<w:p><w:r><w:t>Body</w:t></w:r></w:p>
       <w:sectPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
         <w:headerReference w:type="default" r:id="rId20"/>
         <w:pgSz w:w="11906" w:h="16838"/>
         <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/>
       </w:sectPr>`,
      {
        relsXml,
        extraFiles: {
          'word/header1.xml': header1Xml,
          'word/_rels/header1.xml.rels': header1Rels,
          'word/media/header-image.png': pngBytes,
        },
      },
    );
    const uploaded: string[] = [];
    const doc = await DocxImporter.import(buffer, async (_blob, filename) => {
      uploaded.push(filename);
      return `https://example.com/${filename}`;
    });
    expect(uploaded.length).toBe(1);
    expect(doc.header).toBeDefined();
    const headerBlock = doc.header!.blocks[0];
    const headerInline = headerBlock.inlines.find((i) => !!i.style.image);
    expect(headerInline).toBeDefined();
    expect(headerInline!.style.image!.src).toContain('https://example.com/');
    expect(headerInline!.style.image!.src.startsWith('__pending__')).toBe(false);
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
