// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { DocxImporter } from '../../src/import/docx-importer.js';
import JSZip from 'jszip';

/**
 * Helper to create a minimal .docx zip in memory.
 */
async function createMinimalDocx(bodyXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <w:body>${bodyXml}</w:body>
    </w:document>`;
  zip.file('word/document.xml', docXml);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    </Relationships>`);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    </Types>`);
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
