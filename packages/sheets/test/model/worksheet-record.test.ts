import { describe, it, expect } from 'vitest';
import { createWorksheetAxisId } from '../../src/model/workbook/worksheet-record';

describe('createWorksheetAxisId', () => {
  it('should generate an ID with the given prefix', () => {
    const rowId = createWorksheetAxisId('r');
    expect(rowId).toMatch(/^r[a-z0-9]{4}$/);

    const colId = createWorksheetAxisId('c');
    expect(colId).toMatch(/^c[a-z0-9]{4}$/);
  });

  it('should generate unique IDs across typical batch size', () => {
    // A single user operation creates at most ~100 rows at once.
    // With 36^4 ≈ 1.68M combinations, 100 IDs should never collide.
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(createWorksheetAxisId('r'));
    }
    expect(ids.size).toBe(100);
  });
});
