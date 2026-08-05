import type { Worksheet } from '../model/workbook/worksheet-document';

/**
 * Format-neutral worksheet output shared by file importers.
 */
export type ImportedSheet = {
  name: string;
  worksheet: Worksheet;
  cellCount: number;
  rowCount: number;
  columnCount: number;
};
