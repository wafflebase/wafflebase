import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { ImportedSheet } from './imported-sheet';
import { importRecordsAsSheet } from './record-importer';

export type ParquetImportOptions = {
  sheetName: string;
};

/**
 * Parses a local Parquet file into one editable sheet in the browser.
 */
export async function importParquetFile(
  file: ArrayBuffer,
  options: ParquetImportOptions,
): Promise<ImportedSheet> {
  const records = await parquetReadObjects({ file, compressors });
  return importRecordsAsSheet(records, {
    sheetName: options.sheetName,
    fallbackName: 'Imported Parquet',
    formatName: 'Parquet',
  });
}
