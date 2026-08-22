import { describe, it, expect } from 'vitest';
import { Document, Text } from '@yorkie-js/sdk';
import type { NoteRemoteChange } from '@wafflebase/notes';
import { YorkieNoteStore } from './yorkie-note-store';
import type { YorkieNotesRoot, NotesPresence } from '@/types/notes-document';

function makeDoc(): Document<YorkieNotesRoot, NotesPresence> {
  const doc = new Document<YorkieNotesRoot, NotesPresence>('note-test');
  doc.update((root) => {
    root.content = new Text();
    root.content.edit(0, 0, 'hello');
  });
  return doc;
}

/**
 * Two documents on the same key with distinct actors, seeded with `text` and
 * already in sync — a peer session without a Yorkie server. `push` moves one
 * side's local changes to the other, standing in for a round trip.
 */
function twoClients(
  text: string,
): [Document<YorkieNotesRoot, NotesPresence>, Document<YorkieNotesRoot, NotesPresence>] {
  const mine = new Document<YorkieNotesRoot, NotesPresence>('note-peers');
  const peer = new Document<YorkieNotesRoot, NotesPresence>('note-peers');
  mine.setActor('000000000000000000000001');
  peer.setActor('000000000000000000000002');
  mine.update((root) => {
    root.content = new Text();
    root.content.edit(0, 0, text);
  });
  push(mine, peer);
  return [mine, peer];
}

function push(
  from: Document<YorkieNotesRoot, NotesPresence>,
  to: Document<YorkieNotesRoot, NotesPresence>,
): void {
  to.applyChangePack(from.createChangePack());
}

