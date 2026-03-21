import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/worksheet/sheet';

describe('Sheet.findCells', () => {
  it('should find cells matching a query (case-insensitive)', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Hello');
    await sheet.setData({ r: 1, c: 2 }, 'World');
    await sheet.setData({ r: 2, c: 1 }, 'hello world');
    await sheet.setData({ r: 3, c: 3 }, 'Goodbye');

    const results = await sheet.findCells('hello');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ r: 1, c: 1 });
    expect(results[1]).toEqual({ r: 2, c: 1 });
  });

  it('should find cells with case-sensitive search', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Hello');
    await sheet.setData({ r: 2, c: 1 }, 'hello');

    const results = await sheet.findCells('Hello', { caseSensitive: true });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ r: 1, c: 1 });
  });

  it('should return empty array for no matches', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Hello');

    const results = await sheet.findCells('xyz');
    expect(results).toHaveLength(0);
  });

  it('should return empty array for empty query', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Hello');

    const results = await sheet.findCells('');
    expect(results).toHaveLength(0);
  });

  it('should return results in row-major order', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 3, c: 1 }, 'test');
    await sheet.setData({ r: 1, c: 2 }, 'test');
    await sheet.setData({ r: 1, c: 1 }, 'test');
    await sheet.setData({ r: 2, c: 3 }, 'test');

    const results = await sheet.findCells('test');
    expect(results).toEqual([
      { r: 1, c: 1 },
      { r: 1, c: 2 },
      { r: 2, c: 3 },
      { r: 3, c: 1 },
    ]);
  });

  it('should match partial strings', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'Hello World');
    await sheet.setData({ r: 1, c: 2 }, 'Goodbye');

    const results = await sheet.findCells('llo');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ r: 1, c: 1 });
  });
});
