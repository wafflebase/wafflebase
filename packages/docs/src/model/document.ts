import {
  type Block,
  type BlockType,
  type DocPosition,
  type DocRange,
  type Document,
  type HeadingLevel,
  type InlineStyle,
  type BlockStyle,
  type SearchOptions,
  type SearchMatch,
  createEmptyBlock,
  DEFAULT_BLOCK_STYLE,
  getBlockText,
  getBlockTextLength,
  inlineStylesEqual,
  generateBlockId,
} from './types.js';
import { MemDocStore } from '../store/memory.js';
import type { DocStore } from '../store/store.js';

/**
 * Document manipulation logic.
 *
 * Delegates all mutations through a DocStore. Maintains a cached
 * Document for reads, refreshed after each mutation.
 */
export class Doc {
  private store: DocStore;
  private _document: Document;

  constructor(store: DocStore) {
    this.store = store;
    this._document = this.store.getDocument();
  }

  get document(): Document {
    return this._document;
  }

  /**
   * Refresh cached document from store.
   */
  refresh(): void {
    this._document = this.store.getDocument();
  }

  /**
   * Create a new Doc with a single empty paragraph.
   */
  static create(): Doc {
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    return new Doc(store);
  }

  /**
   * Find a block by ID. Throws if not found.
   */
  getBlock(blockId: string): Block {
    const block = this._document.blocks.find((b) => b.id === blockId);
    if (!block) throw new Error(`Block not found: ${blockId}`);
    return block;
  }

  /**
   * Find block index by ID. Returns -1 if not found.
   */
  getBlockIndex(blockId: string): number {
    return this._document.blocks.findIndex((b) => b.id === blockId);
  }

  /**
   * Insert text at a document position.
   */
  insertText(pos: DocPosition, text: string): void {
    const block = this.getBlock(pos.blockId);
    const { inlineIndex, charOffset } = this.resolveOffset(block, pos.offset);
    const inline = block.inlines[inlineIndex];
    inline.text =
      inline.text.slice(0, charOffset) + text + inline.text.slice(charOffset);
    this.store.updateBlock(pos.blockId, block);
    this.refresh();
  }

  /**
   * Delete `length` characters forward from position.
   */
  deleteText(pos: DocPosition, length: number): void {
    const block = this.getBlock(pos.blockId);
    const blockLen = getBlockTextLength(block);
    let remaining = Math.min(length, blockLen - pos.offset);
    if (remaining <= 0) return;

    let offset = pos.offset;

    while (remaining > 0) {
      const { inlineIndex, charOffset } = this.resolveOffset(block, offset);
      const inline = block.inlines[inlineIndex];
      const available = inline.text.length - charOffset;
      if (available <= 0) break;
      const toDelete = Math.min(remaining, available);

      inline.text =
        inline.text.slice(0, charOffset) +
        inline.text.slice(charOffset + toDelete);

      remaining -= toDelete;

      // Remove empty inlines (but keep at least one)
      if (inline.text.length === 0 && block.inlines.length > 1) {
        block.inlines.splice(inlineIndex, 1);
      }
    }

    this.normalizeInlines(block);
    this.store.updateBlock(pos.blockId, block);
    this.refresh();
  }

  /**
   * Backspace: delete one character before position, or merge with
   * previous block if at the start of a block.
   * Returns the new cursor position after deletion.
   */
  deleteBackward(pos: DocPosition): DocPosition {
    if (pos.offset > 0) {
      const newPos = { blockId: pos.blockId, offset: pos.offset - 1 };
      this.deleteText(newPos, 1);
      return newPos;
    }

    // At start of block — merge with previous
    const blockIndex = this.getBlockIndex(pos.blockId);
    if (blockIndex <= 0) return pos;

    const prevBlock = this._document.blocks[blockIndex - 1];
    const currentBlock = this._document.blocks[blockIndex];

    // Cannot merge into a non-text block (e.g., horizontal-rule)
    if (prevBlock.type === 'horizontal-rule') {
      // Delete the HR instead
      this.store.deleteBlock(prevBlock.id);
      this.refresh();
      return pos;
    }

    const prevLength = getBlockTextLength(prevBlock);
    this.mergeBlocks(prevBlock.id, currentBlock.id);
    return { blockId: prevBlock.id, offset: prevLength };
  }

