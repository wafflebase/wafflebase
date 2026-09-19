import type { SearchMatch, SearchOptions } from '../model/types.js';
import type { Doc } from '../model/document.js';

/**
 * Manages find & replace state: query, matches, active index, and
 * replace operations.  Works against the Doc model directly.
 */
export class FindReplaceState {
  matches: SearchMatch[] = [];
  activeIndex = -1;
  query = '';
  options: SearchOptions = {};

  constructor(
    private doc: Doc,
    private snapshot?: () => void,
  ) {}

  /**
   * Run a search and update matches/activeIndex.
   */
  search(query: string, options?: SearchOptions): void {
    const prevIndex = this.activeIndex;
    this.query = query;
    this.options = options ?? {};
    this.matches = this.doc.searchText(query, this.options);
    if (this.matches.length === 0) {
      this.activeIndex = -1;
    } else if (prevIndex >= 0 && prevIndex < this.matches.length) {
      // Keep the previous active index if it's still valid (e.g. after replace)
      this.activeIndex = prevIndex;
    } else {
      this.activeIndex = 0;
    }
  }

  /**
   * Advance to the next match (wraps around).
   */
  next(): void {
    if (this.matches.length === 0) return;
    this.activeIndex = (this.activeIndex + 1) % this.matches.length;
  }

  /**
   * Go to the previous match (wraps around).
   */
  previous(): void {
    if (this.matches.length === 0) return;
    this.activeIndex =
      (this.activeIndex - 1 + this.matches.length) % this.matches.length;
  }

  /**
   * Re-run the current search and re-anchor the active match by position.
   *
   * `matches` holds offsets captured when `search()` last ran, and the
   * document can change under them while the find bar stays open — the user
   * typing elsewhere, or a remote peer. A replace against those offsets then
   * rewrites whatever text has slid into that slot, which is issue #1083. So
   * both replace paths refresh first.
   *
   * Re-anchoring is deliberately *not* what `search()` does. `search()` keeps
   * the previous ordinal `activeIndex`, which is right after a replace (the
   * match set shrank under a known edit), but wrong here: an edit that added
   * or removed an occurrence before the active one makes index N name a
   * different occurrence than the one the bar painted, and Replace would
   * rewrite text the user never highlighted. The nearest match in the same
   * block is the closest surviving proxy for "the one that was highlighted"
   * after an edit of unknown shape; ties go to the later match, since text
   * inserted at the active match's own start offset pushes it forward.
   *
   * With no match left in that block — it was deleted, or the block was —
   * there is nothing to anchor to and `search()`'s clamped ordinal stands.
   */
  private refresh(): void {
    const active =
      this.activeIndex >= 0 && this.activeIndex < this.matches.length
        ? this.matches[this.activeIndex]
        : undefined;
    this.search(this.query, this.options);
    if (!active) return;

    let anchored = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < this.matches.length; i++) {
      const match = this.matches[i];
      if (match.blockId !== active.blockId) continue;
      const distance = Math.abs(match.startOffset - active.startOffset);
      // Matches come back in document order, so `<=` is what lets a tie fall
      // to the later one.
      if (distance <= bestDistance) {
        bestDistance = distance;
        anchored = i;
      }
    }
    if (anchored >= 0) this.activeIndex = anchored;
  }

  /**
   * Replace the currently active match with `replacement` and re-search.
   *
   * One undo unit however many store writes it takes — see {@link replaceAll}.
   * A single replacement is already two of them, so this used to cost two
   * Cmd+Z, the first of which put the searched-for text back without removing
   * the replacement.
   *
   * Refreshes first; see {@link refresh} for why the offsets cannot be
   * trusted and why the active match is re-anchored by position.
   */
  replaceActive(replacement: string): void {
    this.refresh();
    if (this.activeIndex < 0 || this.activeIndex >= this.matches.length) return;
    this.snapshot?.();
    const match = this.matches[this.activeIndex];
    this.doc.batch(() => this.replaceMatch(match, replacement));
    this.search(this.query, this.options);
  }

  /**
   * Replace all matches with `replacement` (last-to-first to preserve offsets)
   * and re-search.
   *
   * `Doc.batch()` makes the whole sweep ONE undo unit. Each
   * {@link replaceMatch} is a `deleteText` plus an `insertText` — two store
   * writes — and on `YorkieDocStore` a write outside a batch is its own
   * `doc.update()` and therefore its own `doc.history` entry. Yorkie caps
   * that stack at 50 (`MaxUndoRedoStackDepth`) and `pushUndo` `shift()`s the
   * *oldest* entry once it is full, so Replace All over more than 25 matches
   * stranded the earliest replacements permanently: the same data loss as
   * issue #1045, reached through the find bar. The `snapshot()` stays outside
   * the batch, for the reason `TextEditor.withUndoUnit` documents.
   *
   * Refreshes first, for the reason {@link refresh} gives. "All" means every
   * match the document holds now, so a match added since the last search is
   * replaced too — the sweep's scope is the document, not the last render.
   */
  replaceAll(replacement: string): void {
    this.refresh();
    if (this.matches.length === 0) return;
    this.snapshot?.();
    this.doc.batch(() => {
      for (let i = this.matches.length - 1; i >= 0; i--) {
        this.replaceMatch(this.matches[i], replacement);
      }
    });
    this.search(this.query, this.options);
  }

  private replaceMatch(match: SearchMatch, replacement: string): void {
    this.doc.deleteText(
      { blockId: match.blockId, offset: match.startOffset },
      match.endOffset - match.startOffset,
    );
    this.doc.insertText(
      { blockId: match.blockId, offset: match.startOffset },
      replacement,
    );
  }
}
