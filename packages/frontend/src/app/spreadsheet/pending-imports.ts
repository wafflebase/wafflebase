import type { SpreadsheetDocument } from "@/types/worksheet";

const pendingImports = new Map<string, SpreadsheetDocument>();

export function setPendingImport(
  docId: string,
  document: SpreadsheetDocument,
): void {
  pendingImports.set(docId, document);
}

export function peekPendingImport(
  docId: string,
): SpreadsheetDocument | undefined {
  return pendingImports.get(docId);
}

export function clearPendingImport(docId: string): void {
  pendingImports.delete(docId);
}
