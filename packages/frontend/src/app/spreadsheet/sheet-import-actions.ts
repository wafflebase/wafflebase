import {
  importJsonText,
  importXlsxWorkbook,
  type ImportedSheet,
  type ImportedXlsxSheet,
  type JsonImportMode,
  type SpreadsheetDocument,
  type TabMeta,
} from "@wafflebase/sheets";
import { getUniqueTabName } from "@/app/documents/tab-name";
import { parseCsvFile } from "./csv-actions";

export type ImportedSpreadsheetFile = {
  document: SpreadsheetDocument;
  fileName: string;
  /**
   * Set when an import budget stopped the file short, with the row count that
   * did arrive. Only the CSV path can report these — the XLSX and JSON
   * importers read their input whole and have no budget to stop on — so a
   * caller must treat them as absent rather than false.
   */
  truncated?: boolean;
  rowCount?: number;
};

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export function sheetImportBaseName(
  fileName: string,
  fallback = "Imported Sheet",
): string {
  const dot = fileName.lastIndexOf(".");
  const baseName = (dot >= 0 ? fileName.slice(0, dot) : fileName).trim();
  return baseName || fallback;
}

export function createSpreadsheetDocumentFromImportedSheets(
  importedSheets: ImportedSheet[],
): SpreadsheetDocument {
  const tabs: Record<string, TabMeta> = {};
  const tabOrder: string[] = [];
  const sheets: SpreadsheetDocument["sheets"] = {};

  importedSheets.forEach((sheet, index) => {
    const tabId = `tab-${index + 1}`;
    const tab: TabMeta = {
      id: tabId,
      name: getUniqueTabName(
        tabs,
        sheet.name,
        index === 0 ? "Imported Sheet" : `Imported Sheet ${index + 1}`,
      ),
      type: "sheet",
    };

    tabs[tabId] = tab;
    tabOrder.push(tabId);
    sheets[tabId] = sheet.worksheet;
  });

  return { tabs, tabOrder, sheets };
}

export function createSpreadsheetDocumentFromImportedXlsxSheets(
  importedSheets: ImportedXlsxSheet[],
): SpreadsheetDocument {
  return createSpreadsheetDocumentFromImportedSheets(importedSheets);
}

export async function importXlsx(
  file: File,
): Promise<ImportedSpreadsheetFile> {
  const importedSheets = await importXlsxWorkbook(await file.arrayBuffer());
  return {
    document: createSpreadsheetDocumentFromImportedSheets(importedSheets),
    fileName: file.name,
  };
}

async function importJson(
  file: File,
  mode: JsonImportMode,
): Promise<ImportedSpreadsheetFile> {
  const sheetName = sheetImportBaseName(file.name, "Imported JSON");
  const text = new TextDecoder().decode(await file.arrayBuffer());
  const importedSheet = importJsonText(text, {
    sheetName,
    mode,
  });
  return {
    document: createSpreadsheetDocumentFromImportedSheets([importedSheet]),
    fileName: file.name,
  };
}

/**
 * Streams a `.csv` / `.tsv` into a sheet.
 *
 * Unlike the other two formats this one is bounded: a CSV can be arbitrarily
 * large, so the writer stops at a budget and reports what arrived instead of
 * building a document nobody can persist. That is what `truncated`/`rowCount`
 * carry back to the upload queue.
 */
async function importCsv(file: File): Promise<ImportedSpreadsheetFile> {
  const table = await parseCsvFile(file, sheetImportBaseName(file.name));
  return {
    document: createSpreadsheetDocumentFromImportedSheets([table]),
    fileName: file.name,
    truncated: table.truncated,
    rowCount: table.rowCount,
  };
}

export async function importSheetFile(
  file: File,
): Promise<ImportedSpreadsheetFile> {
  switch (fileExtension(file.name)) {
    case "xlsx":
      return importXlsx(file);
    case "json":
      return importJson(file, "auto");
    case "jsonl":
    case "ndjson":
      return importJson(file, "ndjson");
    case "csv":
    case "tsv":
      return importCsv(file);
    default:
      throw new Error(`Unsupported sheet import format: ${file.name}`);
  }
}
