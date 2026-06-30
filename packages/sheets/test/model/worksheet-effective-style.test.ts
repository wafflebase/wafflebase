import { describe, expect, it } from 'vitest';
import {
  resolveWorksheetCellStyle,
  writeWorksheetCell,
} from '../../src/model/workbook/worksheet-grid';
import { createWorksheet } from '../../src/model/workbook/worksheet-document';

describe('resolveWorksheetCellStyle', () => {
  it('returns undefined when no layer applies', () => {
    const ws = createWorksheet();
    writeWorksheetCell(ws, { r: 1, c: 1 }, { v: 'x' });
    expect(resolveWorksheetCellStyle(ws, { r: 1, c: 1 })).toBeUndefined();
  });

  it('resolves a format stored as a column-level style', () => {
    const ws = createWorksheet();
    writeWorksheetCell(ws, { r: 2, c: 1 }, { v: '2026-07-01' });
    ws.colStyles['1'] = { nf: 'date' };
    expect(resolveWorksheetCellStyle(ws, { r: 2, c: 1 })).toMatchObject({
      nf: 'date',
    });
  });

  it('resolves a format stored as a range-style layer', () => {
    const ws = createWorksheet();
    writeWorksheetCell(ws, { r: 2, c: 1 }, { v: '2026-07-01' });
    ws.rangeStyles = [
      { range: [{ r: 2, c: 1 }, { r: 5, c: 1 }], style: { nf: 'date' } },
    ];
    expect(resolveWorksheetCellStyle(ws, { r: 2, c: 1 })).toMatchObject({
      nf: 'date',
    });
    // Outside the patched range, no format resolves.
    writeWorksheetCell(ws, { r: 9, c: 1 }, { v: 'x' });
    expect(resolveWorksheetCellStyle(ws, { r: 9, c: 1 })).toBeUndefined();
  });

  it('uses a passed cellStyle without re-reading the cell', () => {
    const ws = createWorksheet();
    // No cell written at (2,1); the column carries the format.
    ws.colStyles['1'] = { nf: 'date' };
    // Caller passes the already-read per-cell style explicitly.
    expect(
      resolveWorksheetCellStyle(ws, { r: 2, c: 1 }, { b: true }),
    ).toEqual({ nf: 'date', b: true });
  });

  it('merges layers with later layers winning (cell over range)', () => {
    const ws = createWorksheet();
    writeWorksheetCell(ws, { r: 2, c: 1 }, { v: '100', s: { nf: 'currency' } });
    ws.rangeStyles = [
      { range: [{ r: 1, c: 1 }, { r: 9, c: 1 }], style: { nf: 'number' } },
    ];
    ws.sheetStyle = { b: true };
    const resolved = resolveWorksheetCellStyle(ws, { r: 2, c: 1 });
    // sheet style contributes bold; cell style overrides the range's nf.
    expect(resolved).toEqual({ b: true, nf: 'currency' });
  });
});
