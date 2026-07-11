import JSZip from 'jszip';
import { parseRef, toSref } from '../model/core/coordinates';
import type { Cell, CellStyle, Ref } from '../model/core/types';
import {
  createWorksheet,
  type Worksheet,
} from '../model/workbook/worksheet-document';
import { writeWorksheetCell } from '../model/workbook/worksheet-grid';
import {
  coalesceAdjacentRangeStylePatches,
  type RangeStylePatch,
} from '../model/worksheet/range-styles';
import { parseStyleTable, type StyleTable } from './xlsx-styles';
import { excelSerialToDateString } from './xlsx-serial-date';
import {
  childrenByLocalName,
  firstChildByLocalName,
  parseXml,
  readText,
} from './xlsx-xml';

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
const XLSX_STYLES_PATH = 'xl/styles.xml';

// Excel stores column widths in "character" units and row heights in points;
// convert both to the pixel sizes the worksheet model uses (~7px per char at
// the default font, plus 5px padding; 96/72 DPI ratio for points).
function columnWidthToPixels(width: number): number {
  return Math.round(width * 7 + 5);
}
function pointsToPixels(points: number): number {
  return Math.round((points * 96) / 72);
}
// A `<col>` range may set widths/hidden a little past the populated data (an
// intentionally hidden or sized empty column), but a whole-sheet span
// (min=1 max=16384) is Excel encoding the default column width and must not be
// materialized per column. Keep entries within this many columns of the data.
const COLUMN_SPAN_MARGIN = 64;
const OFFICE_RELATIONSHIP_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function readZipText(
  zip: JSZip,
  path: string,
): Promise<string | undefined> {
  return zip.file(path)?.async('string');
}

