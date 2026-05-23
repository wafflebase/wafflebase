// @vitest-environment jsdom

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { getWorksheetCell } from '../../src';
import {
  importXlsxFile,
  importXlsxWorkbook,
} from '../../src/import/xlsx-importer';

async function buildWorkbook(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Budget" sheetId="1" r:id="rId1"/>
        <sheet name="Ops" sheetId="2" r:id="rId2"/>
      </sheets>
    </workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/>
    </Relationships>`,
  );
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <si><t>Item</t></si>
      <si><r><t>North</t></r><r><t> Team</t></r></si>
    </sst>`,
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
          <c r="B1" t="s"><v>1</v></c>
        </row>
        <row r="2">
          <c r="A2"><v>42</v></c>
          <c r="B2" t="b"><v>1</v></c>
          <c r="C2" t="str"><f>SUM(A2:A2)</f><v>42</v></c>
        </row>
        <row r="3">
          <c r="A3" t="inlineStr"><is><t>Inline</t></is></c>
          <c r="B3" t="e"><v>#DIV/0!</v></c>
        </row>
      </sheetData>
      <mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>
    </worksheet>`,
  );
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>Second sheet</t></is></c></row>
      </sheetData>
    </worksheet>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

describe('importXlsxWorkbook', () => {
  it('converts workbook sheets into Wafflebase worksheets', async () => {
    const sheets = await importXlsxWorkbook(await buildWorkbook());

    expect(sheets).toHaveLength(2);
    expect(sheets[0].name).toBe('Budget');
    expect(sheets[0].cellCount).toBe(7);
    expect(sheets[0].rowCount).toBe(3);
    expect(sheets[0].columnCount).toBe(3);
    expect(getWorksheetCell(sheets[0].worksheet, { r: 1, c: 1 })?.v).toBe(
      'Item',
    );
    expect(getWorksheetCell(sheets[0].worksheet, { r: 1, c: 2 })?.v).toBe(
      'North Team',
    );
    expect(getWorksheetCell(sheets[0].worksheet, { r: 2, c: 1 })?.v).toBe('42');
    expect(getWorksheetCell(sheets[0].worksheet, { r: 2, c: 2 })?.v).toBe(
      'TRUE',
    );
    expect(getWorksheetCell(sheets[0].worksheet, { r: 2, c: 3 })).toEqual({
      f: '=SUM(A2:A2)',
      v: '42',
    });
    expect(getWorksheetCell(sheets[0].worksheet, { r: 3, c: 1 })?.v).toBe(
      'Inline',
    );
    expect(getWorksheetCell(sheets[0].worksheet, { r: 3, c: 2 })?.v).toBe(
      '#DIV/0!',
    );
    expect(sheets[0].worksheet.merges?.A1).toEqual({ rs: 1, cs: 2 });
    expect(getWorksheetCell(sheets[1].worksheet, { r: 1, c: 1 })?.v).toBe(
      'Second sheet',
    );
  });

  it('reads browser File-like objects', async () => {
    const workbook = await buildWorkbook();
    const file = {
      arrayBuffer: async () => workbook,
    };
    const sheets = await importXlsxFile(file);

    expect(sheets.map((sheet) => sheet.name).join(',')).toBe('Budget,Ops');
  });

  it('rejects archives without workbook metadata', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', '<worksheet/>');
    const workbook = await zip.generateAsync({ type: 'uint8array' });

    await expect(importXlsxWorkbook(workbook)).rejects.toThrow(
      /missing workbook metadata/,
    );
  });
});
