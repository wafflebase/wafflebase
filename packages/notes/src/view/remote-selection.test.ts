import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { NoteStore, NotePeerSelection } from '../store/store.js';
import { noteStoreFacet } from './note-sync.js';
import { noteRemoteSelections, noteRemoteSelectionsTheme } from './remote-selection.js';

function storeWithPeers(peers: NotePeerSelection[]): NoteStore & { setLocal: ReturnType<typeof vi.fn> } {
  const setLocal = vi.fn();
  return {
    getText: () => 'hello world',
    editText: () => {},
    subscribeRemote: () => () => {},
    setLocalSelection: setLocal,
    getPeerSelections: () => peers,
    subscribePresence: () => () => {},
    setLocal,
  } as NoteStore & { setLocal: ReturnType<typeof vi.fn> };
}

describe('noteRemoteSelections', () => {
  it('renders a decoration widget for a peer selection', () => {
    const store = storeWithPeers([
      { clientID: 'c1', from: 0, to: 5, color: '#f00', name: 'Ada' },
    ]);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: store.getText(),
        extensions: [noteStoreFacet.of(store), noteRemoteSelectionsTheme, noteRemoteSelections],
      }),
    });
    // The peer caret carries the peer's name.
    expect(view.dom.textContent).toContain('Ada');
    view.destroy();
    parent.remove();
  });
});
