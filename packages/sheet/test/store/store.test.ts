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
}