  /**
   * Split a block at the given offset (Enter key).
   * Returns the ID of the newly created block.
   */
  splitBlock(blockId: string, offset: number): string {
    const blockIndex = this.getBlockIndex(blockId);
    const block = this._document.blocks[blockIndex];
    const blockText = getBlockText(block);

    // Empty list-item: exit list by converting to paragraph
    if (block.type === 'list-item' && blockText.length === 0) {
      this.setBlockType(blockId, 'paragraph');
      return blockId;
    }

    // Horizontal rules should not be split — create paragraph after
    if (block.type === 'horizontal-rule') {
      const newBlock: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: '', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      this.store.insertBlock(blockIndex + 1, newBlock);
      this.refresh();
      return newBlock.id;
    }

    // Build inlines for the first block (before split)
    const beforeInlines = this.buildInlinesFromSplit(block, 0, offset);
    // Build inlines for the new block (after split)
    const afterInlines = this.buildInlinesFromSplit(
      block,
      offset,
      blockText.length,
    );

    // Update current block
    block.inlines =
      beforeInlines.length > 0
        ? beforeInlines
        : [{ text: '', style: this.getStyleAtOffset(block, offset) }];

    // Determine new block type
    let newType: BlockType = 'paragraph';
    const extra: Partial<Block> = {};
    if (block.type === 'list-item') {
      newType = 'list-item';
      extra.listKind = block.listKind;
      extra.listLevel = block.listLevel;
    }

    // Create new block
    const newBlock: Block = {
      id: generateBlockId(),
      type: newType,
      inlines:
        afterInlines.length > 0
          ? afterInlines
          : [{ text: '', style: this.getStyleAtOffset(block, offset) }],
      style: { ...block.style },
      ...extra,
    };

    this.store.updateBlock(blockId, block);
    this.store.insertBlock(blockIndex + 1, newBlock);
    this.refresh();
    return newBlock.id;
  }

  /**
   * Merge two adjacent blocks. The second block is removed.
   */
  mergeBlocks(blockId: string, nextBlockId: string): void {
    const block = this.getBlock(blockId);
    const nextBlock = this.getBlock(nextBlockId);

    block.inlines = [...block.inlines, ...nextBlock.inlines];
    this.normalizeInlines(block);

    this.store.updateBlock(blockId, block);
    this.store.deleteBlock(nextBlockId);
    this.refresh();
  }

  /**
   * Apply inline style to a range of text within a single block.
   */
  applyInlineStyle(range: DocRange, style: Partial<InlineStyle>): void {
    const startBlock = this.getBlockIndex(range.anchor.blockId);
    const endBlock = this.getBlockIndex(range.focus.blockId);

    // Normalize so start <= end
    const [from, to] =
      startBlock < endBlock ||
      (startBlock === endBlock && range.anchor.offset <= range.focus.offset)
        ? [range.anchor, range.focus]
        : [range.focus, range.anchor];

    const fromBlockIdx = this.getBlockIndex(from.blockId);
    const toBlockIdx = this.getBlockIndex(to.blockId);

    for (let i = fromBlockIdx; i <= toBlockIdx; i++) {
      const block = this._document.blocks[i];
      const blockLen = getBlockTextLength(block);
      const start = i === fromBlockIdx ? from.offset : 0;
      const end = i === toBlockIdx ? to.offset : blockLen;

      if (start >= end) continue;
      this.applyStyleToBlock(block, start, end, style);
      this.store.updateBlock(block.id, block);
    }

    this.refresh();
  }

