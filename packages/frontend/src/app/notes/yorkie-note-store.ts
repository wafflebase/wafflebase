import type { Document, Presence } from '@yorkie-js/sdk';
import type {
  NoteStore,
  NotePeerSelection,
  NoteRemoteChange,
  Unsubscribe,
} from '@wafflebase/notes';
import type { YorkieNotesRoot, NotesPresence } from '@/types/notes-document';

/**
 * Yorkie-backed NoteStore. Holds the note's markdown in a single `Text` CRDT
 * at `root.content` and drives peer carets through Yorkie presence. Ported
 * from CodePair's yorkieSync/remoteSelection, relocated behind NoteStore so
 * the engine stays CRDT-agnostic (project Store rule).
 *
 * Undo/redo is Yorkie-native (`doc.history`): a top-level `batch()` opens ONE
 * `doc.update` and every `editText` runs against that ambient root, so a batch
 * commits as one Yorkie change — and therefore one undo unit. Undo applies the
 * reverse of that change's ops, which leaves a peer's concurrent edit intact;
 * the CodeMirror-history path it replaced could only restore a local snapshot
 * and clobbered the peer. Same pattern as `YorkieSlidesStore` /
 * `YorkieDocStore` (see `docs/design/slides/slides-native-undo.md`).
 */
export class YorkieNoteStore implements NoteStore {
  /**
   * The live Yorkie root for the duration of a top-level `batch()`; null
   * outside one. Mutators route through `withUpdate`, which runs against this
   * root instead of opening their own `doc.update`.
   */
  private activeRoot: YorkieNotesRoot | null = null;
  /**
   * The batch's ambient presence proxy, captured alongside `activeRoot`, so a
   * selection publish that fires while the batch's update is open folds into
   * it rather than nesting a second `doc.update`. Presence is not added to
   * history, so it never pollutes the batch's undo unit.
   */
  private activePresence: Presence<NotesPresence> | null = null;
  private batchDepth = 0;
  /**
   * Undo-stack depth at construction. Whatever is already in the doc by then
   * (the `client.attach({ initialRoot })` seed, or the `ensureText()` repair
   * the view runs just before building this store) is the initial state;
   * `canUndo()` refuses to drop below it so the user cannot Cmd+Z the note
   * down to a contentless document. Mirrors `YorkieDocStore.undoFloor`.
   */
  private readonly undoFloor: number;

  constructor(private readonly doc: Document<YorkieNotesRoot, NotesPresence>) {
    this.undoFloor = doc.getUndoStackForTest().length;
  }

  getText(): string {
    const content = this.doc.getRoot().content;
    return content ? content.toString() : '';
  }

  editText(from: number, to: number, insert: string): void {
    this.withUpdate((root) => {
      root.content.edit(from, to, insert);
    });
  }

  batch(fn: () => void): void {
    // Nested batch: the ambient `doc.update` is already open, so just run the
    // body. Opening a second update would split the work into two Yorkie
    // changes and break "one batch = one undo unit".
    if (this.batchDepth > 0) {
      this.batchDepth++;
      try {
        fn();
      } finally {
        this.batchDepth--;
      }
      return;
    }
    this.batchDepth++;
    try {
      this.doc.update((root, presence) => {
        this.activeRoot = root;
        this.activePresence = presence;
        try {
          fn();
        } finally {
          this.activeRoot = null;
          this.activePresence = null;
        }
      });
    } finally {
      this.batchDepth--;
    }
  }

  undo(): void {
    if (!this.canUndo()) return;
    // Applies the reverse ops of this client's last change. The resulting text
    // change comes back as a `local-change` with `source: 'undoredo'`, which
    // `subscribeRemote` forwards to the view — so nothing is returned here.
    this.doc.history.undo();
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.doc.history.redo();
  }

  canUndo(): boolean {
    return (
      this.doc.history.canUndo() &&
      this.doc.getUndoStackForTest().length > this.undoFloor
    );
  }

  canRedo(): boolean {
    return this.doc.history.canRedo();
  }

  /**
   * Run `fn` against the batch's ambient root when a top-level `batch()` is
   * open, otherwise open a standalone `doc.update`. Every document mutator
   * goes through this so a whole batch commits as ONE Yorkie change.
   */
  private withUpdate(fn: (root: YorkieNotesRoot) => void): void {
    if (this.activeRoot) {
      fn(this.activeRoot);
    } else {
      this.doc.update((root) => fn(root));
    }
  }

  subscribeRemote(listener: (change: NoteRemoteChange) => void): Unsubscribe {
    return this.doc.subscribe((event) => {
      if (event.type === 'snapshot') {
        listener({ type: 'replace', content: this.getText() });
        return;
      }
      // `undo()`/`redo()` produce a local change carrying the reverse ops;
      // route it to the view exactly like a peer's edit so CodeMirror applies
      // it as a remote (non-echoing) transaction.
      const isUndoRedo =
        event.type === 'local-change' && event.source === 'undoredo';
      if (event.type !== 'remote-change' && !isUndoRedo) return;

      const { operations } = event.value;
      // Whole `content` object replaced → full reload.
      const contentReplaced = operations.some(
        (op) => op.type === 'remove' && op.path === '$',
      );
      if (contentReplaced) {
        listener({ type: 'replace', content: this.getText() });
        return;
      }
      for (const op of operations) {
        if (op.type === 'edit' && op.path?.startsWith('$.content')) {
          listener({
            type: 'edits',
            changes: [
              {
                from: Math.max(0, op.from),
                to: Math.max(0, op.to),
                insert:
                  (op.value as { content?: string } | undefined)?.content ??
                  '',
              },
            ],
          });
        }
      }
    });
  }

  setLocalSelection(anchor: number, head: number | null): void {
    const publish = (root: YorkieNotesRoot, presence: Presence<NotesPresence>) => {
      const content = root.content;
      if (head === null || !content) {
        if (presence.get('selection')) {
          presence.set({ selection: null, cursor: null });
        }
        return;
      }
      const selection = content.indexRangeToPosRange([anchor, head]);
      const cursor = content.posRangeToIndexRange(selection);
      const prev = presence.get('selection');
      if (JSON.stringify(prev) !== JSON.stringify(selection)) {
        presence.set({ selection, cursor });
      }
    };
    // Fold into the batch's ambient update when one is open; a nested
    // `doc.update` there would be an update inside an update.
    if (this.activeRoot && this.activePresence) {
      publish(this.activeRoot, this.activePresence);
      return;
    }
    this.doc.update((root, presence) => publish(root, presence));
  }

  getPeerSelections(): NotePeerSelection[] {
    const content = this.doc.getRoot().content;
    if (!content) return [];
    const result: NotePeerSelection[] = [];
    for (const peer of this.doc.getOthersPresences()) {
      const sel = peer.presence.selection;
      if (!sel) continue;
      const [from, to] = content.posRangeToIndexRange(sel);
      result.push({
        clientID: String(peer.clientID),
        from,
        to,
        color: peer.presence.color,
        name: peer.presence.name,
      });
    }
    return result;
  }

  subscribePresence(listener: () => void): Unsubscribe {
    return this.doc.subscribe('others', () => {
      listener();
    });
  }
}
