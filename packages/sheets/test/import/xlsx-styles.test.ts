// @vitest-environment jsdom

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { resolveRangeStyleAt } from '../../src/model/worksheet/range-styles';
import { getWorksheetCell } from '../../src';
import { importXlsxWorkbook } from '../../src/import/xlsx-importer';
import { mapNumberFormat } from '../../src/import/xlsx-styles';
import { excelSerialToDateString } from '../../src/import/xlsx-serial-date';

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
    <font><b/><color rgb="FFFF0000"/><name val="Arial"/></font>
    <font><u/><strike/><color theme="1"/><name val="Roboto"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor rgb="FFD9EAD3"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
    </border>
  </borders>
  <cellXfs count="5">
    <xf borderId="0" fillId="0" fontId="0" numFmtId="0"/>
    <xf borderId="0" fillId="2" fontId="1" numFmtId="0" applyFill="1" applyFont="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <xf borderId="1" fillId="0" fontId="2" numFmtId="0" applyBorder="1" applyFont="1"/>
    <xf borderId="0" fillId="0" fontId="0" numFmtId="9"/>
    <xf borderId="0" fillId="0" fontId="0" numFmtId="164" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

async function buildStyledWorkbook(sheetXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
       <sheets><sheet name="Styled" sheetId="1" r:id="rId1"/></sheets>
     </workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
       <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
     </Relationships>`,
  );
  zip.file('xl/styles.xml', STYLES_XML);
  zip.file('xl/worksheets/sheet1.xml', sheetXml);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('xlsx style import', () => {
  it('resolves fills, fonts, borders and alignment from the cell s index', async () => {
    const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" s="1"><v>1</v></c>
          <c r="B1" s="2"><v>2</v></c>
        </row>
      </sheetData>
    </worksheet>`;
    const [sheet] = await importXlsxWorkbook(
      await buildStyledWorkbook(sheetXml),
    );
    const patches = sheet.worksheet.rangeStyles ?? [];

    // A1: fillId 2 (green), fontId 1 (bold red), center/center.
    const a1 = resolveRangeStyleAt(patches, 1, 1);
    expect(a1?.bg).toBe('#D9EAD3');
    expect(a1?.b).toBe(true);
    expect(a1?.tc).toBe('#FF0000');
    expect(a1?.al).toBe('center');
    expect(a1?.va).toBe('middle');

    // B1: border thin left+bottom, fontId 2 (underline+strike, Roboto).
    const b1 = resolveRangeStyleAt(patches, 1, 2);
    expect(b1?.bl).toBe(true);
    expect(b1?.bb).toBe(true);
    expect(b1?.bt).toBeUndefined();
    expect(b1?.u).toBe(true);
    expect(b1?.st).toBe(true);
  });

  it('maps number formats to nf/cu/dp', async () => {
    const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" s="3"><v>0.5</v></c>
          <c r="B1" s="4"><v>1234.5</v></c>
        </row>
      </sheetData>
    </worksheet>`;
    const [sheet] = await importXlsxWorkbook(
      await buildStyledWorkbook(sheetXml),
    );
    const patches = sheet.worksheet.rangeStyles ?? [];

    const a1 = resolveRangeStyleAt(patches, 1, 1);
    expect(a1?.nf).toBe('percent');

    const b1 = resolveRangeStyleAt(patches, 1, 2);
    expect(b1?.nf).toBe('currency');
    expect(b1?.cu).toBe('USD');
    expect(b1?.dp).toBe(2);
  });

  it('imports column widths, row heights and hidden dimensions', async () => {
    const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <cols>
        <col min="1" max="1" width="17.13" customWidth="1"/>
        <col min="2" max="2" width="5.38" customWidth="1" hidden="1"/>
      </cols>
      <sheetData>
        <row r="1" ht="30" customHeight="1"><c r="A1"><v>1</v></c></row>
        <row r="2" hidden="1"><c r="A2"><v>2</v></c></row>
      </sheetData>
    </worksheet>`;
    const [sheet] = await importXlsxWorkbook(
      await buildStyledWorkbook(sheetXml),
    );
    const ws = sheet.worksheet;

    expect(ws.colWidths['1']).toBeGreaterThan(100);
    expect(ws.hiddenColumns).toContain(2);
    // 30pt ≈ 40px.
    expect(ws.rowHeights['1']).toBe(40);
    expect(ws.hiddenRows).toContain(2);
  });

  it('does not materialize a per-column width for a whole-sheet col span', async () => {
    const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <cols>
        <col min="1" max="16384" width="12" customWidth="1"/>
      </cols>
      <sheetData>
        <row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row>
      </sheetData>
    </worksheet>`;
    const [sheet] = await importXlsxWorkbook(
      await buildStyledWorkbook(sheetXml),
    );
    // Data spans 2 columns; the 16384-wide span must be clamped, not expanded.
    expect(Object.keys(sheet.worksheet.colWidths).length).toBeLessThan(100);
    expect(sheet.worksheet.colWidths['1']).toBeGreaterThan(0);
  });

  it('honors an explicit val="0" that disables a font toggle', async () => {
    const styles = `<?xml version="1.0"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <fonts count="2">
          <font/>
          <font><b val="0"/><i/></font>
        </fonts>
        <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
        <borders count="1"><border/></borders>
        <cellXfs count="2">
          <xf borderId="0" fillId="0" fontId="0" numFmtId="0"/>
          <xf borderId="0" fillId="0" fontId="1" numFmtId="0" applyFont="1"/>
        </cellXfs>
      </styleSheet>`;
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Fonts" sheetId="1"/></sheets></workbook>`,
    );
    zip.file('xl/styles.xml', styles);
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="1"><v>x</v></c></row></sheetData></worksheet>`,
    );
    const [sheet] = await importXlsxWorkbook(
      await zip.generateAsync({ type: 'uint8array' }),
    );
    const a1 = resolveRangeStyleAt(sheet.worksheet.rangeStyles ?? [], 1, 1);
    expect(a1?.b).toBeUndefined();
    expect(a1?.i).toBe(true);
  });

  it('leaves worksheets without styles.xml unstyled', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Plain" sheetId="1"/></sheets></workbook>`,
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="5"><v>1</v></c></row></sheetData></worksheet>`,
    );
    const [sheet] = await importXlsxWorkbook(
      await zip.generateAsync({ type: 'uint8array' }),
    );
    expect(sheet.worksheet.rangeStyles ?? []).toHaveLength(0);
  });

  it('converts date-formatted cell serials into date strings', async () => {
    const styles = `<?xml version="1.0"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <fonts count="1"><font/></fonts>
        <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
        <borders count="1"><border/></borders>
        <cellXfs count="2">
          <xf borderId="0" fillId="0" fontId="0" numFmtId="0"/>
          <xf borderId="0" fillId="0" fontId="0" numFmtId="14" applyNumberFormat="1"/>
        </cellXfs>
      </styleSheet>`;
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Dates" sheetId="1"/></sheets></workbook>`,
    );
    zip.file('xl/styles.xml', styles);
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1">
            <c r="A1" s="1"><v>45000</v></c>
            <c r="B1" s="0"><v>45000</v></c>
          </row>
        </sheetData>
      </worksheet>`,
    );
    const [sheet] = await importXlsxWorkbook(
      await zip.generateAsync({ type: 'uint8array' }),
    );
    // A1 has a date number format → serial converted to ISO date.
    expect(getWorksheetCell(sheet.worksheet, { r: 1, c: 1 })?.v).toBe(
      '2023-03-15',
    );
    // B1 has no date format → raw serial preserved.
    expect(getWorksheetCell(sheet.worksheet, { r: 1, c: 2 })?.v).toBe('45000');
  });

  it('honors the workbook 1904 date system when converting serials', async () => {
    const styles = `<?xml version="1.0"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <fonts count="1"><font/></fonts>
        <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
        <borders count="1"><border/></borders>
        <cellXfs count="2">
          <xf borderId="0" fillId="0" fontId="0" numFmtId="0"/>
          <xf borderId="0" fillId="0" fontId="0" numFmtId="14" applyNumberFormat="1"/>
        </cellXfs>
      </styleSheet>`;
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
         <workbookPr date1904="1"/>
         <sheets><sheet name="Dates" sheetId="1"/></sheets>
       </workbook>`,
    );
    zip.file('xl/styles.xml', styles);
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1" s="1"><v>45000</v></c></row>
        </sheetData>
      </worksheet>`,
    );
    const [sheet] = await importXlsxWorkbook(
      await zip.generateAsync({ type: 'uint8array' }),
    );
    // Same serial as the 1900-system test, shifted 1462 days later.
    expect(getWorksheetCell(sheet.worksheet, { r: 1, c: 1 })?.v).toBe(
      '2027-03-16',
    );
  });
});

describe('excelSerialToDateString', () => {
  it('converts whole serials to date-only strings', () => {
    expect(excelSerialToDateString(45000)).toBe('2023-03-15');
    expect(excelSerialToDateString(44927)).toBe('2023-01-01');
  });

  it('includes time when the serial has a fraction', () => {
    expect(excelSerialToDateString(45000.5)).toBe('2023-03-15 12:00:00');
  });

  it('renders a pure time-of-day serial without a spurious date', () => {
    expect(excelSerialToDateString(0.5)).toBe('12:00:00');
  });

  it('returns undefined for non-finite input', () => {
    expect(excelSerialToDateString(Number.NaN)).toBeUndefined();
  });

  it('shifts by 1462 days under the 1904 date system', () => {
    // A 1904-system serial denotes the same date as a 1900-system serial 1462
    // higher.
    expect(excelSerialToDateString(45000, true)).toBe(
      excelSerialToDateString(45000 + 1462),
    );
    expect(excelSerialToDateString(1, true)).toBe('1904-01-02');
  });
});

describe('mapNumberFormat', () => {
  it('does not treat a currency glyph inside a quoted label as currency', () => {
    expect(mapNumberFormat(200, '#,##0" ($ millions)"')).toEqual({
      nf: 'number',
      dp: 0,
    });
  });

  it('detects a quoted currency prefix', () => {
    expect(mapNumberFormat(164, '"$"#,##0.00')).toEqual({
      nf: 'currency',
      cu: 'USD',
      dp: 2,
    });
  });

  it('does not misread a quoted text label as a date', () => {
    expect(mapNumberFormat(200, '0.0" USD"')).toEqual({
      nf: 'number',
      dp: 1,
    });
  });

  it('reads the currency from a non-USD locale block', () => {
    expect(mapNumberFormat(200, '#,##0.00\\ [$€-407]')).toEqual({
      nf: 'currency',
      cu: 'EUR',
      dp: 2,
    });
    expect(mapNumberFormat(200, '[$£-809]#,##0.00')).toEqual({
      nf: 'currency',
      cu: 'GBP',
      dp: 2,
    });
  });

  it('maps built-in currency number-format ids without a format code', () => {
    expect(mapNumberFormat(5, undefined)).toEqual({
      nf: 'currency',
      cu: 'USD',
      dp: 0,
    });
    expect(mapNumberFormat(7, undefined)).toEqual({
      nf: 'currency',
      cu: 'USD',
      dp: 2,
    });
  });

  it('maps locale-specific built-in date ids (27-36)', () => {
    expect(mapNumberFormat(27, undefined)).toEqual({ nf: 'date' });
    expect(mapNumberFormat(36, undefined)).toEqual({ nf: 'date' });
  });

  it('does not classify elapsed-time (duration) formats as dates', () => {
    // `[h]:mm` etc. carry a bracketed elapsed-time token; treating them as a
    // date would misconvert the serial into a bogus 1899-12-30 timestamp.
    expect(mapNumberFormat(200, '[h]:mm')).toBeUndefined();
    expect(mapNumberFormat(200, '[mm]:ss')).toBeUndefined();
    expect(mapNumberFormat(200, '[hh]:mm:ss')).toBeUndefined();
    // A normal time format is still a date.
    expect(mapNumberFormat(200, 'h:mm:ss')).toEqual({ nf: 'date' });
  });
});
