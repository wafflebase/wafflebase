import { describe, it, expect } from 'vitest';
import { Store } from '../../src/store/store';
import { MemStore } from '../../src/store/memory';

describe('MemStore', () => {
  runTests(async () => new MemStore());
});

function runTests(createStore: (key: string) => Promise<Store>) {
  it('should contain data after set', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 2, c: 1 }, { v: '30' });
    expect(await store.has({ r: 2, c: 1 })).toBe(true);
  });

  it('should not contain data after delete', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 3, c: 1 }, { v: '40' });
    await store.delete({ r: 3, c: 1 });
    expect(await store.has({ r: 3, c: 1 })).toBe(false);
  });

  it('should contain data after multiple sets', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 4, c: 1 }, { v: '50' });
    await store.set({ r: 4, c: 1 }, { v: '60' });
    expect(await store.get({ r: 4, c: 1 })).toEqual({ v: '60' });
  });

  it('should not contain data after multiple deletes', async function ({
    task,
  }) {
    const store = await createStore(task.name);
    await store.set({ r: 5, c: 1 }, { v: '70' });
    await store.delete({ r: 5, c: 1 });
    await store.delete({ r: 5, c: 1 });
    expect(await store.has({ r: 5, c: 1 })).toBe(false);
  });

  it('should shift cells down on row insert', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 1, c: 1 }, { v: '10' });
    await store.set({ r: 2, c: 1 }, { v: '20' });

    await store.shiftCells('row', 2, 1);

    expect(await store.get({ r: 1, c: 1 })).toEqual({ v: '10' });
    expect(await store.has({ r: 2, c: 1 })).toBe(false);
    expect(await store.get({ r: 3, c: 1 })).toEqual({ v: '20' });
  });

  it('should shift cells up on row delete', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 1, c: 1 }, { v: '10' });
    await store.set({ r: 2, c: 1 }, { v: '20' });
    await store.set({ r: 3, c: 1 }, { v: '30' });

    await store.shiftCells('row', 2, -1);

    expect(await store.get({ r: 1, c: 1 })).toEqual({ v: '10' });
    expect(await store.get({ r: 2, c: 1 })).toEqual({ v: '30' });
    expect(await store.has({ r: 3, c: 1 })).toBe(false);
  });

  it('should shift cells right on column insert', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 1, c: 1 }, { v: '10' });
    await store.set({ r: 1, c: 2 }, { v: '20' });

    await store.shiftCells('column', 2, 1);

    expect(await store.get({ r: 1, c: 1 })).toEqual({ v: '10' });
    expect(await store.has({ r: 1, c: 2 })).toBe(false);
    expect(await store.get({ r: 1, c: 3 })).toEqual({ v: '20' });
  });

  it('should shift row dimension sizes on row insert', async function ({ task }) {
    const store = await createStore(task.name);
    await store.setDimensionSize('row', 2, 50);
    await store.setDimensionSize('row', 4, 80);

    await store.shiftCells('row', 2, 1);

    const sizes = await store.getDimensionSizes('row');
    expect(sizes.has(2)).toBe(false);
    expect(sizes.get(3)).toBe(50);
    expect(sizes.get(5)).toBe(80);
  });

  it('should shift row dimension sizes on row delete', async function ({ task }) {
    const store = await createStore(task.name);
    await store.setDimensionSize('row', 2, 50);
    await store.setDimensionSize('row', 3, 80);

    await store.shiftCells('row', 2, -1);

    const sizes = await store.getDimensionSizes('row');
    expect(sizes.has(3)).toBe(false);
    expect(sizes.get(2)).toBe(80);
  });

  it('should shift column dimension sizes on column insert', async function ({ task }) {
    const store = await createStore(task.name);
    await store.setDimensionSize('column', 3, 200);

    await store.shiftCells('column', 2, 1);

    const sizes = await store.getDimensionSizes('column');
    expect(sizes.has(3)).toBe(false);
    expect(sizes.get(4)).toBe(200);
  });

  it('should delete only cells within range', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 1, c: 1 }, { v: '10' });
    await store.set({ r: 2, c: 2 }, { v: '20' });
    await store.set({ r: 3, c: 3 }, { v: '30' });

    const deleted = await store.deleteRange([{ r: 1, c: 1 }, { r: 2, c: 2 }]);

    expect(deleted.size).toBe(2);
    expect(await store.has({ r: 1, c: 1 })).toBe(false);
    expect(await store.has({ r: 2, c: 2 })).toBe(false);
    expect(await store.has({ r: 3, c: 3 })).toBe(true);
  });

  it('should return empty set when no cells in range', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 1, c: 1 }, { v: '10' });

    const deleted = await store.deleteRange([{ r: 5, c: 5 }, { r: 10, c: 10 }]);

    expect(deleted.size).toBe(0);
    expect(await store.has({ r: 1, c: 1 })).toBe(true);
  });

  it('should delete single cell with single-cell range', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 2, c: 3 }, { v: '42' });

    const deleted = await store.deleteRange([{ r: 2, c: 3 }, { r: 2, c: 3 }]);

    expect(deleted.size).toBe(1);
    expect(await store.has({ r: 2, c: 3 })).toBe(false);
  });

  it('should not shift dimension sizes of unaffected axis', async function ({ task }) {
    const store = await createStore(task.name);
    await store.setDimensionSize('row', 2, 50);
    await store.setDimensionSize('column', 3, 200);

    await store.shiftCells('row', 2, 1);

    // Row sizes should shift
    const rowSizes = await store.getDimensionSizes('row');
    expect(rowSizes.get(3)).toBe(50);

    // Column sizes should remain unchanged
    const colSizes = await store.getDimensionSizes('column');
    expect(colSizes.get(3)).toBe(200);
  });

  // Dimension for findEdge tests: rows 1..100, cols 1..26
  const dim: [{ r: number; c: number }, { r: number; c: number }] = [
    { r: 1, c: 1 },
    { r: 100, c: 26 },
  ];

  it('should findEdge to boundary on empty row', async function ({ task }) {
    const store = await createStore(task.name);
    const result = await store.findEdge({ r: 5, c: 5 }, 'down', dim);
    expect(result).toEqual({ r: 100, c: 5 });
  });

  it('should findEdge to end of consecutive block going down', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 3, c: 1 }, { v: 'a' });
    await store.set({ r: 4, c: 1 }, { v: 'b' });
    await store.set({ r: 5, c: 1 }, { v: 'c' });

    const result = await store.findEdge({ r: 3, c: 1 }, 'down', dim);
    expect(result).toEqual({ r: 5, c: 1 });
  });

  it('should findEdge to end of consecutive block going up', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 3, c: 1 }, { v: 'a' });
    await store.set({ r: 4, c: 1 }, { v: 'b' });
    await store.set({ r: 5, c: 1 }, { v: 'c' });

    const result = await store.findEdge({ r: 5, c: 1 }, 'up', dim);
    expect(result).toEqual({ r: 3, c: 1 });
  });

  it('should findEdge jump over gap to next block', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 2, c: 1 }, { v: 'a' });
    await store.set({ r: 3, c: 1 }, { v: 'b' });
    await store.set({ r: 7, c: 1 }, { v: 'c' });
    await store.set({ r: 8, c: 1 }, { v: 'd' });

    const result = await store.findEdge({ r: 3, c: 1 }, 'down', dim);
    expect(result).toEqual({ r: 7, c: 1 });
  });

  it('should findEdge from empty cell to next data block', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 5, c: 1 }, { v: 'a' });
    await store.set({ r: 6, c: 1 }, { v: 'b' });

    const result = await store.findEdge({ r: 1, c: 1 }, 'down', dim);
    expect(result).toEqual({ r: 5, c: 1 });
  });

  it('should findEdge to boundary when no data ahead', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 2, c: 1 }, { v: 'a' });

    const result = await store.findEdge({ r: 5, c: 1 }, 'down', dim);
    expect(result).toEqual({ r: 100, c: 1 });
  });

  it('should findEdge right to end of block', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 1, c: 3 }, { v: 'a' });
    await store.set({ r: 1, c: 4 }, { v: 'b' });
    await store.set({ r: 1, c: 5 }, { v: 'c' });

    const result = await store.findEdge({ r: 1, c: 3 }, 'right', dim);
    expect(result).toEqual({ r: 1, c: 5 });
  });

  it('should findEdge left to end of block', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set({ r: 1, c: 3 }, { v: 'a' });
    await store.set({ r: 1, c: 4 }, { v: 'b' });
    await store.set({ r: 1, c: 5 }, { v: 'c' });

    const result = await store.findEdge({ r: 1, c: 5 }, 'left', dim);
    expect(result).toEqual({ r: 1, c: 3 });
  });
}
