import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/sheet/sheet';

describe('Sheet', () => {
  it('should correctly set and get data', () => {
    const sheet = new Sheet();
    sheet.setData(1, 1, 10);
    sheet.setData(1, 2, 20);
    sheet.setData(1, 3, 30);

    expect(sheet.getData(1, 1)).toBe(10);
    expect(sheet.getData(1, 2)).toBe(20);
    expect(sheet.getData(1, 3)).toBe(30);
  });

  it('should update selection', () => {
    const sheet = new Sheet();
    sheet.setSelection({ row: 1, col: 1 });
    expect(sheet.getSelection()).toEqual({ row: 1, col: 1 });

    sheet.setSelection({ row: 2, col: 2 });
    expect(sheet.getSelection()).toEqual({ row: 2, col: 2 });
  });

  it('should move selection', () => {
    const sheet = new Sheet();
    sheet.setSelection({ row: 1, col: 1 });

    sheet.moveSelection(1, 0);
    expect(sheet.getSelection()).toEqual({ row: 2, col: 1 });

    sheet.moveSelection(0, 1);
    expect(sheet.getSelection()).toEqual({ row: 2, col: 2 });

    sheet.moveSelection(-1, 0);
    expect(sheet.getSelection()).toEqual({ row: 1, col: 2 });

    sheet.moveSelection(0, -1);
    expect(sheet.getSelection()).toEqual({ row: 1, col: 1 });
  });

  it('should not move selection beyond sheet dimensions', () => {
    const sheet = new Sheet();
    sheet.setSelection({ row: 1, col: 1 });

    sheet.moveSelection(-1, 0);
    expect(sheet.getSelection()).toEqual({ row: 1, col: 1 });

    sheet.moveSelection(0, -1);
    expect(sheet.getSelection()).toEqual({ row: 1, col: 1 });

    sheet.moveSelection(101, 0);
    expect(sheet.getSelection()).toEqual({ row: 100, col: 1 });

    sheet.moveSelection(0, 27);
    expect(sheet.getSelection()).toEqual({ row: 100, col: 26 });
  });
});