  /**
   * Apply block-level style to a paragraph.
   */
  applyBlockStyle(blockId: string, style: Partial<BlockStyle>): void {
    const block = this.getBlock(blockId);
    block.style = { ...block.style, ...style };
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Change the block type, setting type-specific fields and clearing stale ones.
   */
  setBlockType(
    blockId: string,
    type: BlockType,
    opts?: {
      headingLevel?: HeadingLevel;
      listKind?: 'ordered' | 'unordered';
      listLevel?: number;
    },
  ): void {
    const block = this.getBlock(blockId);
    block.type = type;
    // Clear type-specific fields
    delete block.headingLevel;
    delete block.listKind;
    delete block.listLevel;
    // Set new type-specific fields
    if (type === 'heading') {
      block.headingLevel = opts?.headingLevel ?? 1;
    }
    if (type === 'list-item') {
      block.listKind = opts?.listKind ?? 'unordered';
      block.listLevel = opts?.listLevel ?? 0;
    }
    // Normalize inlines for block type invariant
    if (type === 'horizontal-rule') {
      block.inlines = [];
    } else if (block.inlines.length === 0) {
      block.inlines = [{ text: '', style: {} }];
    }
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Delete a block by ID.
   */
  deleteBlock(blockId: string): void {
    this.store.deleteBlock(blockId);
    this.refresh();
  }

  /**
   * Delete a block by index.
   */
  deleteBlockByIndex(index: number): void {
    this.store.deleteBlockByIndex(index);
    this.refresh();
  }

  /**
   * Update a block directly (e.g. after modifying its inlines externally).
   */
  updateBlockDirect(blockId: string, block: Block): void {
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Insert a block at a specific index.
   */
  insertBlockAt(index: number, block: Block): void {
    this.store.insertBlock(index, block);
    this.refresh();
  }

  /**
   * Search for text matches across all blocks.
   * Returns matches with block ID and character offsets.
   */
  searchText(query: string, options?: SearchOptions): SearchMatch[] {
    if (!query) return [];
    const matches: SearchMatch[] = [];
    const flags = options?.caseSensitive ? 'g' : 'gi';
    const pattern = options?.useRegex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

    for (const block of this._document.blocks) {
      const text = getBlockText(block);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        matches.push({
          blockId: block.id,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
        });
      }
    }
    return matches;
  }

  // --- Private helpers ---

  /**
   * Resolve a character offset within a block to the specific
   * inline index and character position within that inline.
   */
  private resolveOffset(
    block: Block,
    offset: number,
  ): { inlineIndex: number; charOffset: number } {
    let remaining = offset;
    for (let i = 0; i < block.inlines.length; i++) {
      const inline = block.inlines[i];
      if (remaining <= inline.text.length) {
        return { inlineIndex: i, charOffset: remaining };
      }
      remaining -= inline.text.length;
    }
    // Past the end — clamp to last inline
    const last = block.inlines.length - 1;
    return { inlineIndex: last, charOffset: block.inlines[last].text.length };
  }

  /**
   * Get the inline style at a given offset in a block.
   */
  private getStyleAtOffset(block: Block, offset: number): InlineStyle {
    const { inlineIndex } = this.resolveOffset(block, offset);
    return { ...block.inlines[inlineIndex].style };
  }

  /**
   * Build inlines for a substring of a block (used by splitBlock).
   */
  private buildInlinesFromSplit(
    block: Block,
    start: number,
    end: number,
  ): typeof block.inlines {
    const result: typeof block.inlines = [];
    let pos = 0;

    for (const inline of block.inlines) {
      const inlineEnd = pos + inline.text.length;
      if (inlineEnd <= start || pos >= end) {
        pos = inlineEnd;
        continue;
      }

      const sliceStart = Math.max(0, start - pos);
      const sliceEnd = Math.min(inline.text.length, end - pos);
      const text = inline.text.slice(sliceStart, sliceEnd);
      if (text.length > 0) {
        result.push({ text, style: { ...inline.style } });
      }
      pos = inlineEnd;
    }

    return result;
  }

  /**
   * Apply a partial style to a range within a single block.
   * Splits inlines as needed.
   */
  private applyStyleToBlock(
    block: Block,
    start: number,
    end: number,
    style: Partial<InlineStyle>,
  ): void {
    const resolvedStyle = { ...style };
    if (resolvedStyle.superscript) {
      resolvedStyle.subscript = undefined;
    } else if (resolvedStyle.subscript) {
      resolvedStyle.superscript = undefined;
    }

    const newInlines: typeof block.inlines = [];
    let pos = 0;

    for (const inline of block.inlines) {
      const inlineEnd = pos + inline.text.length;

      if (inlineEnd <= start || pos >= end) {
        // Completely outside range
        newInlines.push({ text: inline.text, style: { ...inline.style } });
      } else {
        // Overlaps with range — split into up to 3 parts
        const overlapStart = Math.max(0, start - pos);
        const overlapEnd = Math.min(inline.text.length, end - pos);

        // Before overlap
        if (overlapStart > 0) {
          newInlines.push({
            text: inline.text.slice(0, overlapStart),
            style: { ...inline.style },
          });
        }

        // Overlap (apply style)
        newInlines.push({
          text: inline.text.slice(overlapStart, overlapEnd),
          style: { ...inline.style, ...resolvedStyle },
        });

        // After overlap
        if (overlapEnd < inline.text.length) {
          newInlines.push({
            text: inline.text.slice(overlapEnd),
            style: { ...inline.style },
          });
        }
      }

      pos = inlineEnd;
    }

    block.inlines = newInlines;
    this.normalizeInlines(block);
  }

  /**
   * Merge adjacent inlines with identical styles.
   * Removes empty inlines (keeping at least one).
   */
  private normalizeInlines(block: Block): void {
    const inlines = block.inlines;
    const merged: typeof inlines = [];

    for (const inline of inlines) {
      if (inline.text.length === 0) continue;

      const last = merged[merged.length - 1];
      if (last && inlineStylesEqual(last.style, inline.style)) {
        last.text += inline.text;
      } else {
        merged.push({ text: inline.text, style: { ...inline.style } });
      }
    }

    block.inlines =
      merged.length > 0 ? merged : [{ text: '', style: inlines[0]?.style ?? {} }];
  }
}
