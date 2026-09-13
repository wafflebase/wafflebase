import { describe, test, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import {
  MaxMergeCoveredCells,
  MaxMergeEntries,
  MaxMergedCells,
  initialSpreadsheetDocument,
  type MergeSpan,
} from '@wafflebase/sheets';
import { YorkieStore } from '@/app/spreadsheet/yorkie-store';

/**
 * `YorkieStore` is the one writer of the merge map that reaches the CRDT
 * directly from the browser, so it carries the same budget the engine, the
 * XLSX importer and the v1 `PUT merges` validator spend — a map bigger than
 * `rebuildMergeCoverMap` can walk is not a large sheet, it is a tab that stops
 * opening for every collaborator.
 *
 * Two things make this worth testing here rather than trusting the engine's
 * copy: the refusal is *returned* (a caller mirroring the map in memory has to
 * learn its block was dropped), and a batch — what a paste is — budgets against
 * the map it is building rather than the one still on disk.
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
  subscribe(fn: (event: { type: string }) => void): () => void;
};

let docSeq = 0;

function createStore(seedMerges: Record<string, MergeSpan> = {}): {
  store: YorkieStore;
  merges: () => Record<string, MergeSpan>;
} {
  const initial = initialSpreadsheetDocument();
  const tabId = initial.tabOrder[0];

  const doc = new Document(`merge-budget-${docSeq++}`) as unknown as LocalDoc;
  doc.update((root) => {
    for (const [key, value] of Object.entries(initial)) {
      root[key] = JSON.parse(JSON.stringify(value));
    }
  });
  if (Object.keys(seedMerges).length > 0) {
    doc.update((root) => {
      (
        root as unknown as {
          sheets: Record<string, { merges?: Record<string, MergeSpan> }>;
        }
      ).sheets[tabId].merges = seedMerges;
    });
  }

  const store = new YorkieStore(doc as never, tabId);
  return {
    store,
    // Read back as plain data: a Yorkie object's `toJSON` returns a *string*,
    // so `JSON.stringify` on the proxy would hand back a quoted document.
    merges: () => {
      const stored =
        (
          doc.getRoot() as unknown as {
            sheets: Record<string, { merges?: Record<string, MergeSpan> }>;
          }
        ).sheets[tabId].merges ?? {};
      const plain: Record<string, MergeSpan> = {};
      for (const [sref, span] of Object.entries(stored)) {
        plain[sref] = { rs: span.rs, cs: span.cs };
      }
      return plain;
    },
  };
}

/** Ten blocks of `MaxMergedCells` cells: the covered-cell budget, exactly spent. */
function fullCoverBlocks(): Record<string, MergeSpan> {
  const merges: Record<string, MergeSpan> = {};
  const count = MaxMergeCoveredCells / MaxMergedCells;
  for (let i = 0; i < count; i++) {
    merges[`A${1 + i * MaxMergedCells}`] = { rs: MaxMergedCells, cs: 1 };
  }
  return merges;
}

describe('YorkieStore.setMerge — the budget', () => {
  test('stores a block it can afford and reports it kept', async () => {
    const { store, merges } = createStore();
    expect(await store.setMerge({ r: 1, c: 1 }, { rs: 2, cs: 3 })).toBe(true);
    expect(merges()).toEqual({ A1: { rs: 2, cs: 3 } });
  });

  test('refuses a span above the per-span cap and writes nothing', async () => {
    const { store, merges } = createStore();
    expect(
      await store.setMerge({ r: 1, c: 1 }, { rs: MaxMergedCells + 1, cs: 1 }),
    ).toBe(false);
    expect(merges()).toEqual({});
  });

  test('refuses once the map holds the entry cap', async () => {
    const seeded: Record<string, MergeSpan> = {};
    for (let i = 0; i < MaxMergeEntries; i++) {
      seeded[`A${1 + i * 2}`] = { rs: 2, cs: 1 };
    }
    const { store } = createStore(seeded);
    expect(await store.setMerge({ r: 100001, c: 1 }, { rs: 2, cs: 1 })).toBe(
      false,
    );
  });

  test('refuses once the map covers the cell cap', async () => {
    const { store, merges } = createStore(fullCoverBlocks());
    expect(await store.setMerge({ r: 950001, c: 1 }, { rs: 2, cs: 1 })).toBe(
      false,
    );
    expect(Object.keys(merges())).toHaveLength(
      MaxMergeCoveredCells / MaxMergedCells,
    );
  });

  test('re-anchoring spends a block it does not add to', async () => {
    // The map is at the covered-cell cap. Re-writing one of its own anchors
    // with an equally large span keeps it at the cap — counting the existing
    // span as well as the new one would refuse a merge that costs nothing.
    const { store, merges } = createStore(fullCoverBlocks());
    expect(
      await store.setMerge({ r: 1, c: 1 }, { rs: MaxMergedCells, cs: 1 }),
    ).toBe(true);
    expect(merges().A1).toEqual({ rs: MaxMergedCells, cs: 1 });
  });
});

describe('YorkieStore.setMerge — inside a batch', () => {
  test('budgets a block against the map the batch is building', async () => {
    // A paste queues many blocks in one update, and the document carries none
    // of them until the flush — so without the overlay each would be budgeted
    // against the same empty map and the batch could spend the cap ten times
    // over.
    const { store, merges } = createStore();
    store.beginBatch();
    const kept: boolean[] = [];
    for (let i = 0; i < MaxMergeCoveredCells / MaxMergedCells; i++) {
      kept.push(
        await store.setMerge(
          { r: 1 + i * MaxMergedCells, c: 1 },
          { rs: MaxMergedCells, cs: 1 },
        ),
      );
    }
    const overflow = await store.setMerge(
      { r: 950001, c: 1 },
      { rs: 2, cs: 1 },
    );
    store.endBatch();

    expect(kept.every(Boolean)).toBe(true);
    expect(overflow).toBe(false);
    // The refused block is absent from the flush, not merely reported as
    // refused.
    expect(merges()['A950001']).toBeUndefined();
    expect(Object.keys(merges())).toHaveLength(
      MaxMergeCoveredCells / MaxMergedCells,
    );
  });

  test('deleting a block queued by the same batch reports it deleted', async () => {
    const { store, merges } = createStore();
    store.beginBatch();
    await store.setMerge({ r: 1, c: 1 }, { rs: 2, cs: 2 });
    // The document does not hold A1 yet — only the batch does. Consulting the
    // document here would report nothing to delete and leave the queued write
    // to land after it.
    expect(await store.deleteMerge({ r: 1, c: 1 })).toBe(true);
    store.endBatch();

    expect(merges().A1).toBeUndefined();
  });

  test('deleting inside a batch frees the budget it spent', async () => {
    const { store, merges } = createStore(fullCoverBlocks());
    store.beginBatch();
    expect(await store.setMerge({ r: 950001, c: 1 }, { rs: 2, cs: 1 })).toBe(
      false,
    );
    expect(await store.deleteMerge({ r: 1, c: 1 })).toBe(true);
    expect(await store.setMerge({ r: 950001, c: 1 }, { rs: 2, cs: 1 })).toBe(
      true,
    );
    store.endBatch();

    expect(merges().A1).toBeUndefined();
    expect(merges()['A950001']).toEqual({ rs: 2, cs: 1 });
  });

  test('reports nothing to delete for an anchor no one merged', async () => {
    const { store } = createStore();
    store.beginBatch();
    expect(await store.deleteMerge({ r: 4, c: 4 })).toBe(false);
    store.endBatch();
  });
});
