import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import type { NoteStore, NoteRemoteChange } from '../store/store.js';

/** Facet carrying the NoteStore into CodeMirror plugins. */
export const noteStoreFacet = cmState.Facet.define<NoteStore, NoteStore>({
  combine(inputs) {
    return inputs[inputs.length - 1];
  },
});

class NoteSyncPluginValue implements cmView.PluginValue {
  private store: NoteStore;
  private unsub: () => void;

  constructor(view: cmView.EditorView) {
    this.store = view.state.facet(noteStoreFacet);
    this.unsub = this.store.subscribeRemote((change) => {
      this.applyRemote(view, change);
    });
  }

  /** Apply a remote change as a CodeMirror transaction, excluded from local
   *  history and tagged `remote` so our own `update()` skips it (no echo). */
  private applyRemote(view: cmView.EditorView, change: NoteRemoteChange): void {
    const base = {
      annotations: [
        cmState.Transaction.remote.of(true),
        cmState.Transaction.addToHistory.of(false),
      ],
    };
    if (change.type === 'replace') {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: change.content },
        ...base,
      });
      return;
    }
    // Apply each edit as its own transaction so sequential coordinates from
    // the CRDT remain valid (matches CodePair's per-op dispatch).
    for (const c of change.changes) {
      const docLen = view.state.doc.length;
      view.dispatch({
        changes: {
          from: Math.min(Math.max(0, c.from), docLen),
          to: Math.min(Math.max(0, c.to), docLen),
          insert: c.insert,
        },
        ...base,
      });
    }
  }

  update(update: cmView.ViewUpdate): void {
    if (!update.docChanged) return;
    // One ViewUpdate = one undo unit. `batch()` collapses every edit below
    // into a single store change, so a multi-change transaction (or a command
    // that dispatches several, e.g. insertTable) undoes in one step instead of
    // unwinding change by change. An update whose transactions are all
    // filtered out below leaves the batch empty, which records nothing.
    this.store.batch(() => {
      for (const tr of update.transactions) {
        if (tr.annotation(cmState.Transaction.remote)) continue;
        // 'undo'/'redo' stay in the list purely as a safety net: CodeMirror's
        // own history is disabled (Yorkie owns undo), so nothing should emit
        // them — but if something did, the edit must still reach the store
        // rather than silently desync the view from the model.
        const events = ['input', 'delete', 'move', 'undo', 'redo'];
        if (!events.some((e) => tr.isUserEvent(e))) continue;
        let adj = 0;
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          const insertText = inserted.toJSON().join('\n');
          this.store.editText(fromA + adj, toA + adj, insertText);
          adj += insertText.length - (toA - fromA);
        });
      }
    });
  }

  destroy(): void {
    this.unsub();
  }
}

export const noteSync = cmView.ViewPlugin.fromClass(NoteSyncPluginValue);
