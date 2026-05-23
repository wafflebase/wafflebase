import {
  importXlsxWorkbook,
  type ImportedXlsxSheet,
  type SpreadsheetDocument,
  type TabMeta,
} from "@wafflebase/sheets";
import { pickFile } from "@/app/docs/export-utils";
import { getUniqueTabName } from "./tab-name";

export function createSpreadsheetDocumentFromImportedXlsxSheets(
  importedSheets: ImportedXlsxSheet[],
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

export async function pickAndImportXlsx(): Promise<{
  document: SpreadsheetDocument;
  fileName: string;
} | null> {
  const file = await pickFile(
    ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  if (!file) return null;

  const importedSheets = await importXlsxWorkbook(await file.arrayBuffer());
  return {
    document: createSpreadsheetDocumentFromImportedXlsxSheets(importedSheets),
    fileName: file.name,
  };
}