describe('YorkieNoteStore', () => {
  it('reads text from the Yorkie Text', () => {
    const store = new YorkieNoteStore(makeDoc());
    expect(store.getText()).toBe('hello');
  });

  it('applies a local edit into the Yorkie Text', () => {
    const store = new YorkieNoteStore(makeDoc());
    store.editText(5, 5, ' world');
    expect(store.getText()).toBe('hello world');
  });

  it('has no peer selections for a single client', () => {
    const store = new YorkieNoteStore(makeDoc());
    expect(store.getPeerSelections()).toEqual([]);
  });

  describe('undo/redo (Yorkie-native)', () => {
    it('collapses a batch into a single undo unit', () => {
      const doc = makeDoc();
      const store = new YorkieNoteStore(doc);
      const before = doc.getUndoStackForTest().length;
      store.batch(() => {
        store.editText(5, 5, ' world');
        store.editText(11, 11, '!');
      });
      expect(store.getText()).toBe('hello world!');
      // One batch = one doc.update = one undo unit: a single undo must revert
      // both edits, not just the last one.
      expect(doc.getUndoStackForTest()).toHaveLength(before + 1);
      store.undo();
      expect(store.getText()).toBe('hello');
      expect(store.canUndo()).toBe(false);
      store.redo();
      expect(store.getText()).toBe('hello world!');
    });

    it('folds a nested batch into the outer undo unit', () => {
      const doc = makeDoc();
      const store = new YorkieNoteStore(doc);
      const before = doc.getUndoStackForTest().length;
      store.batch(() => {
        store.editText(5, 5, 'A');
        store.batch(() => {
          store.editText(6, 6, 'B');
        });
      });
      expect(doc.getUndoStackForTest()).toHaveLength(before + 1);
      store.undo();
      expect(store.getText()).toBe('hello');
    });

    it('records nothing for a batch that edits nothing', () => {
      const store = new YorkieNoteStore(makeDoc());
      store.batch(() => {});
      expect(store.canUndo()).toBe(false);
    });

    it('refuses to undo below the seeded baseline', () => {
      // The seed ran before construction, so it sits under the undo floor —
      // undoing it would leave the editor bound to a contentless document.
      const doc = makeDoc();
      const store = new YorkieNoteStore(doc);
      expect(doc.history.canUndo()).toBe(true); // the seed is on the stack
      expect(store.canUndo()).toBe(false); // ...but is below our floor
      store.undo();
      expect(store.getText()).toBe('hello');
    });

    it('emits the undo result through subscribeRemote', () => {
      const store = new YorkieNoteStore(makeDoc());
      store.batch(() => store.editText(5, 5, '!'));
      const changes: NoteRemoteChange[] = [];
      store.subscribeRemote((c) => changes.push(c));
      store.undo();
      expect(changes).toEqual([
        { type: 'edits', changes: [{ from: 5, to: 6, insert: '' }] },
      ]);
    });

    it('restores the caret from presence on undo and redo', () => {
      // The fix's foundation: a selection recorded with { addToHistory: true }
      // is reversed by Yorkie on undo, so the pre-edit caret comes back.
      const doc = makeDoc();
      const store = new YorkieNoteStore(doc);
      store.setLocalSelection(2, 2); // pre-edit caret, published to presence
      store.batch(() => {
        store.editText(5, 5, '!'); // 'hello!'
        store.recordSelectionForHistory({ anchor: 6, head: 6 }); // post-edit
      });

      expect(store.undo()).toEqual({ anchor: 2, head: 2 });
      expect(store.getText()).toBe('hello');
      expect(store.redo()).toEqual({ anchor: 6, head: 6 });
      expect(store.getText()).toBe('hello!');
    });

    it('captures the reversed caret before the live publisher clobbers it', () => {
      // Regression for the undo-vs-live-publisher race: in the mounted editor
      // the remote-selection plugin republishes the current caret while the
      // undo event is still dispatching. undo() must return Yorkie's reverse,
      // captured before that clobber — not the republished value.
      const doc = makeDoc();
      const store = new YorkieNoteStore(doc);
      store.setLocalSelection(2, 2);
      store.batch(() => {
        store.editText(5, 5, '!');
        store.recordSelectionForHistory({ anchor: 6, head: 6 });
      });
      // Stand in for the view: overwrite the selection presence synchronously
      // as the undo change arrives.
      store.subscribeRemote(() => store.setLocalSelection(0, 0));

      expect(store.undo()).toEqual({ anchor: 2, head: 2 });
    });

    it('returns null from undo/redo when there is nothing to do', () => {
      const store = new YorkieNoteStore(makeDoc());
      expect(store.undo()).toBeNull(); // seed is below the floor
      expect(store.redo()).toBeNull();
    });

    it('preserves a peer edit that landed after the undone change', () => {
      // The churn regression the migration exists for: CodeMirror's local
      // history could only re-apply an absolute snapshot, so undoing after a
      // peer edit wiped the peer's text. Reverse-op undo touches only this
      // client's own ops.
      const [mine, peer] = twoClients('hello');
      const store = new YorkieNoteStore(mine);
      store.batch(() => store.editText(5, 5, ' mine'));

      peer.update((root) => root.content.edit(0, 0, 'PEER '));
      push(peer, mine);
      expect(store.getText()).toBe('PEER hello mine');

      store.undo();
      expect(store.getText()).toBe('PEER hello');
    });
  });

  describe('author spans (blame gutter)', () => {
    it('reports text written before attribution shipped as unattributed', () => {
      const store = new YorkieNoteStore(makeDoc());
      expect(store.getAuthorSpans()).toEqual([
        { from: 0, to: 5, author: null, at: 0 },
      ]);
    });

    it('attributes a local edit to the name in this client presence', () => {
      const doc = makeDoc();
      doc.update((_root, presence) => presence.set({ name: 'ann' }));
      const store = new YorkieNoteStore(doc);
      store.editText(5, 5, ' world');

      const spans = store.getAuthorSpans();
      expect(spans.map((s) => [s.from, s.to, s.author])).toEqual([
        [0, 5, null],
        [5, 11, 'ann'],
      ]);
      expect(spans[1].at).toBeGreaterThan(0);
    });

    it('records the empty name anonymous editors attach with', () => {
      // Presence carries no name at all here; the gutter renders an empty
      // author as "Anonymous" rather than leaving the line blank.
      const store = new YorkieNoteStore(makeDoc());
      store.editText(5, 5, '!');
      expect(store.getAuthorSpans().at(-1)).toMatchObject({
        from: 5,
        to: 6,
        author: '',
      });
    });

    it('carries a peer edit author across the wire', () => {
      const [mine, peer] = twoClients('hello');
      peer.update((_root, presence) => presence.set({ name: 'bob' }));
      const store = new YorkieNoteStore(mine);
      const peerStore = new YorkieNoteStore(peer);
      peerStore.editText(5, 5, ' there');
      push(peer, mine);

      expect(
        store.getAuthorSpans().map((s) => [s.from, s.to, s.author]),
      ).toEqual([
        [0, 5, null],
        [5, 11, 'bob'],
      ]);
    });

    it('discards a write time further ahead than clock skew explains', () => {
      // A hostile client can write any attribute it likes (nothing verifies
      // them), and "newest run wins" decides the label — so a `t` in the year
      // 3000 would outrank every genuine edit on its line. Clamping it to `now`
      // is not enough: `now` is re-read on every call, so the clamped value
      // stays the newest one forever. It has to read as unknown (`0`).
      const doc = makeDoc();
      doc.update((root) => {
        root.content.edit(5, 5, '!', { a: 'forged', t: 4e15 });
      });
      const store = new YorkieNoteStore(doc);
      const forged = store.getAuthorSpans().at(-1)!;
      expect(forged.author).toBe('forged');
      expect(forged.at).toBe(0);
    });

    it('outranks a forged future write time with a genuine edit', () => {
      // The whole point of discarding it: the real author of the line wins.
      const doc = makeDoc();
      doc.update((root) => {
        root.content.edit(0, 0, 'X', { a: 'forged', t: 4e15 });
      });
      doc.update((_root, presence) => presence.set({ name: 'ann' }));
      const store = new YorkieNoteStore(doc);
      store.editText(6, 6, '!');

      const spans = store.getAuthorSpans();
      const forged = spans.find((s) => s.author === 'forged')!;
      const genuine = spans.find((s) => s.author === 'ann')!;
      expect(forged.at).toBe(0);
      expect(genuine.at).toBeGreaterThan(forged.at);
    });

    it('clamps a write time inside clock skew back to now', () => {
      // A peer whose clock runs a little fast is not an attacker; its run stays
      // attributed, just no newer than this client's own clock.
      const doc = makeDoc();
      const skewed = Date.now() + 30_000;
      doc.update((root) => {
        root.content.edit(5, 5, '!', { a: 'ann', t: skewed });
      });
      const store = new YorkieNoteStore(doc);
      const span = store.getAuthorSpans().at(-1)!;
      expect(span.at).toBeGreaterThan(0);
      expect(span.at).toBeLessThan(skewed);
    });

    it('strips control and bidi characters out of a claimed name', () => {
      const doc = makeDoc();
      doc.update((root) => {
        // The characters used to make one name render as another's.
        root.content.edit(5, 5, '!', { a: 'a\u202End\nnb\u200B', t: 5 });
      });
      const store = new YorkieNoteStore(doc);
      expect(store.getAuthorSpans().at(-1)!.author).toBe('andnb');
    });

    it('caps a claimed name at a displayable length', () => {
      const doc = makeDoc();
      doc.update((root) => {
        root.content.edit(5, 5, '!', { a: 'x'.repeat(500), t: 5 });
      });
      const store = new YorkieNoteStore(doc);
      expect(store.getAuthorSpans().at(-1)!.author).toBe('x'.repeat(64));
    });

    it('leaves a pure deletion unattributed', () => {
      const doc = makeDoc();
      doc.update((_root, presence) => presence.set({ name: 'ann' }));
      const store = new YorkieNoteStore(doc);
      store.editText(0, 2, '');
      expect(store.getAuthorSpans()).toEqual([
        { from: 0, to: 3, author: null, at: 0 },
      ]);
    });
  });
});
