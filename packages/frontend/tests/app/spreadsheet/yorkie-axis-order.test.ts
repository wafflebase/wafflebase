import { test, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';
import { YorkieStore } from '@/app/spreadsheet/yorkie-store';

/**
 * `ensureAxisOrder` is dense: covering visual row N costs N entries in the
 * `rowOrder` CRDT array. Every arrow key re-publishes the selection and so
 * calls it again, which used to rebuild a `Set` over the whole axis even when
 * coverage already sufficed (measured 318 ms per call at 1M entries).
 *
 * `Sheet` is what bounds how much coverage is ever requested — see
 * `MaxAxisCoverage` and its tests in packages/sheets. These tests cover the
 * store side of that contract, and run against a local (unattached) Yorkie
 * document: the cost was in local CRDT mutation, so no server is needed.
 */

const { Document } = yorkie as unknown as {
  Document: new (key: string) => never;
};

type LocalDoc = {
  update(fn: (root: Record<string, unknown>) => void): void;
  getRoot(): Record<string, unknown>;
  subscribe(fn: (event: { type: string }) => void): () => void;
};

function createLocalStore(): {
  store: YorkieStore;
  rowOrder: () => string[];
  colOrder: () => string[];
  countUpdates: (fn: () => void) => number;
} {
  const initial = initialSpreadsheetDocument();
  const tabId = initial.tabOrder[0];

  const doc = new Document(`axis-order-${tabId}`) as unknown as LocalDoc;
  doc.update((root) => {
    for (const [key, value] of Object.entries(initial)) {
      root[key] = JSON.parse(JSON.stringify(value));
    }
  });

  // Count `doc.update` calls rather than emitted changes: an update that
  // mutates nothing still costs the walk over the axis inside it, but emits
  // no change event, so events cannot see the difference.
  let updates: number | null = null;
  const update = doc.update.bind(doc) as LocalDoc['update'];
  doc.update = (fn) => {
    if (updates !== null) updates += 1;
    return update(fn);
  };

  const worksheet = () =>
    (doc.getRoot() as unknown as {
      sheets: Record<string, { rowOrder?: string[]; colOrder?: string[] }>;
    }).sheets[tabId];

  return {
    store: new YorkieStore(doc as never, tabId),
    rowOrder: () => [...(worksheet().rowOrder ?? [])],
    colOrder: () => [...(worksheet().colOrder ?? [])],
    countUpdates: (fn) => {
      updates = 0;
      fn();
      const counted = updates;
      updates = null;
      return counted;
    },
  };
}

test('ensureAxisOrder materializes the coverage it is asked for', () => {
  const { store, rowOrder, colOrder } = createLocalStore();

  store.ensureAxisOrder(10, 5);

  expect(rowOrder()).toHaveLength(10);
  expect(colOrder()).toHaveLength(5);
  // IDs are unique, so a selection anchor identifies exactly one row.
  expect(new Set(rowOrder()).size).toBe(10);
});

test('ensureAxisOrder makes no change when coverage already suffices', () => {
  const { store, rowOrder, countUpdates } = createLocalStore();

  store.ensureAxisOrder(10, 5);
  const before = rowOrder();

  // Every arrow key calls this; a satisfied call must not open a document
  // update, which would walk the whole axis to rebuild the ID set.
  const updates = countUpdates(() => {
    store.ensureAxisOrder(10, 5);
    store.ensureAxisOrder(3, 1);
  });

  expect(updates).toBe(0);
  expect(rowOrder()).toEqual(before);
});

test('ensureAxisOrder extends without renaming the IDs already published', () => {
  const { store, rowOrder } = createLocalStore();

  store.ensureAxisOrder(4, 2);
  const before = rowOrder();
  store.ensureAxisOrder(8, 2);

  // Anchors published earlier keep pointing at the same rows.
  expect(rowOrder().slice(0, 4)).toEqual(before);
  expect(rowOrder()).toHaveLength(8);
});
