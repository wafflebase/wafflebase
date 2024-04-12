import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/sheet/sheet';

describe('Sheet', () => {
  it('should correctly calculate sum of numbers', () => {
    const sheet = new Sheet();
    sheet.setData(1, 1, 10);
    sheet.setData(1, 2, 20);
    sheet.setData(1, 3, 30);
    expect(sheet.calculateSum('A1:C1')).toBe(60);
  });
});
