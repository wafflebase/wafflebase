import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { getWorksheetCell } from "@wafflebase/sheets";
import {
  importXlsxFile,
  importXlsxWorkbook,
} from "../../../src/app/documents/xlsx-import.ts";

globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser;

async function buildWorkbook(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
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
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/>
    </Relationships>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <si><t>Item</t></si>
      <si><r><t>North</t></r><r><t> Team</t></r></si>
    </sst>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
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
    "xl/worksheets/sheet2.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>Second sheet</t></is></c></row>
      </sheetData>
    </worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

test("importXlsxWorkbook converts workbook sheets into Wafflebase worksheets", async () => {
  const sheets = await importXlsxWorkbook(await buildWorkbook());

  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].name, "Budget");
  assert.equal(sheets[0].cellCount, 7);
  assert.equal(sheets[0].rowCount, 3);
  assert.equal(sheets[0].columnCount, 3);
  assert.equal(getWorksheetCell(sheets[0].worksheet, { r: 1, c: 1 })?.v, "Item");
  assert.equal(
    getWorksheetCell(sheets[0].worksheet, { r: 1, c: 2 })?.v,
    "North Team",
  );
  assert.equal(getWorksheetCell(sheets[0].worksheet, { r: 2, c: 1 })?.v, "42");
  assert.equal(getWorksheetCell(sheets[0].worksheet, { r: 2, c: 2 })?.v, "TRUE");
  assert.deepEqual(getWorksheetCell(sheets[0].worksheet, { r: 2, c: 3 }), {
    f: "=SUM(A2:A2)",
    v: "42",
  });
  assert.equal(getWorksheetCell(sheets[0].worksheet, { r: 3, c: 1 })?.v, "Inline");
  assert.equal(
    getWorksheetCell(sheets[0].worksheet, { r: 3, c: 2 })?.v,
    "#DIV/0!",
  );
  assert.deepEqual(sheets[0].worksheet.merges?.A1, { rs: 1, cs: 2 });
  assert.equal(
    getWorksheetCell(sheets[1].worksheet, { r: 1, c: 1 })?.v,
    "Second sheet",
  );
});

test("importXlsxFile reads browser File objects", async () => {
  const file = new File([await buildWorkbook()], "sample.xlsx");
  const sheets = await importXlsxFile(file);

  assert.equal(sheets.map((sheet) => sheet.name).join(","), "Budget,Ops");
});

test("importXlsxWorkbook rejects archives without workbook metadata", async () => {
  const zip = new JSZip();
  zip.file("xl/worksheets/sheet1.xml", "<worksheet/>");
  const workbook = await zip.generateAsync({ type: "uint8array" });

  await assert.rejects(
    () => importXlsxWorkbook(workbook),
    /missing workbook metadata/,
  );
});
