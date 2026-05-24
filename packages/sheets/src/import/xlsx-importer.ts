import JSZip from 'jszip';
import { parseRef, toSref } from '../model/core/coordinates';
import type { Cell, Ref } from '../model/core/types';
import {
  createWorksheet,
  type Worksheet,
} from '../model/workbook/worksheet-document';
import { writeWorksheetCell } from '../model/workbook/worksheet-grid';

type WorkbookSheetRef = {
  name: string;
  relationshipId?: string;
};

type Relationship = {
  id: string;
  target: string;
};

export type ImportedXlsxSheet = {
  name: string;
  worksheet: Worksheet;
  cellCount: number;
  rowCount: number;
  columnCount: number;
};

export type XlsxFileLike = {
  arrayBuffer(): Promise<ArrayBuffer | Uint8Array>;
};

const XLSX_WORKBOOK_PATH = 'xl/workbook.xml';
const XLSX_WORKBOOK_RELS_PATH = 'xl/_rels/workbook.xml.rels';
const XLSX_SHARED_STRINGS_PATH = 'xl/sharedStrings.xml';
const OFFICE_RELATIONSHIP_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function childrenByLocalName(
  parent: Element | Document,
  localName: string,
): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', localName));
}

function firstChildByLocalName(
  parent: Element | Document,
  localName: string,
): Element | null {
  return childrenByLocalName(parent, localName)[0] ?? null;
}

function readText(node: Node | null | undefined): string {
  return node?.textContent ?? '';
}

function parseXml(xml: string, path: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`Invalid XLSX XML in ${path}.`);
  }
  return doc;
}

async function readZipText(
  zip: JSZip,
  path: string,
): Promise<string | undefined> {
  return zip.file(path)?.async('string');
}

function parseWorkbookSheets(workbookXml: string): WorkbookSheetRef[] {
  const doc = parseXml(workbookXml, XLSX_WORKBOOK_PATH);
  return childrenByLocalName(doc, 'sheet').map((sheet, index) => ({
    name: sheet.getAttribute('name')?.trim() || `Sheet${index + 1}`,
    relationshipId:
      sheet.getAttributeNS(OFFICE_RELATIONSHIP_NS, 'id') ??
      sheet.getAttribute('r:id') ??
      sheet.getAttribute('id') ??
      undefined,
  }));
}

function parseWorkbookRelationships(
  relsXml: string | undefined,
): Map<string, Relationship> {
  if (!relsXml) {
    return new Map();
  }

  const doc = parseXml(relsXml, XLSX_WORKBOOK_RELS_PATH);
  const relationships = new Map<string, Relationship>();
  for (const rel of childrenByLocalName(doc, 'Relationship')) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (!id || !target) {
      continue;
    }
    relationships.set(id, { id, target });
  }
  return relationships;
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function resolveWorkbookRelationshipTarget(target: string): string {
  if (target.startsWith('/')) {
    return normalizeZipPath(target.slice(1));
  }
  return normalizeZipPath(`xl/${target}`);
}

function parseSharedStrings(sharedStringsXml: string | undefined): string[] {
  if (!sharedStringsXml) {
    return [];
  }

  const doc = parseXml(sharedStringsXml, XLSX_SHARED_STRINGS_PATH);
  return childrenByLocalName(doc, 'si').map((item) => {
    const directText = firstChildByLocalName(item, 't');
    if (directText && directText.parentElement === item) {
      return readText(directText);
    }
    return childrenByLocalName(item, 't').map(readText).join('');
  });
}

function safeParseRef(sref: string): Ref | undefined {
  try {
    return parseRef(sref);
  } catch {
    return undefined;
  }
}

function cellText(cell: Element, localName: string): string {
  return readText(firstChildByLocalName(cell, localName)).trim();
}

function inlineString(cell: Element): string {
  const inline = firstChildByLocalName(cell, 'is');
  if (!inline) {
    return '';
  }
  return childrenByLocalName(inline, 't').map(readText).join('');
}

function resolveCellValue(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute('t');

  if (type === 'inlineStr') {
    return inlineString(cell);
  }

  const rawValue = cellText(cell, 'v');
  if (!rawValue) {
    return '';
  }

  if (type === 's') {
    const sharedIndex = Number(rawValue);
    return Number.isInteger(sharedIndex)
      ? (sharedStrings[sharedIndex] ?? '')
      : '';
  }

  if (type === 'b') {
    return rawValue === '1' ? 'TRUE' : 'FALSE';
  }

  return rawValue;
}

