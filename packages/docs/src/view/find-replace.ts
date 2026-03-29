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
   * Replace the currently active match with `replacement` and re-search.
   */
  replaceActive(replacement: string): void {
    if (this.activeIndex < 0 || this.activeIndex >= this.matches.length) return;
    this.snapshot?.();
    const match = this.matches[this.activeIndex];
    this.replaceMatch(match, replacement);
    this.search(this.query, this.options);
  }

  /**
   * Replace all matches with `replacement` (last-to-first to preserve offsets)
   * and re-search.
   */
  replaceAll(replacement: string): void {
    if (this.matches.length === 0) return;
    this.snapshot?.();
    for (let i = this.matches.length - 1; i >= 0; i--) {
      this.replaceMatch(this.matches[i], replacement);
    }
    this.search(this.query, this.options);
  }

  private replaceMatch(match: SearchMatch, replacement: string): void {
    if (match.cellAddress) {
      const cbi = match.cellBlockIndex ?? 0;
      this.doc.deleteTextInCell(
        match.blockId, match.cellAddress,
        match.startOffset, match.endOffset - match.startOffset, cbi,
      );
      this.doc.insertTextInCell(
        match.blockId, match.cellAddress,
        match.startOffset, replacement, cbi,
      );
    } else {
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
}
