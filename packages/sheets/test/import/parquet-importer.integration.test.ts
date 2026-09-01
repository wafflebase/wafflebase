import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getWorksheetCell } from '../../src';
import { importParquetFile } from '../../src/import/parquet-importer';

const gzipFixture = new URL('../fixtures/people-gzip.parquet', import.meta.url);

describe('importParquetFile integration', () => {
  it('decodes a GZIP-compressed Parquet fixture into a worksheet', async () => {
    const bytes = await readFile(gzipFixture);
    const file = new Uint8Array(bytes).buffer;

    const imported = await importParquetFile(file, { sheetName: 'People' });

    expect(imported).toMatchObject({
      name: 'People',
      rowCount: 3,
      columnCount: 3,
      cellCount: 9,
    });
    expect(getWorksheetCell(imported.worksheet, { r: 1, c: 1 })?.v).toBe('id');
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 1 })?.v).toBe('1');
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 2 })?.v).toBe(
      'Alice',
    );
    expect(getWorksheetCell(imported.worksheet, { r: 3, c: 3 })?.v).toBe(
      'FALSE',
    );
  });
});
