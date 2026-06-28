import { describe, it, expect } from 'vitest';
import { createWorksheetAxisId } from '../../src/model/workbook/worksheet-record';

describe('createWorksheetAxisId', () => {
  it('should generate an ID with the given prefix', () => {
    const rowId = createWorksheetAxisId('r');
    expect(rowId).toMatch(/^r[a-z0-9]{4}$/);

    const colId = createWorksheetAxisId('c');
    expect(colId).toMatch(/^c[a-z0-9]{4}$/);
  });

  it('should generate IDs unique against the provided existing set', () => {
    // The random space (36^4 ≈ 1.68M) is small enough to hit the birthday
    // paradox, so callers pass the IDs already in use to guarantee no
    // collision. Threading the growing set must yield N distinct IDs.
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(createWorksheetAxisId('r', ids));
    }
    expect(ids.size).toBe(1000);
  });
});
