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

  constructor(private doc: Doc) {}

  /**
   * Run a search and update matches/activeIndex.
   */
  search(query: string, options?: SearchOptions): void {
    this.query = query;
    this.options = options ?? {};
    this.matches = this.doc.searchText(query, this.options);
    this.activeIndex = this.matches.length > 0 ? 0 : -1;
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
    const match = this.matches[this.activeIndex];
    this.doc.deleteText(
      { blockId: match.blockId, offset: match.startOffset },
      match.endOffset - match.startOffset,
    );
    this.doc.insertText(
      { blockId: match.blockId, offset: match.startOffset },
      replacement,
    );
    this.search(this.query, this.options);
  }

  /**
   * Replace all matches with `replacement` (last-to-first to preserve offsets)
   * and re-search.
   */
  replaceAll(replacement: string): void {
    for (let i = this.matches.length - 1; i >= 0; i--) {
      const match = this.matches[i];
      this.doc.deleteText(
        { blockId: match.blockId, offset: match.startOffset },
        match.endOffset - match.startOffset,
      );
      this.doc.insertText(
        { blockId: match.blockId, offset: match.startOffset },
        replacement,
      );
    }
    this.search(this.query, this.options);
  }
}
