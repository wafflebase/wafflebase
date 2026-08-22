import type { Document, Presence, TextPosStructRange } from '@yorkie-js/sdk';
import type {
  NoteStore,
  NoteAuthorSpan,
  NotePeerSelection,
  NoteRemoteChange,
  NoteSelection,
  Unsubscribe,
} from '@wafflebase/notes';
import { sanitizeDisplayName } from '@wafflebase/notes';
import type { YorkieNotesRoot, NotesPresence } from '@/types/notes-document';

/**
 * Per-run `Text` attributes carrying line authorship for the blame gutter
 * (issue #814). Deliberately one-letter: they are written on every inserted
 * run, so the key is paid for once per run in the CRDT and on the wire.
 */
const AUTHOR_ATTR = 'a';
const WRITTEN_AT_ATTR = 't';

/**
 * Line authorship is SELF-REPORTED, and is deliberately treated as such.
 *
 * It lives in `root.content`'s per-run attributes, which every attached client
 * writes for itself: Yorkie validates nothing inside a change, and the backend
 * never sees a note edit (its auth webhook authorizes docKey + verb, not
 * content). A client speaking to Yorkie directly can therefore claim any name
 * on any run — including restyling a run it never wrote — and nothing in this
 * file can prevent that. So:
 *
 * - The gutter is a reading aid ("who most likely wrote this line"), never an
 *   audit trail and never an input to an access decision. It is rendered as
 *   self-reported rather than as verified fact (see `blame-gutter.ts`).
 * - What is read back is sanitized here instead of trusted, so a forged
 *   attribute cannot do more than claim a name: a `t` further in the future
 *   than clock skew explains is discarded, so it cannot outrank the genuine
 *   edits on its line, and a name cannot smuggle invisible / bidi characters or
 *   run unbounded (`sanitizeDisplayName`, shared with the peer caret label —
 *   the other place the same unverified presence name reaches the DOM).
 * - Verified provenance would need the backend to sign each run's authorship,
 *   or Yorkie to expose a change's server-assigned actor per run; both are out
 *   of proportion for a reading aid. Recorded in `docs/design/notes/notes.md`.
 */

/**
 * How far ahead of us a peer's clock may legitimately be. Real clocks disagree
 * by seconds, so a run written a moment ago by a skewed peer reads as slightly
 * future; past this, a timestamp is not skew, it is a claim.
 */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The write timestamp of a run, bounded. "Newest run wins" is what decides a
 * line's label, so a client-supplied value is what a forgery would reach for:
 * one run outranking every real edit on its line.
 *
 * A value beyond `now + MAX_CLOCK_SKEW_MS` is therefore DISCARDED rather than
 * clamped. Clamping it re-reads `now` on every call, so a run claiming the year
 * 3000 would keep reading as the newest run on its line forever — a control
 * that looks like a bound and is not one. Reporting it as unknown (`0`) puts it
 * below every real edit instead. Within skew the value is clamped to `now`,
 * which caps what it can win to a tie that document order breaks, and only
 * until the wall clock passes it. Anything that is not a positive finite number
 * is unknown too.
 */
