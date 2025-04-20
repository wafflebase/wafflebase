import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/worksheet/sheet';

describe('Sheet.Data', () => {
  it('should correctly set and get data', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '30');

    expect(await sheet.toInputString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toInputString({ r: 1, c: 2 })).toBe('20');
    expect(await sheet.toInputString({ r: 1, c: 3 })).toBe('30');
  });
});

describe('Sheet.Selection', () => {
  it('should update selection', () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });

    sheet.selectStart({ r: 2, c: 2 });
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 2 });
  });

  it('should move selection', () => {
    const sheet = new Sheet(new MemStore());

    sheet.move('down');
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 1 });

    sheet.move('right');
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 2 });

    sheet.move('up');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 2 });

    sheet.move('left');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });
  });

  it('should not move selection beyond sheet dimensions', () => {
    const sheet = new Sheet(new MemStore());

    sheet.move('up');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });

    sheet.move('left');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 1 });

    sheet.move('down');
    expect(sheet.getActiveCell()).toEqual({ r: 2, c: 1 });
  });

  it('should correctly move to content edge', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');

    await sheet.setData({ r: 1, c: 4 }, '40');
    await sheet.setData({ r: 1, c: 5 }, '50');
    await sheet.setData({ r: 1, c: 6 }, '60');

    await sheet.moveToEdge('right');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 2 });

    await sheet.moveToEdge('right');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 4 });

    await sheet.moveToEdge('right');
    expect(sheet.getActiveCell()).toEqual({ r: 1, c: 6 });
  });
});

describe('Sheet.SelectAll', async () => {
  const sheet = new Sheet(new MemStore());
  await sheet.setData({ r: 2, c: 2 }, 'B2');
  await sheet.setData({ r: 2, c: 3 }, 'C2');
  await sheet.setData({ r: 3, c: 2 }, 'B3');
  await sheet.setData({ r: 3, c: 3 }, 'C3');

  const tests = [
    {
      msg: 'selection is outside of the content range',
      start: { r: 1, c: 1 },
      end: { r: 1, c: 1 },
      expectedRange: sheet.dimensionRange,
    },
    {
      msg: 'selection is on the top left corner of the content range',
      start: { r: 2, c: 2 },
      end: { r: 2, c: 2 },
      expectedRange: [
        { r: 2, c: 2 },
        { r: 3, c: 3 },
      ],
    },
  ];

  for (const test of tests) {
    it(test.msg, async () => {
      await sheet.selectStart(test.start);
      await sheet.selectEnd(test.end);
      await sheet.selectAll();
      expect(sheet.getRange()).toEqual(test.expectedRange);
    });
  }
});
