import { describe, it, expect, afterEach } from 'vitest';
import { Document, Text } from '@yorkie-js/sdk';
import { initialize, type NoteEditorAPI } from '@wafflebase/notes';
import { YorkieNoteStore } from './yorkie-note-store';
import type { YorkieNotesRoot, NotesPresence } from '@/types/notes-document';

/**
 * The mounted editor over a real YorkieNoteStore. `yorkie-note-store.test.ts`
 * exercises the store alone; this covers the loop the store closes with the
 * view — undo re-enters CodeMirror through `subscribeRemote`, and the
 * resulting ViewUpdate re-enters the store's `batch()` while Yorkie is still
 * inside its own event dispatch. That re-entrancy only exists once both halves
 * are wired together, so it needs a test that mounts both.
 *
 * Local edits go through `api.insertTable()` rather than a synthesized
 * keystroke: it is a real editor command (one CodeMirror transaction carrying
 * several changes — exactly the shape batching exists for) and needs no access
 * to the EditorView, which this package does not depend on.
 */
function mount(text: string) {
  const doc = new Document<YorkieNotesRoot, NotesPresence>('note-editor-undo');
  doc.setActor('000000000000000000000001');
  doc.update((root) => {
    root.content = new Text();
    root.content.edit(0, 0, text);
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const store = new YorkieNoteStore(doc);
  const api = initialize(container, store, 'light');
  return { doc, store, api, container };
}

/** A second client on the same key, already carrying `mine`'s seed. */
function peerOf(mine: Document<YorkieNotesRoot, NotesPresence>) {
  const peer = new Document<YorkieNotesRoot, NotesPresence>('note-editor-undo');
  peer.setActor('000000000000000000000002');
  peer.applyChangePack(mine.createChangePack());
  return peer;
}

let teardown: Array<() => void> = [];
afterEach(() => {
  for (const fn of teardown) fn();
  teardown = [];
});

function track(api: NoteEditorAPI, container: HTMLElement) {
  teardown.push(() => {
    api.dispose();
    container.remove();
  });
}

describe('notes undo through the mounted editor', () => {
  it('reverts an editor command in both the model and the view', () => {
    const { store, api, container } = mount('hello');
    track(api, container);

    api.insertTable(2, 2);
    const withTable = api.getText();
    expect(withTable).not.toBe('hello');
    expect(store.getText()).toBe(withTable);
    expect(api.canUndo()).toBe(true);

    api.undo();
    // The reverse ops came back through subscribeRemote and CodeMirror applied
    // them — the view and the CRDT must agree. One command = one undo unit, so
    // a single undo removes the whole skeleton.
    expect(store.getText()).toBe('hello');
    expect(api.getText()).toBe('hello');
    expect(api.canUndo()).toBe(false);

    api.redo();
    expect(store.getText()).toBe(withTable);
    expect(api.getText()).toBe(withTable);
  });

  it('keeps a peer edit when undoing the local one', () => {
    // The churn regression, end to end: the peer's insert shifts the local
    // edit's coordinates, and undo must still remove only the local text.
    const { doc, store, api, container } = mount('hello');
    track(api, container);
    const peer = peerOf(doc);

    api.insertTable(2, 2);
    const withTable = api.getText();

    peer.update((root) => root.content.edit(0, 0, 'PEER '));
    doc.applyChangePack(peer.createChangePack());
    expect(api.getText()).toBe(`PEER ${withTable}`);

    api.undo();
    expect(store.getText()).toBe('PEER hello');
    expect(api.getText()).toBe('PEER hello');
  });

  it('does not push the undo back as a new change', () => {
    // The view re-enters store.batch() while Yorkie is still dispatching the
    // undo event. That batch must stay empty: a forward edit here would both
    // desync the undo stack and echo the revert back to peers.
    const { doc, store, api, container } = mount('hello');
    track(api, container);

    api.insertTable(2, 2);
    const depthAfterEdit = doc.getUndoStackForTest().length;
    api.undo();

    expect(doc.getUndoStackForTest()).toHaveLength(depthAfterEdit - 1);
    expect(doc.history.canRedo()).toBe(true);
    expect(store.getText()).toBe('hello');
    expect(api.getText()).toBe('hello');
  });

  it('applies a peer edit without recording a local undo unit', () => {
    // Every docChanged ViewUpdate opens a batch, including ones carrying only
    // remote transactions. An empty Yorkie update must stay free — otherwise a
    // peer typing would pile up undo units on this client.
    const { doc, api, container } = mount('hello');
    track(api, container);
    const peer = peerOf(doc);
    const before = doc.getUndoStackForTest().length;

    peer.update((root) => root.content.edit(5, 5, ' peer'));
    doc.applyChangePack(peer.createChangePack());

    expect(api.getText()).toBe('hello peer');
    expect(doc.getUndoStackForTest()).toHaveLength(before);
    expect(api.canUndo()).toBe(false);
  });
});
