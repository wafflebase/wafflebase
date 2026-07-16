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

  it('adjusts later change offsets by the earlier change in the same transaction', () => {
    // Guards the `adj` running-offset in note-sync.ts's update(): a single
    // CodeMirror transaction can carry multiple non-overlapping changes, and
    // ChangeSet.iterChanges reports each one's (fromA, toA) in the ORIGINAL
    // document's coordinate space. Since editText() is applied to the store
    // sequentially, the second change's coordinates must be shifted by the
    // net length delta of the first change before being applied, or it will
    // hit the wrong range in the (already-mutated) store text.
    //
    // Initial doc: "AAAA BBBB" (indices: 0123456789 -> A A A A _ B B B B)
    // Change 1: insert "XY" at [0, 0)      -> net length delta +2
    // Change 2 (original coords): replace [5, 9) "BBBB" with "Z"
    //   Correct (adjusted):   store.editText(5+2, 9+2, 'Z') = editText(7, 11, 'Z')
    //     "XYAAAA BBBB" (after change 1) -> replace indices [7,11) "BBBB" -> "XYAAAA Z"
    //   Buggy (unadjusted, adj dropped): store.editText(5, 9, 'Z') would hit
    //     indices [5,9) of "XYAAAA BBBB", which is "A BB" (not "BBBB"),
    //     corrupting the result to "XYAAAZBB" instead.
    const store = new MemNoteStore('AAAA BBBB');
    const view = mount(store);
    view.dispatch({
      changes: [
        { from: 0, to: 0, insert: 'XY' },
        { from: 5, to: 9, insert: 'Z' },
      ],
      userEvent: 'input.type',
    });
    expect(store.getText()).toBe('XYAAAA Z');
    view.destroy();
  });
});
