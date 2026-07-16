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

  it('renders decorations for a multi-line peer selection without throwing', () => {
    const docText = 'line one\nline two\nline three\nline four';
    const store = storeWithPeers([
      { clientID: 'c1', from: 2, to: docText.length - 2, color: '#0f0', name: 'Grace' },
    ]);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let view: EditorView | undefined;
    expect(() => {
      view = new EditorView({
        parent,
        state: EditorState.create({
          doc: docText,
          extensions: [noteStoreFacet.of(store), noteRemoteSelectionsTheme, noteRemoteSelections],
        }),
      });
    }).not.toThrow();
    // The peer caret carries the peer's name.
    expect(view!.dom.textContent).toContain('Grace');
    // The selection spans 4 lines, so it should be split into multiple mark
    // decorations (one per line segment). If this DOM query ever proves
    // unreliable across CodeMirror versions, the no-throw + name assertions
    // above already cover the regression this test guards against.
    const marks = view!.dom.querySelectorAll('.cm-ySelection');
    expect(marks.length).toBeGreaterThanOrEqual(2);
    view!.destroy();
    parent.remove();
  });

  it('clamps an out-of-range peer selection instead of throwing', () => {
    const docText = 'abcde'; // doc length 5
    const store = storeWithPeers([
      { clientID: 'c1', from: 10, to: 20, color: '#00f', name: 'Bob' },
    ]);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let view: EditorView | undefined;
    expect(() => {
      view = new EditorView({
        parent,
        state: EditorState.create({
          doc: docText,
          extensions: [noteStoreFacet.of(store), noteRemoteSelectionsTheme, noteRemoteSelections],
        }),
      });
    }).not.toThrow();
    // The caret still renders (clamped to doc length) even though the peer's
    // recorded selection points past the local document.
    expect(view!.dom.textContent).toContain('Bob');
    view!.destroy();
    parent.remove();
  });
});
