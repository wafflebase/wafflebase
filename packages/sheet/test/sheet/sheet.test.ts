import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/worksheet/sheet';

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

describe('Sheet.RemoveData', () => {
  it('should remove data in selected range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 2, c: 1 }, '30');
    await sheet.setData({ r: 3, c: 3 }, '40');

    // Select range A1:B2
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    const removed = await sheet.removeData();
    expect(removed).toBe(true);

    // Cells inside range should be deleted
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('');

    // Cell outside range should remain
    expect(await sheet.toDisplayString({ r: 3, c: 3 })).toBe('40');
  });

  it('should remove active cell data when no range is selected', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');

    sheet.selectStart({ r: 1, c: 1 });

    const removed = await sheet.removeData();
    expect(removed).toBe(true);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('20');
  });

  it('should return false when no data to remove', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 5, c: 5 });

    const removed = await sheet.removeData();
    expect(removed).toBe(false);
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

  it('ignores style-only cells when expanding content range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 2, c: 2 }, 'B2');
    await sheet.setData({ r: 2, c: 3 }, 'C2');
    await sheet.setData({ r: 3, c: 2 }, 'B3');
    await sheet.setData({ r: 3, c: 3 }, 'C3');
    await sheet.setStyle({ r: 4, c: 2 }, { bg: '#ff0000' });

    sheet.selectStart({ r: 2, c: 2 });
    await sheet.selectAll();

    expect(sheet.getRange()).toEqual([
      { r: 2, c: 2 },
      { r: 3, c: 3 },
    ]);
  });
});

describe('Sheet.MultiSelection', () => {
  it('should add a new selection range with addSelection', () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    // Add a second selection
    sheet.addSelection({ r: 5, c: 5 });

    const ranges = sheet.getRanges();
    expect(ranges).toHaveLength(2);
    // First range: A1:B2
    expect(ranges[0]).toEqual([{ r: 1, c: 1 }, { r: 2, c: 2 }]);
    // Second range: collapsed at E5
    expect(ranges[1]).toEqual([{ r: 5, c: 5 }, { r: 5, c: 5 }]);
  });

  it('should move activeCell to the start of the last added range', () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.addSelection({ r: 3, c: 4 });

    expect(sheet.getActiveCell()).toEqual({ r: 3, c: 4 });
  });

  it('should extend the last range with addSelectionEnd', () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });
    sheet.addSelection({ r: 5, c: 5 });
    sheet.addSelectionEnd({ r: 7, c: 7 });

    const ranges = sheet.getRanges();
    expect(ranges).toHaveLength(2);
    expect(ranges[1]).toEqual([{ r: 5, c: 5 }, { r: 7, c: 7 }]);
  });

  it('should preserve existing selection when starting addSelection with no range', () => {
    const sheet = new Sheet(new MemStore());
    // Only activeCell, no range
    sheet.selectStart({ r: 1, c: 1 });
    expect(sheet.hasRange()).toBe(false);

    sheet.addSelection({ r: 3, c: 3 });
    const ranges = sheet.getRanges();
    // Should have two ranges: the frozen activeCell and the new one
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual([{ r: 1, c: 1 }, { r: 1, c: 1 }]);
    expect(ranges[1]).toEqual([{ r: 3, c: 3 }, { r: 3, c: 3 }]);
  });

  it('should clear all ranges on selectStart', () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });
    sheet.addSelection({ r: 5, c: 5 });

    // selectStart resets everything
    sheet.selectStart({ r: 10, c: 10 });
    expect(sheet.getRanges()).toHaveLength(0);
    expect(sheet.hasRange()).toBe(false);
  });

  it('getRange returns the last range for backward compatibility', () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });
    sheet.addSelection({ r: 5, c: 5 });
    sheet.addSelectionEnd({ r: 6, c: 6 });

    expect(sheet.getRange()).toEqual([{ r: 5, c: 5 }, { r: 6, c: 6 }]);
  });
});
