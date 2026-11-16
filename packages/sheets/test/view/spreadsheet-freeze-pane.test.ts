import { describe, expect, it } from 'vitest';
import { Spreadsheet } from '../../src/view/spreadsheet';

/**
 * `Spreadsheet.getFreezePane` lets a host menu decide whether to offer
 * "Unfreeze". Called against a hand-built context, like
 * `spreadsheet-readonly-recalc.test.ts`, since the method reads one field.
 */
const getFreezePane = (
  Spreadsheet.prototype as unknown as {
    getFreezePane: () => { frozenRows: number; frozenCols: number };
  }
).getFreezePane;

describe('Spreadsheet.getFreezePane', () => {
  it('reports the sheet freeze pane', () => {
    const ctx = {
      sheet: { getFreezePane: () => ({ frozenRows: 2, frozenCols: 1 }) },
    };
    expect(getFreezePane.call(ctx)).toEqual({ frozenRows: 2, frozenCols: 1 });
  });

  it('reports nothing frozen before a sheet is attached', () => {
    expect(getFreezePane.call({ sheet: undefined })).toEqual({
      frozenRows: 0,
      frozenCols: 0,
    });
  });
});
