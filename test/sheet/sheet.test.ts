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
});
