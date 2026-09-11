import { describe, test, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';
import { YorkieStore } from '@/app/spreadsheet/yorkie-store';

/**
 * `YorkieStore`'s `readOnly` flag is what keeps a share-link **viewer** from
 * writing a document they may only read. It matters beyond tidiness: with the
 * Yorkie auth webhook enforcing by default, a write by a viewer is refused at
 * the next `PushPull`, which wedges that viewer's own sync — so a stray
 * presence seed or axis-order growth costs them the document, not just the
 * write.
 *
 * These run against a local (unattached) Yorkie document: every gate here is
 * about whether a `doc.update()` is opened at all, which is observable
 * locally. `doc.update` calls are counted rather than emitted changes because
 * an update that mutates nothing emits no change while still being the write
 * the webhook would see attempted.
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

function createStore(readOnly: boolean): {
  store: YorkieStore;
  tabId: string;
  rowOrder: () => string[];
  colOrder: () => string[];
  countUpdates: (fn: () => void) => number;
  constructionUpdates: number;
} {
  const initial = initialSpreadsheetDocument();
  const tabId = initial.tabOrder[0];

  const doc = new Document(
    `read-only-${readOnly}-${docSeq++}`,
  ) as unknown as LocalDoc;
  doc.update((root) => {
    for (const [key, value] of Object.entries(initial)) {
      root[key] = JSON.parse(JSON.stringify(value));
    }
  });

  let updates: number | null = null;
  const update = doc.update.bind(doc) as LocalDoc['update'];
  doc.update = (fn) => {
    if (updates !== null) updates += 1;
    return update(fn);
  };

  const worksheet = () =>
    (
      doc.getRoot() as unknown as {
        sheets: Record<string, { rowOrder?: string[]; colOrder?: string[] }>;
      }
    ).sheets[tabId];

  updates = 0;
  const store = new YorkieStore(doc as never, tabId, readOnly);
  const constructionUpdates = updates;
  updates = null;

  return {
    store,
    tabId,
    rowOrder: () => [...(worksheet().rowOrder ?? [])],
    colOrder: () => [...(worksheet().colOrder ?? [])],
    countUpdates: (fn) => {
      updates = 0;
      fn();
      const counted = updates;
      updates = null;
      return counted;
    },
    constructionUpdates,
  };
}

describe('YorkieStore readOnly — presence and axis writes', () => {
  test('a writable mount seeds activeTabId presence at construction', () => {
    expect(createStore(false).constructionUpdates).toBe(1);
  });

  test('a read-only mount seeds no presence at construction', () => {
    expect(createStore(true).constructionUpdates).toBe(0);
  });

  test('updateSelection publishes on a writable mount', () => {
    const { store, countUpdates } = createStore(false);
    expect(
      countUpdates(() => store.updateSelection(null, [], { r: 1, c: 1 })),
    ).toBe(1);
  });

  test('updateSelection announces nothing on a read-only mount', () => {
    const { store, countUpdates } = createStore(true);
    // Every cursor move calls this, so an ungated version is a write per
    // arrow key.
    expect(
      countUpdates(() => {
        store.updateSelection(null, [], { r: 1, c: 1 });
        store.updateSelection(null, [], { r: 2, c: 3 });
      }),
    ).toBe(0);
  });

  test('ensureAxisOrder grows the root axis on a writable mount', () => {
    const { store, rowOrder, colOrder } = createStore(false);
    store.ensureAxisOrder(6, 3);
    expect(rowOrder()).toHaveLength(6);
    expect(colOrder()).toHaveLength(3);
  });

  test('ensureAxisOrder leaves the root untouched on a read-only mount', () => {
    const { store, rowOrder, colOrder, countUpdates } = createStore(true);
    const rowsBefore = rowOrder();
    const colsBefore = colOrder();

    // Reached from the same selection path as updateSelection, but it writes
    // the CRDT *root* rather than presence — so it is the more expensive leak
    // of the two.
    expect(countUpdates(() => store.ensureAxisOrder(6, 3))).toBe(0);
    expect(rowOrder()).toEqual(rowsBefore);
    expect(colOrder()).toEqual(colsBefore);
  });

  test('a read-only mount still reads presence', () => {
    const { store } = createStore(true);
    // The gate is one-directional: a viewer sees the peers they cannot
    // announce themselves to.
    expect(Array.isArray(store.getPresences())).toBe(true);
  });
});

describe('YorkieStore readOnly — comment threads', () => {
  const author = { userId: 7, username: 'viewer', photo: null };
  const anchor = (tabId: string) =>
    ({
      kind: 'sheet-cell',
      tabId,
      rowId: 'r1',
      colId: 'c1',
    }) as never;

  test('a writable mount can open a thread and reply to it', async () => {
    const { store, tabId } = createStore(false);
    store.ensureAxisOrder(2, 2);
    const thread = await store.addThread(anchor(tabId), 'hello', author as never);
    await store.addReply(thread.id, 'and again', author as never);
    const threads = await store.listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0].comments).toHaveLength(2);
  });

  test('a read-only mount refuses every comment write', async () => {
    const { store, tabId } = createStore(true);

    // The popover calls these directly rather than through the engine, so the
    // engine's own `readOnly` never sees them — this is the only gate.
    await expect(
      store.addThread(anchor(tabId), 'hello', author as never),
    ).rejects.toThrow(/read-only/);
    await expect(store.addReply('t1', 'hi', author as never)).rejects.toThrow(
      /read-only/,
    );
    await expect(store.editComment('t1', 'c1', 'edited')).rejects.toThrow(
      /read-only/,
    );
    await expect(store.deleteComment('t1', 'c1')).rejects.toThrow(/read-only/);
    await expect(
      store.setThreadResolved('t1', true, author as never),
    ).rejects.toThrow(/read-only/);
  });

  test('a read-only mount still lists the threads it may not write', async () => {
    const { store, tabId } = createStore(false);
    store.ensureAxisOrder(2, 2);
    await store.addThread(anchor(tabId), 'hello', author as never);

    // Same document, mounted read-only: reading is untouched.
    const viewer = new YorkieStore(
      (store as unknown as { doc: never }).doc,
      tabId,
      true,
    );
    expect(await viewer.listThreads()).toHaveLength(1);
  });
});
