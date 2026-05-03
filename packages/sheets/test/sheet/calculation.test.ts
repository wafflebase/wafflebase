import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/worksheet/sheet';

describe('Sheet.Calcuation', () => {
  it('should calculate cells', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '=A1+20');
    await sheet.setData({ r: 1, c: 3 }, '=B1+30');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('60');
  });

  it('should calculate cells recursively', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '=A1+20');
    await sheet.setData({ r: 1, c: 3 }, '=B1+30');
    await sheet.setData({ r: 1, c: 4 }, '=C1+40');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('60');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('100');

    await sheet.setData({ r: 1, c: 1 }, '5');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('5');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('25');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('55');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('95');
  });

  it('should handle circular dependencies', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '=B1+10');
    await sheet.setData({ r: 1, c: 2 }, '=A1+20');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('#REF!');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('#REF!');

    await sheet.setData({ r: 1, c: 1 }, '10');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('30');
  });

  it('should handle lower case references', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '=a1+30');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('40');
  });

  it('should handle string filters in references', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, 'hello');
    await sheet.setData({ r: 1, c: 4 }, '=SUM(A1:C1)');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('hello');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('30');
  });

  it('MMULT spills all elements into adjacent cells', async () => {
    const sheet = new Sheet(new MemStore());
    // A = [[1,2],[3,4]], B = [[5,6],[7,8]]
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 2, c: 1 }, '3'); await sheet.setData({ r: 2, c: 2 }, '4');
    await sheet.setData({ r: 1, c: 3 }, '5'); await sheet.setData({ r: 1, c: 4 }, '6');
    await sheet.setData({ r: 2, c: 3 }, '7'); await sheet.setData({ r: 2, c: 4 }, '8');
    // A×B = [[19,22],[43,50]]
    await sheet.setData({ r: 4, c: 1 }, '=MMULT(A1:B2,C1:D2)');

    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('19'); // [1,1] anchor
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('22'); // [1,2] ghost
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe('43'); // [2,1] ghost
    expect(await sheet.toDisplayString({ r: 5, c: 2 })).toBe('50'); // [2,2] ghost
  });

  it('MINVERSE spills all elements into adjacent cells', async () => {
    const sheet = new Sheet(new MemStore());
    // [[2,1],[1,1]] — det=1, inverse = [[1,-1],[-1,2]]
    await sheet.setData({ r: 1, c: 1 }, '2'); await sheet.setData({ r: 1, c: 2 }, '1');
    await sheet.setData({ r: 2, c: 1 }, '1'); await sheet.setData({ r: 2, c: 2 }, '1');
    await sheet.setData({ r: 4, c: 1 }, '=MINVERSE(A1:B2)');

    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('-1');
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe('-1');
    expect(await sheet.toDisplayString({ r: 5, c: 2 })).toBe('2');
  });

  it('ghost cells are cleared when spill formula is overwritten with scalar', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '0');
    await sheet.setData({ r: 2, c: 1 }, '0'); await sheet.setData({ r: 2, c: 2 }, '1');
    // Identity inverse = identity
    await sheet.setData({ r: 4, c: 1 }, '=MINVERSE(A1:B2)');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('0'); // ghost set

    // Replace with scalar formula — ghost cells must be cleared
    await sheet.setData({ r: 4, c: 1 }, '=SUM(A1:B2)');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('2');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe(''); // ghost gone
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe(''); // ghost gone
    expect(await sheet.toDisplayString({ r: 5, c: 2 })).toBe(''); // ghost gone
  });

  it('ghost cells are read-only: setData on a ghost is silently ignored', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '0');
    await sheet.setData({ r: 2, c: 1 }, '0'); await sheet.setData({ r: 2, c: 2 }, '1');
    await sheet.setData({ r: 4, c: 1 }, '=MINVERSE(A1:B2)');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('0'); // ghost

    // Attempt to overwrite a ghost cell — must be silently ignored.
    await sheet.setData({ r: 4, c: 2 }, '999');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('0'); // still ghost value
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('1'); // anchor intact
  });

  it('deleting the anchor clears all ghost cells', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '0');
    await sheet.setData({ r: 2, c: 1 }, '0'); await sheet.setData({ r: 2, c: 2 }, '1');
    await sheet.setData({ r: 4, c: 1 }, '=MINVERSE(A1:B2)');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('0'); // ghost filled

    // Delete the anchor by writing empty string.
    await sheet.setData({ r: 4, c: 1 }, '');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe(''); // anchor gone
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe(''); // ghost cleared
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe(''); // ghost cleared
    expect(await sheet.toDisplayString({ r: 5, c: 2 })).toBe(''); // ghost cleared
  });

  it('spill is blocked and shows #REF! when range contains a non-empty cell', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '0');
    await sheet.setData({ r: 2, c: 1 }, '0'); await sheet.setData({ r: 2, c: 2 }, '1');
    // Place a blocker in the spill range before entering the formula.
    await sheet.setData({ r: 5, c: 1 }, 'BLOCKER');
    await sheet.setData({ r: 4, c: 1 }, '=MINVERSE(A1:B2)');

    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('#REF!'); // blocked
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('');      // ghost not written
  });

  it('spill auto-recovers when the blocking cell is cleared', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '0');
    await sheet.setData({ r: 2, c: 1 }, '0'); await sheet.setData({ r: 2, c: 2 }, '1');
    await sheet.setData({ r: 5, c: 1 }, 'BLOCKER');
    await sheet.setData({ r: 4, c: 1 }, '=MINVERSE(A1:B2)');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('#REF!');

    // Clear the blocker — spill should fill automatically.
    await sheet.setData({ r: 5, c: 1 }, '');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('0');
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe('0');
    expect(await sheet.toDisplayString({ r: 5, c: 2 })).toBe('1');
  });

  it('overwriting a blocked anchor preserves user data in the spill zone', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '0');
    await sheet.setData({ r: 2, c: 1 }, '0'); await sheet.setData({ r: 2, c: 2 }, '1');
    // Place a blocker that prevents the 2x2 spill at A4:B5.
    await sheet.setData({ r: 5, c: 1 }, 'BLOCKER');
    await sheet.setData({ r: 4, c: 1 }, '=MINVERSE(A1:B2)');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('#REF!');

    // Overwrite the blocked anchor with a scalar — the blocker MUST survive
    // because it is user data, not a ghost cell.
    await sheet.setData({ r: 4, c: 1 }, '7');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('7');
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe('BLOCKER');
  });

  it('clearing a blocked anchor preserves user data in the spill zone', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '0');
    await sheet.setData({ r: 2, c: 1 }, '0'); await sheet.setData({ r: 2, c: 2 }, '1');
    await sheet.setData({ r: 5, c: 1 }, 'BLOCKER');
    await sheet.setData({ r: 4, c: 1 }, '=MINVERSE(A1:B2)');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('#REF!');

    // Clearing the blocked anchor must NOT delete the user-entered blocker.
    await sheet.setData({ r: 4, c: 1 }, '');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 5, c: 1 })).toBe('BLOCKER');
  });

  it('MUNIT spills identity matrix into adjacent cells', async () => {
    const sheet = new Sheet(new MemStore());
    // =MUNIT(3) at A1 should spill a 3×3 identity matrix
    await sheet.setData({ r: 1, c: 1 }, '=MUNIT(3)');

    // Diagonal = 1, off-diagonal = 0
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('1'); // anchor [1,1]
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('0'); // [1,2] ghost
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('0'); // [1,3] ghost
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('0'); // [2,1] ghost
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('1'); // [2,2] ghost
    expect(await sheet.toDisplayString({ r: 2, c: 3 })).toBe('0'); // [2,3] ghost
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('0'); // [3,1] ghost
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('0'); // [3,2] ghost
    expect(await sheet.toDisplayString({ r: 3, c: 3 })).toBe('1'); // [3,3] ghost
  });

  it('MMULT(A, MUNIT(n)) spills a matrix equal to A', async () => {
    const sheet = new Sheet(new MemStore());
    // A = [[3,7],[1,5]]
    await sheet.setData({ r: 1, c: 1 }, '3'); await sheet.setData({ r: 1, c: 2 }, '7');
    await sheet.setData({ r: 2, c: 1 }, '1'); await sheet.setData({ r: 2, c: 2 }, '5');
    // A · I₂ = A, spilled at D1
    await sheet.setData({ r: 1, c: 4 }, '=MMULT(A1:B2,MUNIT(2))');

    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('3');
    expect(await sheet.toDisplayString({ r: 1, c: 5 })).toBe('7');
    expect(await sheet.toDisplayString({ r: 2, c: 4 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 2, c: 5 })).toBe('5');
  });

  it('TRANSPOSE spills the transposed matrix into adjacent cells', async () => {
    const sheet = new Sheet(new MemStore());
    // Source: [[1,2,3],[4,5,6]] in A1:C2
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '2'); await sheet.setData({ r: 1, c: 3 }, '3');
    await sheet.setData({ r: 2, c: 1 }, '4'); await sheet.setData({ r: 2, c: 2 }, '5'); await sheet.setData({ r: 2, c: 3 }, '6');
    // =TRANSPOSE(A1:C2) at E1 → spills 3×2 transposed matrix
    await sheet.setData({ r: 1, c: 5 }, '=TRANSPOSE(A1:C2)');

    // Transposed: [[1,4],[2,5],[3,6]]
    expect(await sheet.toDisplayString({ r: 1, c: 5 })).toBe('1'); // anchor [1,1]
    expect(await sheet.toDisplayString({ r: 1, c: 6 })).toBe('4'); // [1,2] ghost
    expect(await sheet.toDisplayString({ r: 2, c: 5 })).toBe('2'); // [2,1] ghost
    expect(await sheet.toDisplayString({ r: 2, c: 6 })).toBe('5'); // [2,2] ghost
    expect(await sheet.toDisplayString({ r: 3, c: 5 })).toBe('3'); // [3,1] ghost
    expect(await sheet.toDisplayString({ r: 3, c: 6 })).toBe('6'); // [3,2] ghost
  });

  it('TRANSPOSE ghost cells are read-only', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1'); await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 2, c: 1 }, '3'); await sheet.setData({ r: 2, c: 2 }, '4');
    await sheet.setData({ r: 1, c: 4 }, '=TRANSPOSE(A1:B2)');

    // Ghost at D2 = 2 (original B1)
    expect(await sheet.toDisplayString({ r: 2, c: 4 })).toBe('2');
    await sheet.setData({ r: 2, c: 4 }, '999');
    expect(await sheet.toDisplayString({ r: 2, c: 4 })).toBe('2'); // still ghost
  });

  it('should handle invalid value: range without array function', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 1, c: 3 }, '=A1:B1');

    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('#VALUE!');

    await sheet.setData({ r: 1, c: 4 }, '=A1:B1+A1:B1');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('#VALUE!');
  });
});
