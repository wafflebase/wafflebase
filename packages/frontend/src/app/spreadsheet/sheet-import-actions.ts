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

export type ImportedSpreadsheetFile = {
  document: SpreadsheetDocument;
  fileName: string;
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
    default:
      throw new Error(`Unsupported sheet import format: ${file.name}`);
  }
}
