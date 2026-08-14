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
});
