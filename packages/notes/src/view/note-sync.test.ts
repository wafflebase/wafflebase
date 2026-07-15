import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MemNoteStore } from '../store/memory.js';
import type { NoteRemoteChange, NoteStore } from '../store/store.js';
import { noteStoreFacet, noteSync } from './note-sync.js';

function mount(store: NoteStore) {
  const view = new EditorView({
    state: EditorState.create({
      doc: store.getText(),
      extensions: [noteStoreFacet.of(store), noteSync],
    }),
  });
  return view;
}

describe('noteSync', () => {
  it('pushes local edits into the store', () => {
    const store = new MemNoteStore('');
    const view = mount(store);
    view.dispatch({ changes: { from: 0, insert: 'hello' }, userEvent: 'input.type' });
    expect(store.getText()).toBe('hello');
    view.destroy();
  });

  it('applies remote edits into the editor without echoing back', () => {
    // A store that lets the test emit a remote change on demand.
    let emit: (c: NoteRemoteChange) => void = () => {};
    const backing = new MemNoteStore('hello');
    const store: NoteStore = {
      getText: () => backing.getText(),
      editText: (f, t, i) => backing.editText(f, t, i),
      subscribeRemote: (l) => { emit = l; return () => {}; },
      setLocalSelection: () => {},
      getPeerSelections: () => [],
      subscribePresence: () => () => {},
    };
    const view = mount(store);
    const before = backing.getText();
    emit({ type: 'edits', changes: [{ from: 5, to: 5, insert: ' world' }] });
    expect(view.state.doc.toString()).toBe('hello world');
    // Remote application must NOT have called editText again (no echo):
    expect(backing.getText()).toBe(before);
    view.destroy();
  });

  it('applies a full replacement', () => {
    let emit: (c: NoteRemoteChange) => void = () => {};
    const store: NoteStore = {
      getText: () => 'old',
      editText: () => {},
      subscribeRemote: (l) => { emit = l; return () => {}; },
      setLocalSelection: () => {},
      getPeerSelections: () => [],
      subscribePresence: () => () => {},
    };
    const view = mount(store);
    emit({ type: 'replace', content: 'brand new' });
    expect(view.state.doc.toString()).toBe('brand new');
    view.destroy();
  });
});
