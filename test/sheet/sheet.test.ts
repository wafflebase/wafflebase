import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/sheet/sheet';

describe('Sheet', () => {
  it('should correctly set and get data', async () => {
    const sheet = new Sheet();
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '30');

    expect(await sheet.toInputString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toInputString({ r: 1, c: 2 })).toBe('20');
    expect(await sheet.toInputString({ r: 1, c: 3 })).toBe('30');
  });

  it('should update selection', () => {
    const sheet = new Sheet();
    sheet.selectStart({ r: 1, c: 1 });
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });

    sheet.selectStart({ r: 2, c: 2 });
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 2 });
  });

  it('should move selection', () => {
    const sheet = new Sheet();

    sheet.move(1, 0);
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 1 });

    sheet.move(0, 1);
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 2 });

    sheet.move(-1, 0);
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 2 });

    sheet.move(0, -1);
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });
  });

  it('should not move selection beyond sheet dimensions', () => {
    const sheet = new Sheet();

    sheet.move(-1, 0);
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });

    sheet.move(0, -1);
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });

    sheet.move(1, 0);
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 1 });
  });

  it('should correctly move to content edge', async () => {
    const sheet = new Sheet();
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');

    await sheet.setData({ r: 1, c: 4 }, '40');
    await sheet.setData({ r: 1, c: 5 }, '50');
    await sheet.setData({ r: 1, c: 6 }, '60');

    await sheet.moveToEdge(0, 1);
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 2 });

    await sheet.moveToEdge(0, 1);
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 4 });

    await sheet.moveToEdge(0, 1);
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 6 });
  });
});
