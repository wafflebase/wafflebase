import { describe, it, expect } from 'vitest';
import { Cell, Ref } from '../../src/sheet/types';
import { Store } from '../../src/store/store';
import { createIDBStore } from '../../src/store/idb';
import { createCachedIDBStore } from '../../src/store/cachedidb';
import { MemStore } from '../../src/store/memory';

describe('MemStore', () => {
  runTests(async () => new MemStore());
});

describe('IDBStore', () => {
  runTests(async (key: string) => createIDBStore(key));
});

describe('CachedIDBStore', () => {
  runTests(async (key: string) => createCachedIDBStore(key));
});

function runTests(createStore: (key: string) => Promise<Store>) {
  it('should contain data after set', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set('A2', { v: '30' });
    expect(await store.has('A2')).toBe(true);
  });

  it('should not contain data after delete', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set('A3', { v: '40' });
    await store.delete('A3');
    expect(await store.has('A3')).toBe(false);
  });

  it('should contain data after multiple sets', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set('A4', { v: '50' });
    await store.set('A4', { v: '60' });
    expect(await store.get('A4')).toEqual({ v: '60' });
  });

  it('should not contain data after multiple deletes', async function ({
    task,
  }) {
    const store = await createStore(task.name);
    await store.set('A5', { v: '70' });
    await store.delete('A5');
    await store.delete('A5');
    expect(await store.has('A5')).toBe(false);
  });

  it('should iterate over all data', async function ({ task }) {
    const store = await createStore(task.name);
    await store.set('A6', { v: '80' });
    await store.set('A7', { v: '90' });

    const data: Array<[Ref, Cell]> = [];
    for await (const [ref, cell] of store) {
      data.push([ref, cell]);
    }

    expect(data).toEqual([
      ['A6', { v: '80' }],
      ['A7', { v: '90' }],
    ]);
  });
}
