import type { ImportedSheet } from './imported-sheet';
import { importRecordsAsSheet } from './record-importer';
import { MAX_IMPORT_CELLS } from './csv-importer';
import { cellFromInput } from '../model/worksheet/input';
import type { Cell } from '../model/core/types';
import { toCell } from '../store/readonly';

export type ParquetImportOptions = {
  sheetName: string;
};

function binaryToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function parquetDateCell(value: Date): Cell {
  const iso = value.toISOString();
  const time = iso.slice(11, 19);
  return cellFromInput(
    time === '00:00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`,
  );
}

function parquetCellForValue(value: unknown): Cell | undefined {
  if (value === null || value === undefined) return undefined;
  // A JavaScript number loses precision beyond Number.MAX_SAFE_INTEGER, so an
  // INT64/UINT64 must remain literal text instead of passing through inference.
  if (typeof value === 'bigint') return { v: value.toString() };
  if (value instanceof Uint8Array) return { v: binaryToHex(value) };
  if (value instanceof Date) return parquetDateCell(value);
  return cellFromInput(toCell(value));
}

function assertParquetCellLimit(metadata: {
  num_rows: bigint;
  schema: Array<{ num_children?: number }>;
}): void {
  const columnCount = metadata.schema[0]?.num_children ?? 0;
  if (columnCount === 0) return;
  // The header is materialized as a sheet row too, so it participates in the
  // same cap as CSV. BigInt arithmetic keeps a malicious footer from losing
  // precision before the bound is checked.
  const potentialCells = (metadata.num_rows + 1n) * BigInt(columnCount);
  if (potentialCells > BigInt(MAX_IMPORT_CELLS)) {
    throw new Error(
      `Parquet import exceeds the ${MAX_IMPORT_CELLS.toLocaleString()}-cell limit`,
    );
  }
}

/**
 * Parses a local Parquet file into one editable sheet in the browser.
 */
export async function importParquetFile(
  file: ArrayBuffer,
  options: ParquetImportOptions,
): Promise<ImportedSheet> {
  // Keep browser-only ESM dependencies out of server-side consumers that import
  // the sheets public API (for example, backend Jest tests).
  const [{ parquetMetadata, parquetReadObjects }, { compressors }] =
    await Promise.all([
      import('hyparquet'),
      import('hyparquet-compressors'),
    ]);
  const metadata = parquetMetadata(file);
  assertParquetCellLimit(metadata);
  // Logical UTF-8 columns remain strings, while unannotated BYTE_ARRAY values
  // stay Uint8Array for the binary formatter below.
  const records = await parquetReadObjects({
    file,
    metadata,
    compressors,
    utf8: false,
  });
  return importRecordsAsSheet(records, {
    sheetName: options.sheetName,
    fallbackName: 'Imported Parquet',
    formatName: 'Parquet',
    cellForValue: parquetCellForValue,
    enforceImportBudget: true,
  });
}
