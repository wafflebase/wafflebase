import {
  type Block,
  type DocPosition,
  type DocRange,
  type Document,
  type InlineStyle,
  type BlockStyle,
  createEmptyBlock,
  getBlockText,
  getBlockTextLength,
  inlineStylesEqual,
  generateBlockId,
} from './types.js';

/**
 * Document manipulation logic.
 *
 * Operates directly on a Document object. All mutations return void
 * and modify the document in place.
 */
export class Doc {
  constructor(public document: Document) {}

  /**
   * Create a new Doc with a single empty paragraph.
   */
  static create(): Doc {
    return new Doc({ blocks: [createEmptyBlock()] });
  }

  /**
   * Find a block by ID. Throws if not found.
   */
  getBlock(blockId: string): Block {
    const block = this.document.blocks.find((b) => b.id === blockId);
    if (!block) throw new Error(`Block not found: ${blockId}`);
    return block;
  }

  /**
   * Find block index by ID. Returns -1 if not found.
   */
  getBlockIndex(blockId: string): number {
    return this.document.blocks.findIndex((b) => b.id === blockId);
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
  }

  /**
   * Delete `length` characters forward from position.
   */
  deleteText(pos: DocPosition, length: number): void {
    const block = this.getBlock(pos.blockId);
    let remaining = length;
    let offset = pos.offset;

    while (remaining > 0) {
      const { inlineIndex, charOffset } = this.resolveOffset(block, offset);
      const inline = block.inlines[inlineIndex];
      const available = inline.text.length - charOffset;
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

    const prevBlock = this.document.blocks[blockIndex - 1];
    const prevLength = getBlockTextLength(prevBlock);
    const currentBlock = this.document.blocks[blockIndex];

    this.mergeBlocks(prevBlock.id, currentBlock.id);
    return { blockId: prevBlock.id, offset: prevLength };
  }

  /**
   * Split a block at the given offset (Enter key).
   * Returns the ID of the newly created block.
   */
  splitBlock(blockId: string, offset: number): string {
    const blockIndex = this.getBlockIndex(blockId);
    const block = this.document.blocks[blockIndex];
    const blockText = getBlockText(block);

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

    // Create new block
    const newBlock: Block = {
      id: generateBlockId(),
      type: 'paragraph',
      inlines:
        afterInlines.length > 0
          ? afterInlines
          : [{ text: '', style: this.getStyleAtOffset(block, offset) }],
      style: { ...block.style },
    };

    this.document.blocks.splice(blockIndex + 1, 0, newBlock);
    return newBlock.id;
  }

  /**
   * Merge two adjacent blocks. The second block is removed.
   */
  mergeBlocks(blockId: string, nextBlockId: string): void {
    const block = this.getBlock(blockId);
    const nextBlock = this.getBlock(nextBlockId);
    const nextIndex = this.getBlockIndex(nextBlockId);

    block.inlines = [...block.inlines, ...nextBlock.inlines];
    this.normalizeInlines(block);

    this.document.blocks.splice(nextIndex, 1);
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
      const block = this.document.blocks[i];
      const blockLen = getBlockTextLength(block);
      const start = i === fromBlockIdx ? from.offset : 0;
      const end = i === toBlockIdx ? to.offset : blockLen;

      if (start >= end) continue;
      this.applyStyleToBlock(block, start, end, style);
    }
  }

  /**
   * Apply block-level style to a paragraph.
   */
  applyBlockStyle(blockId: string, style: Partial<BlockStyle>): void {
    const block = this.getBlock(blockId);
    block.style = { ...block.style, ...style };
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
          style: { ...inline.style, ...style },
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
