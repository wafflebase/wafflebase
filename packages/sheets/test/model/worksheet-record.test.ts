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

  it('throws instead of hanging when the ID space is exhausted', () => {
    // The retry loop terminates only while a free ID exists. Once an axis
    // holds all 36^4 ids every draw collides, and an unbounded loop spins
    // forever holding the thread — in the backend, inside a `doc.update` on an
    // attached document, where nothing can interrupt it.
    //
    // A stand-in set rather than 1.68M real strings: `has` is the only thing
    // the generator asks it.
    const exhausted = { has: () => true } as unknown as ReadonlySet<string>;
    expect(() => createWorksheetAxisId('r', exhausted)).toThrow(/axis ID/);
  });
});
