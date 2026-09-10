import { describe, test, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import {
  generateBlockId,
  DEFAULT_BLOCK_STYLE,
  type Block,
} from '@wafflebase/docs';
import { YorkieDocStore } from '../../../src/app/docs/yorkie-doc-store.ts';

/**
 * `YorkieDocStore`'s `readOnly` flag keeps a share-link **viewer** from
 * publishing presence. It matters beyond tidiness: presence is written with
 * `doc.update()`, so the next `PushPull` carries it with verb `rw` — which the
 * Yorkie auth webhook, enforcing by default, refuses to a viewer, wedging that
 * viewer's own sync. `readOnlyDocStore` bounds the *document* mutators and only
 * inside the engine; the cursor publish runs from `docs-view` on the raw store,
 * so this gate is the only thing holding it back.
 *
 * The same shape as `tests/app/spreadsheet/yorkie-store-read-only.test.ts`,
 * and for the same reason: these run against a local (unattached) Yorkie
 * document, and `doc.update` calls are counted rather than emitted changes,
 * because an update that mutates nothing emits no change while still being the
 * write the webhook would see attempted.
 */

type LocalDoc = {
  update(fn: (root: Record<string, unknown>, presence: unknown) => void): void;
  getRoot(): Record<string, unknown>;
  setActor(actorID: string): void;
  addOnlineClient(clientID: string): void;
  getChangeID(): { getActorID(): string };
};

/**
 * Put a peer's presence into a local document, the way
 * `getOthersPresences()` reads it: a presence stored under an actor id that
 * is not the local one, and that actor marked online. Presence is written by
 * whichever actor the document currently is, so borrow the identity, write,
 * and hand it back.
 */
function seedPeerPresence(
  doc: LocalDoc,
  clientID: string,
  presence: Record<string, unknown>,
): void {
  const mine = doc.getChangeID().getActorID();
  doc.setActor(clientID);
  doc.update((_, p) => {
    (p as { set(next: Record<string, unknown>): void }).set(presence);
  });
  doc.setActor(mine);
  doc.addOnlineClient(clientID);
}

function makeBlock(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function createStore(readOnly: boolean): {
  store: YorkieDocStore;
  doc: LocalDoc;
  blockId: string;
  countUpdates: (fn: () => void) => number;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = new yorkie.Document<any>(
    `docs-read-only-${readOnly}-${Date.now()}-${Math.random()}`,
  ) as unknown as LocalDoc;
  doc.update((root) => {
    root.content = new yorkie.Tree({ type: 'doc', children: [] });
  });

  // Seed through a writable store: the content a viewer opens was put there by
  // an editor, so the gate under test is about presence, not about content.
  const block = makeBlock('hello world');
  new YorkieDocStore(doc as never).setDocument({ blocks: [block] });

  let updates: number | null = null;
  const update = doc.update.bind(doc) as LocalDoc['update'];
  doc.update = (fn) => {
    if (updates !== null) updates += 1;
    return update(fn);
  };

  return {
    store: new YorkieDocStore(doc as never, readOnly),
    doc,
    blockId: block.id,
    countUpdates: (fn) => {
      updates = 0;
      fn();
      const counted = updates;
      updates = null;
      return counted;
    },
  };
}

describe('YorkieDocStore readOnly — the presence publish', () => {
  test('updateCursorPos publishes on a writable mount', () => {
    const { store, blockId, countUpdates } = createStore(false);
    expect(
      countUpdates(() => store.updateCursorPos({ blockId, offset: 3 })),
    ).toBe(1);
  });

  test('updateCursorPos announces nothing on a read-only mount', () => {
    const { store, blockId, countUpdates } = createStore(true);
    // Every caret move calls this, so an ungated version is a write per
    // arrow key.
    expect(
      countUpdates(() => {
        store.updateCursorPos({ blockId, offset: 3 });
        store.updateCursorPos({ blockId, offset: 5 });
      }),
    ).toBe(0);
  });

  test('publishResolvedLocalCursor publishes on a writable mount', () => {
    const { store, blockId, countUpdates } = createStore(false);
    expect(
      countUpdates(() =>
        store.publishResolvedLocalCursor({
          cursor: { blockId, offset: 2 },
          selection: null,
        }),
      ),
    ).toBe(1);
  });

  test('publishResolvedLocalCursor is held back on a read-only mount', () => {
    const { store, blockId, countUpdates } = createStore(true);
    // Reached after every remote change, so this one fires without the viewer
    // touching anything.
    expect(
      countUpdates(() =>
        store.publishResolvedLocalCursor({
          cursor: { blockId, offset: 2 },
          selection: null,
        }),
      ),
    ).toBe(0);
  });

  test('a read-only mount still reads peer presence', () => {
    const { store, doc, blockId } = createStore(true);
    // The gate is one-directional: a viewer sees the peers they cannot
    // announce themselves to. Asserting the array-ness of the result would
    // hold with the read half gated too, so seed an actual peer and require
    // it to come back through.
    seedPeerPresence(doc, 'peer-actor-0001', {
      name: 'Peer',
      color: '#ff0000',
      activeCursorPos: { blockId, offset: 1 },
    });
    const peers = store.getPresences();
    expect(peers.map((p) => p.clientID)).toEqual(['peer-actor-0001']);
    expect(peers[0].presence.name).toBe('Peer');
    // And the viewer's own presence is not among them — they published none.
    expect(peers.length).toBe(1);
  });
});

describe('YorkieDocStore readOnly — caret anchoring still runs', () => {
  // The deliberate split: `updateCursorPos` suppresses the presence write
  // only, never the view-local anchoring that shares the method.
  // `localCursorAnchor` / `localSelectionAnchor` are what
  // `resolveAnchoredLocalCursor` reads to keep a viewer's caret and selection
  // where they were across a peer's edit — gate those too and a viewer's caret
  // jumps to the top of the document every time anyone else types.
  test('a read-only mount anchors the caret it does not publish', () => {
    const { store, blockId } = createStore(true);
    store.updateCursorPos({ blockId, offset: 4 });
    expect(store.resolveAnchoredLocalCursor().cursor).toEqual({
      blockId,
      offset: 4,
    });
  });

  test('a read-only mount anchors a selection too', () => {
    const { store, blockId } = createStore(true);
    store.updateCursorPos(
      { blockId, offset: 4 },
      { anchor: { blockId, offset: 2 }, focus: { blockId, offset: 6 } },
    );
    expect(store.resolveAnchoredLocalCursor().selection).toEqual({
      anchor: { blockId, offset: 2 },
      focus: { blockId, offset: 6 },
      tableCellRange: undefined,
    });
  });
});