function parseCell(cell: Element, sharedStrings: string[]): Cell | undefined {
  const formulaText = cellText(cell, 'f');
  const value = resolveCellValue(cell, sharedStrings);
  const parsed: Cell = {};

  if (formulaText) {
    parsed.f = formulaText.startsWith('=') ? formulaText : `=${formulaText}`;
  }
  if (value) {
    parsed.v = value;
  }

  return parsed.f || parsed.v ? parsed : undefined;
}

function applyMergeRanges(worksheet: Worksheet, worksheetRoot: Document): void {
  for (const merge of childrenByLocalName(worksheetRoot, 'mergeCell')) {
    const range = merge.getAttribute('ref');
    if (!range) {
      continue;
    }

    const [startRef, endRef] = range.split(':').map(safeParseRef);
    if (!startRef || !endRef) {
      continue;
    }

    const rowSpan = Math.abs(endRef.r - startRef.r) + 1;
    const columnSpan = Math.abs(endRef.c - startRef.c) + 1;
    if (rowSpan <= 1 && columnSpan <= 1) {
      continue;
    }

    worksheet.merges ??= {};
    worksheet.merges[toSref(startRef)] = {
      rs: rowSpan,
      cs: columnSpan,
    };
  }
}

function parseWorksheet(
  sheetName: string,
  worksheetXml: string,
  sharedStrings: string[],
): ImportedXlsxSheet {
  const doc = parseXml(worksheetXml, sheetName);
  const worksheet = createWorksheet();
  let cellCount = 0;
  let maxRow = 0;
  let maxColumn = 0;

  childrenByLocalName(doc, 'row').forEach((row, rowIndex) => {
    const rowNumber = Number(row.getAttribute('r')) || rowIndex + 1;
    let nextColumn = 1;

    for (const cell of childrenByLocalName(row, 'c')) {
      const ref = cell.getAttribute('r')
        ? safeParseRef(cell.getAttribute('r') ?? '')
        : { r: rowNumber, c: nextColumn };
      if (!ref) {
        nextColumn += 1;
        continue;
      }

      const parsedCell = parseCell(cell, sharedStrings);
      if (parsedCell) {
        writeWorksheetCell(worksheet, ref, parsedCell);
        cellCount += 1;
        maxRow = Math.max(maxRow, ref.r);
        maxColumn = Math.max(maxColumn, ref.c);
      }
      nextColumn = ref.c + 1;
    }
  });

  applyMergeRanges(worksheet, doc);

  return {
    name: sheetName,
    worksheet,
    cellCount,
    rowCount: maxRow,
    columnCount: maxColumn,
  };
}

export async function importXlsxWorkbook(
  workbookData: ArrayBuffer | Uint8Array,
): Promise<ImportedXlsxSheet[]> {
  const zip = await JSZip.loadAsync(workbookData);
  const workbookXml = await readZipText(zip, XLSX_WORKBOOK_PATH);
  if (!workbookXml) {
    throw new Error('Invalid .xlsx file: missing workbook metadata.');
  }

  const workbookSheets = parseWorkbookSheets(workbookXml);
  if (workbookSheets.length === 0) {
    throw new Error('This .xlsx file does not contain any sheets.');
  }

  const relationships = parseWorkbookRelationships(
    await readZipText(zip, XLSX_WORKBOOK_RELS_PATH),
  );
  const sharedStrings = parseSharedStrings(
    await readZipText(zip, XLSX_SHARED_STRINGS_PATH),
  );

  const importedSheets: ImportedXlsxSheet[] = [];
  const hasWorkbookRelationships = relationships.size > 0;
  for (const [index, sheet] of workbookSheets.entries()) {
    const relationship = sheet.relationshipId
      ? relationships.get(sheet.relationshipId)
      : undefined;
    let worksheetPath: string;
    if (relationship) {
      worksheetPath = resolveWorkbookRelationshipTarget(relationship.target);
    } else if (!hasWorkbookRelationships) {
      // Some older or minimally structured writers omit sheet relationship
      // entries, so fall back to Excel's conventional worksheet path pattern.
      worksheetPath = `xl/worksheets/sheet${index + 1}.xml`;
    } else {
      throw new Error(
        `Invalid .xlsx file: unresolved worksheet relationship "${sheet.relationshipId ?? '(missing)'}" for sheet "${sheet.name}".`,
      );
    }
    const worksheetXml = await readZipText(zip, worksheetPath);

    if (!worksheetXml) {
      throw new Error(`Invalid .xlsx file: missing worksheet "${sheet.name}".`);
    }

    importedSheets.push(
      parseWorksheet(sheet.name, worksheetXml, sharedStrings),
    );
  }

  return importedSheets;
}

export async function importXlsxFile(
  file: XlsxFileLike,
): Promise<ImportedXlsxSheet[]> {
  return importXlsxWorkbook(await file.arrayBuffer());
}