// The workbook opts into the legacy 1904 date system via
// `<workbookPr date1904="1"/>` (or `date1904="true"`); dates are otherwise
// serials in the default 1900 system.
function parseDate1904(workbookXml: string): boolean {
  const doc = parseXml(workbookXml, XLSX_WORKBOOK_PATH);
  const pr = firstChildByLocalName(doc, 'workbookPr');
  const val = pr?.getAttribute('date1904');
  return val === '1' || val === 'true';
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
      ? sharedStrings[sharedIndex] ?? ''
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

// Cell types that carry a literal (non-numeric) value and must not be treated
// as a date serial even when the style says the number format is a date.
const NON_NUMERIC_CELL_TYPES = new Set(['s', 'str', 'inlineStr', 'b', 'e']);

/**
 * When a cell's number format is a date, its stored value is an Excel serial
 * number; rewrite it to the model's `YYYY-MM-DD[ HH:MM:SS]` date string so it
 * renders as a date rather than the raw serial.
 */
function convertDateSerial(
  cell: Element,
  parsed: Cell,
  style: CellStyle | undefined,
  date1904: boolean,
): void {
  if (style?.nf !== 'date' || parsed.v === undefined) {
    return;
  }
  const type = cell.getAttribute('t');
  if (type && NON_NUMERIC_CELL_TYPES.has(type)) {
    return;
  }
  const serial = Number(parsed.v);
  if (!Number.isFinite(serial)) {
    return;
  }
  const dateString = excelSerialToDateString(serial, date1904);
  if (dateString) {
    parsed.v = dateString;
  }
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

function applyColumns(
  worksheet: Worksheet,
  doc: Document,
  maxColumn: number,
): void {
  const hidden: number[] = [];
  for (const col of childrenByLocalName(doc, 'col')) {
    const min = Number(col.getAttribute('min'));
    const rawMax = Number(col.getAttribute('max'));
    if (!Number.isInteger(min) || !Number.isInteger(rawMax) || min < 1) {
      continue;
    }
    // Whole-sheet `<col>` spans (e.g. min=1 max=16384) would otherwise write an
    // entry per column; clamp near the populated range so the model stays small.
    const max = Math.min(rawMax, maxColumn + COLUMN_SPAN_MARGIN);
    const rawWidth = Number(col.getAttribute('width'));
    const isHidden = col.getAttribute('hidden') === '1';
    const hasCustomWidth =
      col.getAttribute('customWidth') === '1' && Number.isFinite(rawWidth);
    for (let index = min; index <= max; index += 1) {
      if (hasCustomWidth) {
        worksheet.colWidths[String(index)] = columnWidthToPixels(rawWidth);
      }
      if (isHidden) {
        hidden.push(index);
      }
    }
  }
  if (hidden.length > 0) {
    worksheet.hiddenColumns = hidden;
  }
}

function applyRowStyles(
  worksheet: Worksheet,
  rowNumber: number,
  row: Element,
  hiddenRows: number[],
): void {
  if (row.getAttribute('customHeight') === '1') {
    const height = Number(row.getAttribute('ht'));
    if (Number.isFinite(height) && height > 0) {
      worksheet.rowHeights[String(rowNumber)] = pointsToPixels(height);
    }
  }
  if (row.getAttribute('hidden') === '1') {
    hiddenRows.push(rowNumber);
  }
}

function parseWorksheet(
  sheetName: string,
  worksheetXml: string,
  sharedStrings: string[],
  styleTable: StyleTable,
  date1904: boolean,
): ImportedXlsxSheet {
  const doc = parseXml(worksheetXml, sheetName);
  const worksheet = createWorksheet();
  const stylePatches: RangeStylePatch[] = [];
  const hiddenRows: number[] = [];
  let cellCount = 0;
  let maxRow = 0;
  let maxColumn = 0;

  childrenByLocalName(doc, 'row').forEach((row, rowIndex) => {
    const rowNumber = Number(row.getAttribute('r')) || rowIndex + 1;
    let nextColumn = 1;

    applyRowStyles(worksheet, rowNumber, row, hiddenRows);

    for (const cell of childrenByLocalName(row, 'c')) {
      const ref = cell.getAttribute('r')
        ? safeParseRef(cell.getAttribute('r') ?? '')
        : { r: rowNumber, c: nextColumn };
      if (!ref) {
        nextColumn += 1;
        continue;
      }

      const styleIndex = cell.getAttribute('s');
      const style =
        styleIndex !== null
          ? styleTable.resolveCellStyle(Number(styleIndex))
          : undefined;
      if (style) {
        stylePatches.push({
          range: [{ ...ref }, { ...ref }],
          style,
        });
      }

      const parsedCell = parseCell(cell, sharedStrings);
      if (parsedCell) {
        convertDateSerial(cell, parsedCell, style, date1904);
        writeWorksheetCell(worksheet, ref, parsedCell);
        cellCount += 1;
        maxRow = Math.max(maxRow, ref.r);
        maxColumn = Math.max(maxColumn, ref.c);
      }
      nextColumn = ref.c + 1;
    }
  });

  applyColumns(worksheet, doc, maxColumn);
  applyMergeRanges(worksheet, doc);

  if (hiddenRows.length > 0) {
    worksheet.hiddenRows = hiddenRows;
  }
  if (stylePatches.length > 0) {
    // Coalesce horizontally then vertically to keep the patch list small.
    worksheet.rangeStyles = coalesceAdjacentRangeStylePatches(
      coalesceAdjacentRangeStylePatches(stylePatches, 'column'),
      'row',
    );
  }

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
  const date1904 = parseDate1904(workbookXml);

  const relationships = parseWorkbookRelationships(
    await readZipText(zip, XLSX_WORKBOOK_RELS_PATH),
  );
  const sharedStrings = parseSharedStrings(
    await readZipText(zip, XLSX_SHARED_STRINGS_PATH),
  );
  const styleTable = parseStyleTable(await readZipText(zip, XLSX_STYLES_PATH));

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
      parseWorksheet(
        sheet.name,
        worksheetXml,
        sharedStrings,
        styleTable,
        date1904,
      ),
    );
  }

  return importedSheets;
}

export async function importXlsxFile(
  file: XlsxFileLike,
): Promise<ImportedXlsxSheet[]> {
  return importXlsxWorkbook(await file.arrayBuffer());
}
