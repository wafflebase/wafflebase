import { beforeEach, describe, expect, it, vi } from 'vitest';

const parquetMocks = vi.hoisted(() => ({
  parquetReadObjects: vi.fn(),
}));

vi.mock('hyparquet', () => ({
  parquetReadObjects: parquetMocks.parquetReadObjects,
}));

vi.mock('hyparquet-compressors', () => ({
  compressors: { GZIP: vi.fn() },
}));

import { getWorksheetCell } from '../../src';
import { importParquetFile } from '../../src/import/parquet-importer';

describe('importParquetFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps reader records into an editable worksheet', async () => {
    parquetMocks.parquetReadObjects.mockResolvedValue([
      { name: 'Alice', score: 95, active: true },
      { name: 'Bob', score: null, joined: '2026-08-31' },
    ]);
    const file = new Uint8Array([80, 65, 82, 49]).buffer;

    const imported = await importParquetFile(file, { sheetName: 'People' });

    expect(parquetMocks.parquetReadObjects).toHaveBeenCalledWith({
      file,
      compressors: { GZIP: expect.any(Function) },
    });
    expect(imported.name).toBe('People');
    expect(imported.rowCount).toBe(3);
    expect(imported.columnCount).toBe(4);
    expect(getWorksheetCell(imported.worksheet, { r: 1, c: 1 })).toEqual({
      v: 'name',
      s: { b: true },
    });
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 2 })?.v).toBe('95');
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 3 })?.v).toBe(
      'TRUE',
    );
    expect(
      getWorksheetCell(imported.worksheet, { r: 3, c: 2 }),
    ).toBeUndefined();
    expect(getWorksheetCell(imported.worksheet, { r: 3, c: 4 })).toEqual({
      v: '2026-08-31',
      s: { nf: 'date' },
    });
  });

  it('rejects Parquet data without records or columns', async () => {
    parquetMocks.parquetReadObjects.mockResolvedValueOnce([]);
    await expect(
      importParquetFile(new ArrayBuffer(0), { sheetName: 'Empty' }),
    ).rejects.toThrow('Parquet import contains no records');

    parquetMocks.parquetReadObjects.mockResolvedValueOnce([{}]);
    await expect(
      importParquetFile(new ArrayBuffer(0), { sheetName: 'Empty' }),
    ).rejects.toThrow('Parquet import contains no columns');
  });
});
