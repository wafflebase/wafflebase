import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/sheet/sheet';

describe('Sheet', () => {
  it('should correctly set and get data', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '10');
    sheet.setData({ row: 1, col: 2 }, '20');
    sheet.setData({ row: 1, col: 3 }, '30');

    expect(sheet.toInputString('A1')).toBe('10');
    expect(sheet.toInputString('B1')).toBe('20');
    expect(sheet.toInputString('C1')).toBe('30');
  });

  it('should update selection', () => {
    const sheet = new Sheet();
    sheet.selectStart({ row: 1, col: 1 });
    expect(sheet.getActiveCell()).toEqual({ row: 1, col: 1 });

    sheet.selectStart({ row: 2, col: 2 });
    expect(sheet.getActiveCell()).toEqual({ row: 2, col: 2 });
  });

  it('should move selection', () => {
    const sheet = new Sheet();

    sheet.move(1, 0);
    expect(sheet.getActiveCell()).toEqual({ row: 2, col: 1 });

    sheet.move(0, 1);
    expect(sheet.getActiveCell()).toEqual({ row: 2, col: 2 });

    sheet.move(-1, 0);
    expect(sheet.getActiveCell()).toEqual({ row: 1, col: 2 });

    sheet.move(0, -1);
    expect(sheet.getActiveCell()).toEqual({ row: 1, col: 1 });
  });

  it('should not move selection beyond sheet dimensions', () => {
    const sheet = new Sheet();

    sheet.move(-1, 0);
    expect(sheet.getActiveCell()).toEqual({ row: 1, col: 1 });

    sheet.move(0, -1);
    expect(sheet.getActiveCell()).toEqual({ row: 1, col: 1 });

    sheet.move(1, 0);
    expect(sheet.getActiveCell()).toEqual({ row: 2, col: 1 });
  });

  it('should correctly move to content edge', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '10');
    sheet.setData({ row: 1, col: 2 }, '20');

    sheet.setData({ row: 1, col: 4 }, '40');
    sheet.setData({ row: 1, col: 5 }, '50');
    sheet.setData({ row: 1, col: 6 }, '60');

    sheet.moveToEdge(0, 1);
    expect(sheet.getActiveCell()).toEqual({ row: 1, col: 2 });

    sheet.moveToEdge(0, 1);
    expect(sheet.getActiveCell()).toEqual({ row: 1, col: 4 });

    sheet.moveToEdge(0, 1);
    expect(sheet.getActiveCell()).toEqual({ row: 1, col: 6 });
  });
});
