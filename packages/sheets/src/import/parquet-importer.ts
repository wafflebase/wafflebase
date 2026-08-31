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
  // Keep browser-only ESM dependencies out of server-side consumers that import
  // the sheets public API (for example, backend Jest tests).
  const [{ parquetReadObjects }, { compressors }] = await Promise.all([
    import('hyparquet'),
    import('hyparquet-compressors'),
  ]);
  const records = await parquetReadObjects({ file, compressors });
  return importRecordsAsSheet(records, {
    sheetName: options.sheetName,
    fallbackName: 'Imported Parquet',
    formatName: 'Parquet',
  });
}
