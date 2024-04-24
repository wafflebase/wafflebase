import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { IDBStore, createIDBStore } from '../../src/store/idb';

describe('Memstore', () => {
  it('should correctly set and remove data', () => {
    const mem = new MemStore();

    mem.set('A1', { v: '10' });
    expect(mem.get('A1')).toEqual({ v: '10' });
    expect(mem.has('A1')).toBe(true);
    expect(mem.has('B1')).toBe(false);

    mem.set('A1', { v: '20' });
    expect(mem.get('A1')).toEqual({ v: '20' });

    mem.delete('A1');
    expect(mem.has('A1')).toBe(false);
    mem.delete('A1');
    expect(mem.has('A1')).toBe(false);
  });
});

describe('IDBStore', () => {
  it('should correctly set and remove data', async () => {
    const store = await createIDBStore();

    await store.set('A1', { v: '10' });
    expect(await store.get('A1')).toEqual({ v: '10' });
    expect(await store.has('A1')).toBe(true);
    expect(await store.has('B1')).toBe(false);

    await store.set('A1', { v: '20' });
    expect(await store.get('A1')).toEqual({ v: '20' });
  });
});