function sanitizeWrittenAt(value: unknown, now: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value > now + MAX_CLOCK_SKEW_MS) return 0;
  return Math.min(value, now);
}

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
  /**
   * The selection Yorkie reversed into presence for the in-flight undo/redo,
   * captured the instant the op's event fires (see `captureHistorySelection`).
   * Read and cleared by `runHistory`; null between ops.
   */
  private pendingHistorySelection: NoteSelection | null = null;

  constructor(private readonly doc: Document<YorkieNotesRoot, NotesPresence>) {
    this.undoFloor = doc.getUndoStackForTest().length;
    // Snapshot the reversed selection the moment an undo/redo lands. Registered
    // in the constructor so it runs BEFORE the view's `subscribeRemote`: once
    // the view applies the reverted text, its live-cursor publisher republishes
    // the current caret over the same `selection` presence key, clobbering
    // Yorkie's reverse (the undo-vs-live-publisher race, cf.
    // docs-intent-preserving-edits.md #609). Reading here, first, beats it.
    doc.subscribe((event) => {
      if (event.type === 'local-change' && event.source === 'undoredo') {
        this.captureHistorySelection();
      }
    });
  }

  getText(): string {
    const content = this.doc.getRoot().content;
    return content ? content.toString() : '';
  }

  editText(from: number, to: number, insert: string): void {
    this.withUpdate((root) => {
      // Attribution rides along as attributes on the inserted run, so the blame
      // gutter needs no second structure in the root and the CodePair-shaped
      // `{ content: Text }` schema is untouched. A pure deletion inserts
      // nothing, so it carries no attributes.
      if (insert.length > 0) {
        root.content.edit(from, to, insert, {
          // Sanitized on the way in as well as on the way out, so a well-behaved
          // client never puts a name in the CRDT that its own reader would have
          // to strip.
          [AUTHOR_ATTR]: sanitizeDisplayName(this.localAuthorName()) ?? '',
          [WRITTEN_AT_ATTR]: Date.now(),
        });
      } else {
        root.content.edit(from, to, insert);
      }
    });
  }

  getAuthorSpans(): NoteAuthorSpan[] {
    const content = this.doc.getRoot().content;
    if (!content) return [];
    const spans: NoteAuthorSpan[] = [];
    let index = 0;
    // One reading for the whole walk, so runs are clamped against a single
    // instant rather than a drifting one.
    const now = Date.now();
    for (const value of content.values()) {
      const text = value.content ?? '';
      if (text.length === 0) continue;
      const attrs = value.attributes as
        | Record<string, unknown>
        | undefined;
      spans.push({
        from: index,
        to: index + text.length,
        // Every attribute here was written by some client and is not verifiable
        // (see the trust-boundary note at the top of this file), so it is
        // sanitized, not trusted. Text written before per-line attribution
        // shipped carries no attributes at all — reported as `null` so the
        // gutter leaves those lines blank instead of guessing a name.
        author: sanitizeDisplayName(attrs?.[AUTHOR_ATTR]),
        at: sanitizeWrittenAt(attrs?.[WRITTEN_AT_ATTR], now),
      });
      index += text.length;
    }
    return spans;
  }

  /**
   * The name recorded on text this client writes, read from its own presence —
   * the same value peers already see on its caret. Anonymous share-link editors
   * attach with `name: "Anonymous"`; an empty result (no presence yet) is
   * rendered as "Anonymous" by the gutter too.
   *
   * Presence is client-set and unverified, which is why what this produces is a
   * claim rather than an identity — see the trust-boundary note at the top of
   * this file.
   */
  private localAuthorName(): string {
    const fromPublic = this.doc.getMyPresence()?.name;
    if (fromPublic) return fromPublic;
    // `getMyPresence()` returns `{}` offline / in tests, same caveat as
    // `readPresenceSelection`.
    const actorId = this.doc.getChangeID().getActorID();
    if (actorId) return this.doc.getPresenceForTest(actorId)?.name ?? '';
    return '';
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

  /**
   * Record `selection` as the post-edit selection of the currently-open
   * batch's Yorkie change, with `{ addToHistory: true }`. Yorkie stores the
   * reverse (the presence — i.e. the pre-edit selection — that was live when
   * this update opened) so `undo` restores the caret to where it sat before the
   * edit, and `redo` re-applies this one. A no-op outside a batch: without an
   * open update there is no change to fold it into, and writing presence on its
   * own would manufacture a selection-only undo unit.
   */
  recordSelectionForHistory(selection: NoteSelection): void {
    if (!this.activeRoot || !this.activePresence) return;
    const content = this.activeRoot.content;
    if (!content) return;
    this.activePresence.set(
      this.buildSelectionPresence(content, selection.anchor, selection.head),
      { addToHistory: true },
    );
  }

  undo(): NoteSelection | null {
    if (!this.canUndo()) return null;
    // Applies the reverse ops of this client's last change. The text change
    // comes back as a `local-change` with `source: 'undoredo'`, which
    // `subscribeRemote` forwards to the view; the selection Yorkie reversed is
    // captured by `captureHistorySelection` during that same event.
    return this.runHistory(() => this.doc.history.undo());
  }

  redo(): NoteSelection | null {
    if (!this.canRedo()) return null;
    return this.runHistory(() => this.doc.history.redo());
  }

  /**
   * Run a Yorkie history op and return the selection it reversed into presence.
   * The value is captured DURING the op (by `captureHistorySelection`), not read
   * back after: by the time `op()` returns, the view's live-cursor publisher has
   * already overwritten the `selection` presence key.
   */
  private runHistory(op: () => void): NoteSelection | null {
    this.pendingHistorySelection = null;
    op();
    const captured = this.pendingHistorySelection;
    this.pendingHistorySelection = null;
    return captured;
  }

  /**
   * Snapshot the selection Yorkie reversed into presence for the in-flight
   * undo/redo, in CodeMirror index coordinates. Reads the CRDT-stable
   * `selection` posRange (survives a peer's concurrent edit) and resolves it
   * against the current (already-reverted) content.
   */
  private captureHistorySelection(): void {
    const content = this.doc.getRoot().content;
    const posRange = this.readPresenceSelection();
    if (!content || !posRange) {
      this.pendingHistorySelection = null;
      return;
    }
    const [from, to] = content.posRangeToIndexRange(posRange);
    this.pendingHistorySelection = { anchor: from, head: to };
  }

  /** The `{ selection, cursor }` presence payload for a CodeMirror index range. */
  private buildSelectionPresence(
    content: NonNullable<YorkieNotesRoot['content']>,
    anchor: number,
    head: number,
  ): Pick<NotesPresence, 'selection' | 'cursor'> {
    const len = content.length;
    const a = Math.min(Math.max(0, anchor), len);
    const h = Math.min(Math.max(0, head), len);
    const selection = content.indexRangeToPosRange([a, h]);
    const cursor = content.posRangeToIndexRange(selection);
    return { selection, cursor };
  }

  /**
   * Read this client's `selection` presence posRange. Mirrors
   * `YorkieDocStore.getPresenceCursorPos`: `getMyPresence()` works while
   * attached, but returns `{}` offline/in tests, so fall back to
   * `getPresenceForTest`.
   */
  private readPresenceSelection(): TextPosStructRange | undefined {
    const fromPublic = this.doc.getMyPresence()?.selection ?? undefined;
    if (fromPublic) return fromPublic;
    const actorId = this.doc.getChangeID().getActorID();
    if (actorId) {
      return this.doc.getPresenceForTest(actorId)?.selection ?? undefined;
    }
    return undefined;
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
      const payload = this.buildSelectionPresence(content, anchor, head);
      const prev = presence.get('selection');
      if (JSON.stringify(prev) !== JSON.stringify(payload.selection)) {
        presence.set(payload);
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
