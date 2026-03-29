import {
  type Block,
  type BlockCellInfo,
  type BlockType,
  type CellAddress,
  type CellRange,
  type CellStyle,
  type DocPosition,
  type DocRange,
  type Document,
  type HeadingLevel,
  type Inline,
  type InlineStyle,
  type BlockStyle,
  type SearchOptions,
  type SearchMatch,
  type TableCell,
  createEmptyBlock,
  createTableBlock,
  createTableCell,
  getCellText,
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
  private _blockParentMap: Map<string, BlockCellInfo> = new Map();

  constructor(store: DocStore) {
    this.store = store;
    this._document = this.store.getDocument();
  }

  get document(): Document {
    return this._document;
  }

  setBlockParentMap(map: Map<string, BlockCellInfo>): void {
    this._blockParentMap = map;
  }

  get blockParentMap(): Map<string, BlockCellInfo> {
    return this._blockParentMap;
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
    if (block) return block;

    const cellInfo = this._blockParentMap.get(blockId);
    if (cellInfo) {
      const tableBlock = this._document.blocks.find((b) => b.id === cellInfo.tableBlockId);
      if (tableBlock?.tableData) {
        const cell = tableBlock.tableData.rows[cellInfo.rowIndex]?.cells[cellInfo.colIndex];
        const found = cell?.blocks.find((b) => b.id === blockId);
        if (found) return found;
      }
    }

    throw new Error(`Block not found: ${blockId}`);
  }

  /**
   * Find block index by ID. Returns -1 if not found.
   */
  getBlockIndex(blockId: string): number {
    return this._document.blocks.findIndex((b) => b.id === blockId);
  }

  /**
   * Find the parent table block for a cell-internal block.
   * Returns undefined if the block is not inside a table cell.
   */
  getParentTableBlock(blockId: string): Block | undefined {
    const cellInfo = this._blockParentMap.get(blockId);
    if (!cellInfo) return undefined;
    return this._document.blocks.find((b) => b.id === cellInfo.tableBlockId);
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
    this.updateBlockInStore(pos.blockId, block);
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
    this.updateBlockInStore(pos.blockId, block);
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
    const cellInfo = this._blockParentMap.get(blockId);
    if (cellInfo) {
      return this.splitBlockInCellInternal(cellInfo, blockId, offset);
    }

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
    const cellInfo = this._blockParentMap.get(blockId);
    if (cellInfo) {
      const tableBlock = this.getBlock(cellInfo.tableBlockId);
      const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
      const idx = cell.blocks.findIndex((b) => b.id === blockId);
      const nextIdx = cell.blocks.findIndex((b) => b.id === nextBlockId);
      if (idx === -1 || nextIdx === -1) return;

      const block = cell.blocks[idx];
      const nextBlock = cell.blocks[nextIdx];
      block.inlines = this.normalizeInlinesArray([...block.inlines, ...nextBlock.inlines]);
      cell.blocks.splice(nextIdx, 1);
      this.store.updateTableCell(cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex, cell);
      this.refresh();
      return;
    }

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
    const anchorCellInfo = this._blockParentMap.get(range.anchor.blockId);
    const focusCellInfo = this._blockParentMap.get(range.focus.blockId);

    // Same block (cell or top-level)
    if (range.anchor.blockId === range.focus.blockId) {
      const block = this.getBlock(range.anchor.blockId);
      const [start, end] = range.anchor.offset <= range.focus.offset
        ? [range.anchor.offset, range.focus.offset]
        : [range.focus.offset, range.anchor.offset];
      if (start < end) {
        this.applyStyleToBlock(block, start, end, style);
        this.updateBlockInStore(block.id, block);
      }
      this.refresh();
      return;
    }

    // Cross-block within same cell
    if (anchorCellInfo && focusCellInfo &&
        anchorCellInfo.tableBlockId === focusCellInfo.tableBlockId &&
        anchorCellInfo.rowIndex === focusCellInfo.rowIndex &&
        anchorCellInfo.colIndex === focusCellInfo.colIndex) {
      const tableBlock = this.getBlock(anchorCellInfo.tableBlockId);
      const cell = tableBlock.tableData!.rows[anchorCellInfo.rowIndex].cells[anchorCellInfo.colIndex];
      const anchorIdx = cell.blocks.findIndex((b) => b.id === range.anchor.blockId);
      const focusIdx = cell.blocks.findIndex((b) => b.id === range.focus.blockId);
      const [fromIdx, toIdx, from, to] = anchorIdx <= focusIdx
        ? [anchorIdx, focusIdx, range.anchor, range.focus]
        : [focusIdx, anchorIdx, range.focus, range.anchor];

      for (let i = fromIdx; i <= toIdx; i++) {
        const block = cell.blocks[i];
        const blockLen = getBlockTextLength(block);
        const start = i === fromIdx ? from.offset : 0;
        const end = i === toIdx ? to.offset : blockLen;
        if (start < end) {
          this.applyStyleToBlock(block, start, end, style);
        }
      }
      this.store.updateTableCell(anchorCellInfo.tableBlockId, anchorCellInfo.rowIndex, anchorCellInfo.colIndex, cell);
      this.refresh();
      return;
    }

    // Existing top-level cross-block logic
    // Normalize cell endpoints to their parent table block for index lookup
    const anchorTopId = anchorCellInfo ? anchorCellInfo.tableBlockId : range.anchor.blockId;
    const focusTopId = focusCellInfo ? focusCellInfo.tableBlockId : range.focus.blockId;
    const startBlock = this.getBlockIndex(anchorTopId);
    const endBlock = this.getBlockIndex(focusTopId);

    const [from, to] =
      startBlock < endBlock ||
      (startBlock === endBlock && range.anchor.offset <= range.focus.offset)
        ? [range.anchor, range.focus]
        : [range.focus, range.anchor];

    const fromTopId = this._blockParentMap.get(from.blockId)?.tableBlockId ?? from.blockId;
    const toTopId = this._blockParentMap.get(to.blockId)?.tableBlockId ?? to.blockId;
    const fromBlockIdx = this.getBlockIndex(fromTopId);
    const toBlockIdx = this.getBlockIndex(toTopId);

    for (let i = fromBlockIdx; i <= toBlockIdx; i++) {
      const block = this._document.blocks[i];

      // Table block in the middle of a cross-block selection:
      // apply style to every block in every cell.
      if (block.type === 'table' && block.tableData) {
        for (let r = 0; r < block.tableData.rows.length; r++) {
          for (let c = 0; c < block.tableData.rows[r].cells.length; c++) {
            const cell = block.tableData.rows[r].cells[c];
            if (cell.colSpan === 0) continue;
            for (const cellBlock of cell.blocks) {
              const len = getBlockTextLength(cellBlock);
              if (len > 0) {
                this.applyStyleToBlock(cellBlock, 0, len, style);
              }
            }
            this.store.updateTableCell(block.id, r, c, cell);
          }
        }
        continue;
      }

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
    this.updateBlockInStore(blockId, block);
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
    this.updateBlockInStore(blockId, block);
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
    let pattern: RegExp;
    try {
      pattern = options?.useRegex
        ? new RegExp(query, flags)
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch {
      return [];
    }

    for (const block of this._document.blocks) {
      if (block.type === 'table' && block.tableData) {
        // Search within each cell's blocks
        for (let r = 0; r < block.tableData.rows.length; r++) {
          const row = block.tableData.rows[r];
          for (let c = 0; c < row.cells.length; c++) {
            const cell = row.cells[c];
            for (let bi = 0; bi < cell.blocks.length; bi++) {
              const cellBlock = cell.blocks[bi];
              const text = getBlockText(cellBlock);
              pattern.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = pattern.exec(text)) !== null) {
                if (match[0].length === 0) {
                  pattern.lastIndex++;
                  continue;
                }
                matches.push({
                  blockId: cellBlock.id,
                  startOffset: match.index,
                  endOffset: match.index + match[0].length,
                });
              }
            }
          }
        }
      } else {
        const text = getBlockText(block);
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          if (match[0].length === 0) {
            pattern.lastIndex++;
            continue;
          }
          matches.push({
            blockId: block.id,
            startOffset: match.index,
            endOffset: match.index + match[0].length,
          });
        }
      }
    }
    return matches;
  }

  // --- Table methods ---

  /**
   * Insert a table block at the given block index.
   * Returns the new block's ID.
   */
  insertTable(blockIndex: number, rows: number, cols: number): string {
    const block = createTableBlock(rows, cols);
    this.store.insertBlock(blockIndex, block);
    this.refresh();
    return block.id;
  }

  /**
   * Insert a new row at the given index.
   */
  insertRow(blockId: string, atIndex: number): void {
    const block = this.getBlock(blockId);
    const td = block.tableData!;
    const colCount = td.columnWidths.length;
    const cells: TableCell[] = [];
    for (let c = 0; c < colCount; c++) {
      cells.push(createTableCell());
    }
    td.rows.splice(atIndex, 0, { cells });
    this.store.insertTableRow(blockId, atIndex, td.rows[atIndex]);
    this.refresh();
  }

  /**
   * Delete a row at the given index. Adjusts rowSpan of cells that span
   * across the deleted row. Prevents deleting the last row.
   */
  deleteRow(blockId: string, rowIndex: number): void {
    const block = this.getBlock(blockId);
    const td = block.tableData!;
    if (td.rows.length <= 1) return; // Prevent 0-row table

    // Adjust rowSpan for cells above that span into the deleted row
    for (let r = 0; r < rowIndex; r++) {
      for (let c = 0; c < td.rows[r].cells.length; c++) {
        const cell = td.rows[r].cells[c];
        const rs = cell.rowSpan ?? 1;
        if (r + rs > rowIndex) {
          cell.rowSpan = rs - 1;
          this.store.updateTableCell(blockId, r, c, cell);
        }
      }
    }
    td.rows.splice(rowIndex, 1);
    this.store.deleteTableRow(blockId, rowIndex);
    this.refresh();
  }

  /**
   * Insert a column at the given index, renormalize widths.
   */
  insertColumn(blockId: string, atIndex: number): void {
    const block = this.getBlock(blockId);
    const td = block.tableData!;
    td.columnWidths.splice(atIndex, 0, 0);
    // Renormalize to equal widths
    const count = td.columnWidths.length;
    for (let i = 0; i < count; i++) {
      td.columnWidths[i] = 1 / count;
    }
    for (const row of td.rows) {
      row.cells.splice(atIndex, 0, createTableCell());
    }
    const newCells = td.rows.map((row) => row.cells[atIndex]);
    this.store.insertTableColumn(blockId, atIndex, newCells);
    this.store.updateTableAttrs(blockId, { cols: td.columnWidths });
    this.refresh();
  }

  /**
   * Delete a column at the given index, renormalize widths. Adjusts colSpan
   * of cells that span across the deleted column. Prevents deleting the last column.
   */
  deleteColumn(blockId: string, colIndex: number): void {
    const block = this.getBlock(blockId);
    const td = block.tableData!;
    if (td.columnWidths.length <= 1) return; // Prevent 0-column table

    // Adjust colSpan for cells left of the deleted column that span into it
    for (let ri = 0; ri < td.rows.length; ri++) {
      for (let c = 0; c < colIndex; c++) {
        const cell = td.rows[ri].cells[c];
        const cs = cell.colSpan ?? 1;
        if (c + cs > colIndex) {
          cell.colSpan = cs - 1;
          this.store.updateTableCell(blockId, ri, c, cell);
        }
      }
    }

    td.columnWidths.splice(colIndex, 1);
    const count = td.columnWidths.length;
    for (let i = 0; i < count; i++) {
      td.columnWidths[i] = 1 / count;
    }
    for (const row of td.rows) {
      row.cells.splice(colIndex, 1);
    }
    this.store.deleteTableColumn(blockId, colIndex);
    this.store.updateTableAttrs(blockId, { cols: td.columnWidths });
    this.refresh();
  }

  /**
   * Merge cells in the given range. Top-left cell gets colSpan/rowSpan,
   * covered cells get colSpan: 0. Text from covered cells is appended
   * to the top-left cell.
   */
  mergeCells(blockId: string, range: CellRange): void {
    const block = this.getBlock(blockId);
    const td = block.tableData!;
    const { start, end } = range;
    const topLeft = td.rows[start.rowIndex].cells[start.colIndex];
    const rowSpan = end.rowIndex - start.rowIndex + 1;
    const colSpan = end.colIndex - start.colIndex + 1;

    // Collect blocks from all cells in range (row-major, skip top-left)
    for (let r = start.rowIndex; r <= end.rowIndex; r++) {
      for (let c = start.colIndex; c <= end.colIndex; c++) {
        if (r === start.rowIndex && c === start.colIndex) continue;
        const cell = td.rows[r].cells[c];
        const cellTextContent = getCellText(cell);
        if (cellTextContent.length > 0) {
          // Append all non-empty blocks from source cell to top-left
          for (const srcBlock of cell.blocks) {
            const nonEmpty = srcBlock.inlines.filter((i) => i.text.length > 0);
            if (nonEmpty.length > 0) {
              topLeft.blocks.push({
                id: generateBlockId(),
                type: srcBlock.type,
                inlines: nonEmpty,
                style: { ...srcBlock.style },
                ...(srcBlock.listKind ? { listKind: srcBlock.listKind } : {}),
                ...(srcBlock.listLevel !== undefined ? { listLevel: srcBlock.listLevel } : {}),
                ...(srcBlock.headingLevel !== undefined ? { headingLevel: srcBlock.headingLevel } : {}),
              });
            }
          }
        }
        // Mark as covered
        cell.blocks = [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }];
        cell.colSpan = 0;
        cell.rowSpan = undefined;
      }
    }

    // Normalize inlines in each block of the merged cell
    for (const blk of topLeft.blocks) {
      blk.inlines = this.normalizeInlinesArray(blk.inlines);
    }
    topLeft.colSpan = colSpan;
    topLeft.rowSpan = rowSpan;
    // Update each affected cell in the store
    for (let r = start.rowIndex; r <= end.rowIndex; r++) {
      for (let c = start.colIndex; c <= end.colIndex; c++) {
        this.store.updateTableCell(blockId, r, c, td.rows[r].cells[c]);
      }
    }
    this.refresh();
  }

  /**
   * Split a previously merged cell, restoring all covered cells.
   */
  splitCell(blockId: string, cell: CellAddress): void {
    const block = this.getBlock(blockId);
    const td = block.tableData!;
    const target = td.rows[cell.rowIndex].cells[cell.colIndex];
    const rowSpan = target.rowSpan ?? 1;
    const colSpan = target.colSpan ?? 1;

    // Clear merge on top-left
    delete target.colSpan;
    delete target.rowSpan;

    // Restore covered cells
    for (let r = cell.rowIndex; r < cell.rowIndex + rowSpan; r++) {
      for (let c = cell.colIndex; c < cell.colIndex + colSpan; c++) {
        if (r === cell.rowIndex && c === cell.colIndex) continue;
        const covered = td.rows[r].cells[c];
        delete covered.colSpan;
        delete covered.rowSpan;
        covered.blocks = [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }];
      }
    }

    for (let r = cell.rowIndex; r < cell.rowIndex + rowSpan; r++) {
      for (let c = cell.colIndex; c < cell.colIndex + colSpan; c++) {
        this.store.updateTableCell(blockId, r, c, td.rows[r].cells[c]);
      }
    }
    this.refresh();
  }

  /**
   * Apply CellStyle to a table cell.
   */
  applyCellStyle(
    blockId: string,
    cell: CellAddress,
    style: Partial<CellStyle>,
  ): void {
    const block = this.getBlock(blockId);
    const tableCell = this.getTableCell(block, cell);
    tableCell.style = { ...tableCell.style, ...style };
    this.store.updateTableCell(blockId, cell.rowIndex, cell.colIndex, tableCell);
    this.refresh();
  }

  /**
   * Set a column's width ratio and renormalize the remaining columns
   * so all widths sum to 1.0.
   */
  setColumnWidth(blockId: string, colIndex: number, ratio: number): void {
    const block = this.getBlock(blockId);
    const td = block.tableData!;
    const count = td.columnWidths.length;
    const remaining = 1.0 - ratio;
    const otherCount = count - 1;
    td.columnWidths[colIndex] = ratio;
    if (otherCount > 0) {
      const each = remaining / otherCount;
      for (let i = 0; i < count; i++) {
        if (i !== colIndex) td.columnWidths[i] = each;
      }
    }
    this.store.updateTableAttrs(blockId, { cols: td.columnWidths });
    this.refresh();
  }

  // --- Private helpers ---

  /**
   * Update a block in the store. For cell blocks, updates the parent
   * table block instead.
   */
  private updateBlockInStore(blockId: string, block: Block): void {
    const cellInfo = this._blockParentMap.get(blockId);
    if (cellInfo) {
      const tableBlock = this._document.blocks.find((b) => b.id === cellInfo.tableBlockId);
      if (tableBlock) {
        const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
        this.store.updateTableCell(cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex, cell);
      }
    } else {
      this.store.updateBlock(blockId, block);
    }
  }

  /**
   * Split a block within a table cell using BlockCellInfo lookup.
   * Returns the ID of the newly created block.
   */
  private splitBlockInCellInternal(
    cellInfo: BlockCellInfo,
    blockId: string,
    offset: number,
  ): string {
    const tableBlock = this.getBlock(cellInfo.tableBlockId);
    const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
    const cellBlockIndex = cell.blocks.findIndex((b) => b.id === blockId);
    const targetBlock = cell.blocks[cellBlockIndex];
    if (!targetBlock) return blockId;

    const blockText = getBlockText(targetBlock);

    if (targetBlock.type === 'list-item' && blockText.length === 0) {
      targetBlock.type = 'paragraph';
      delete targetBlock.listKind;
      delete targetBlock.listLevel;
      this.store.updateTableCell(cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex, cell);
      this.refresh();
      return blockId;
    }

    // Horizontal rules should not be split — create paragraph after
    if (targetBlock.type === 'horizontal-rule') {
      const newBlock: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: '', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      cell.blocks.splice(cellBlockIndex + 1, 0, newBlock);
      this.store.updateTableCell(cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex, cell);
      this.refresh();
      return newBlock.id;
    }

    const beforeInlines = this.buildInlinesFromSplit(targetBlock, 0, offset);
    const afterInlines = this.buildInlinesFromSplit(targetBlock, offset, blockText.length);
    const cursorStyle = this.getStyleAtOffset(targetBlock, offset);

    targetBlock.inlines = beforeInlines.length > 0
      ? beforeInlines
      : [{ text: '', style: cursorStyle }];

    let newType: BlockType = 'paragraph';
    const extra: Partial<Block> = {};
    if (targetBlock.type === 'list-item') {
      newType = 'list-item';
      extra.listKind = targetBlock.listKind;
      extra.listLevel = targetBlock.listLevel;
    }

    const newBlock: Block = {
      id: generateBlockId(),
      type: newType,
      inlines: afterInlines.length > 0
        ? afterInlines
        : [{ text: '', style: cursorStyle }],
      style: { ...targetBlock.style },
      ...extra,
    };

    cell.blocks.splice(cellBlockIndex + 1, 0, newBlock);
    this.store.updateTableCell(cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex, cell);
    this.refresh();
    return newBlock.id;
  }

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
    block.inlines = this.normalizeInlinesArray(block.inlines);
  }

  /**
   * Get a table cell from a block, throwing if the block has no table data.
   */
  private getTableCell(block: Block, cell: CellAddress): TableCell {
    if (!block.tableData) throw new Error('Block is not a table');
    return block.tableData.rows[cell.rowIndex].cells[cell.colIndex];
  }

  /**
   * Merge adjacent same-style inlines, remove empties (keep at least one).
   */
  private normalizeInlinesArray(inlines: Inline[]): Inline[] {
    const merged: Inline[] = [];

    for (const inline of inlines) {
      if (inline.text.length === 0) continue;

      const last = merged[merged.length - 1];
      if (last && inlineStylesEqual(last.style, inline.style)) {
        last.text += inline.text;
      } else {
        merged.push({ text: inline.text, style: { ...inline.style } });
      }
    }

    return merged.length > 0
      ? merged
      : [{ text: '', style: inlines[0]?.style ?? {} }];
  }
}
