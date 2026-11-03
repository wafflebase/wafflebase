import { describe, test, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';
import { YorkieStore } from '@/app/spreadsheet/yorkie-store';

/**
 * A row with no entry in `rowHeights` is sized to its content on every render,
 * while an entry holding the default is a height somebody chose. So
 * `clearDimensionSize` has to *remove* the key — writing the default back
 * would pin the row at the very moment the user asked for it to fit its data.
 *
 * `MemStore`'s copy is covered by the shared store suite; this is the
 * collaborative implementation, which deletes off a Yorkie object proxy and
 * has a second path through `beginBatch`/`endBatch`.
 *
 * These run against a local (unattached) Yorkie document: every assertion is
 * about what the update writes, which is observable without a server.
 */

const { Document } = yorkie as unknown as {
  Document: new (key: string) => never;
};

type LocalDoc = {
  update(fn: (root: Record<string, unknown>, presence: unknown) => void): void;
  getRoot(): Record<string, unknown>;
};

type Worksheet = {
  rowHeights?: Record<string, number>;
  colWidths?: Record<string, number>;
};

let docSeq = 0;

function createStore(options?: { dropMaps?: boolean }): {
  store: YorkieStore;
  rowHeights: () => Record<string, number>;
  colWidths: () => Record<string, number>;
} {
  const initial = initialSpreadsheetDocument();
  const tabId = initial.tabOrder[0];

  const doc = new Document(`dimension-size-${docSeq++}`) as unknown as LocalDoc;
  doc.update((root) => {
    for (const [key, value] of Object.entries(initial)) {
      root[key] = JSON.parse(JSON.stringify(value));
    }
  });
  if (options?.dropMaps) {
    doc.update((root) => {
      const ws = (root as unknown as { sheets: Record<string, Worksheet> })
        .sheets[tabId];
      delete ws.rowHeights;
      delete ws.colWidths;
    });
  }

  const sheet = () =>
    (doc.getRoot() as unknown as { sheets: Record<string, Worksheet> }).sheets[
      tabId
    ];
  // Read back as plain data: a Yorkie object's `toJSON` returns a *string*,
  // so `JSON.stringify` on the proxy would hand back a quoted document.
  const plain = (obj: Record<string, number> | undefined) => {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(obj ?? {})) {
      out[key] = value;
    }
    return out;
  };

  return {
    store: new YorkieStore(doc as never, tabId),
    rowHeights: () => plain(sheet().rowHeights),
    colWidths: () => plain(sheet().colWidths),
  };
}

describe('YorkieStore.clearDimensionSize', () => {
  test('removes the stored row height instead of writing the default', async () => {
    const { store, rowHeights } = createStore();
    await store.setDimensionSize('row', 2, 50);
    await store.setDimensionSize('row', 3, 80);

    await store.clearDimensionSize('row', 2);

    expect(rowHeights()).toEqual({ '3': 80 });
    const sizes = await store.getDimensionSizes('row');
    expect(sizes.has(2)).toBe(false);
    expect(sizes.get(3)).toBe(80);
  });

  test('clears a column width on the other map', async () => {
    const { store, colWidths, rowHeights } = createStore();
    await store.setDimensionSize('column', 4, 220);
    await store.setDimensionSize('row', 4, 70);

    await store.clearDimensionSize('column', 4);

    expect(colWidths()).toEqual({});
    expect(rowHeights()).toEqual({ '4': 70 });
  });

  test('is a no-op on an index that carries no size', async () => {
    const { store, rowHeights } = createStore();
    await store.setDimensionSize('row', 2, 50);

    await store.clearDimensionSize('row', 9);

    expect(rowHeights()).toEqual({ '2': 50 });
  });

  test('defers to endBatch inside a batch', async () => {
    const { store, rowHeights } = createStore();
    await store.setDimensionSize('row', 2, 50);

    store.beginBatch();
    await store.clearDimensionSize('row', 2);
    // Still stored: the batch holds one `doc.update` for everything in it.
    expect(rowHeights()).toEqual({ '2': 50 });
    store.endBatch();

    expect(rowHeights()).toEqual({});
    expect((await store.getDimensionSizes('row')).has(2)).toBe(false);
  });

  test('batches a set and a clear in document order', async () => {
    const { store, rowHeights } = createStore();

    store.beginBatch();
    await store.setDimensionSize('row', 2, 50);
    await store.clearDimensionSize('row', 2);
    await store.setDimensionSize('row', 3, 80);
    store.endBatch();

    expect(rowHeights()).toEqual({ '3': 80 });
  });

  test('tolerates a worksheet written before the maps existed', async () => {
    const { store, rowHeights } = createStore({ dropMaps: true });

    await expect(
      store.clearDimensionSize('row', 2),
    ).resolves.toBeUndefined();

    expect(rowHeights()).toEqual({});
  });
});
