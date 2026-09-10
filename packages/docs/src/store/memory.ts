import type { Block, BlockStyle, CellStyle, Document, HeadingLevel, HeaderFooter, Inline, InlineStyle, PageSetup, TableRow, TableCell, BlockType } from '../model/types.js';
import { resolvePageSetup, normalizeBlockStyle, normalizeCellStyleClears } from '../model/types.js';
import type { DocStyles, NamedStyleDef, StyleId } from '../model/named-styles.js';
import { blockStyleId, materializeBlockSpacing, rematerializeDocSpacing } from '../model/named-styles.js';
import type { DocStore } from './store.js';
import { applyInsertText, applyDeleteText, applyInlineStyle as applyInlineStyleHelper, applyInsertInline, applySplitBlock, applyMergeBlocks } from './block-helpers.js';

/**
 * Deep clone a document for snapshot-based undo/redo.
 */
function cloneDocument(doc: Document): Document {
  const cloned: Document = JSON.parse(JSON.stringify(doc));
  for (const block of cloned.blocks) {
    block.style = normalizeBlockStyle(block.style);
  }
  if (cloned.header) {
    for (const block of cloned.header.blocks) {
      block.style = normalizeBlockStyle(block.style);
    }
  }
  if (cloned.footer) {
    for (const block of cloned.footer.blocks) {
      block.style = normalizeBlockStyle(block.style);
    }
  }
  return cloned;
}

/**
 * In-memory DocStore implementation with snapshot-based undo/redo.
 */
export class MemDocStore implements DocStore {
  private doc: Document;
  private undoStack: Document[] = [];
  private redoStack: Document[] = [];
  /** Depth of nested `batch()` calls; 0 outside a batch. */
  private batchDepth = 0;
  /**
   * A checkpoint recorded by `snapshot()` (or opened by `batch()`) that no
   * write has claimed yet. Null when there is none.
   *
   * The write is what costs an undo unit, so the checkpoint is materialized
   * onto {@link undoStack} by the first {@link willWrite} that follows —
   * never by `snapshot()` itself. See `snapshot()` for why.
   *
   * **Invariant: when non-null this holds a clone equal to the current
   * document.** It is only ever set from `cloneDocument(this.doc)`, it is
   * consumed by the first write, and `undo()` / `redo()` — the only other
   * things that move `this.doc` — discard it. Everything else here relies on
   * that, which is what lets `batch()` adopt it without comparing values.
   */
  private pendingSnapshot: Document | null = null;

  constructor(doc?: Document) {
    this.doc = doc ? cloneDocument(doc) : { blocks: [] };
  }

  getDocument(): Document {
    return cloneDocument(this.doc);
  }

  setDocument(doc: Document): void {
    // Prohibited inside a batch so both stores enforce the same contract.
    // `YorkieDocStore.setDocument()` throws because it reads its `undoFloor`
    // *after* the write lands, which inside a batch is not until the batch's
    // single `doc.update` closes — the floor would land one unit low and the
    // whole loaded document would become undoable. Nothing breaks here, but
    // the docs package's only store is this one, so code written and tested
    // against it would pass and then throw under the collaborative store.
    if (this.batchDepth > 0) {
      throw new Error('setDocument() must not be called inside batch()');
    }
    this.willWrite();
    this.doc = cloneDocument(doc);
  }

  replaceDocument(doc: Document): void {
    this.willWrite();
    this.doc = cloneDocument(doc);
  }

  getBlock(id: string): Block | undefined {
    try {
      const { blocks, index } = this.findBlockInAnyArray(id);
      return JSON.parse(JSON.stringify(blocks[index]));
    } catch {
      return undefined;
    }
  }

  updateBlock(id: string, block: Block): void {
    this.willWrite();
    const { blocks, index } = this.findBlockInAnyArray(id);
    blocks[index] = JSON.parse(JSON.stringify(block));
  }

  insertBlock(index: number, block: Block): void {
    this.willWrite();
    this.doc.blocks.splice(index, 0, JSON.parse(JSON.stringify(block)));
  }

  insertBlockAfter(siblingBlockId: string, block: Block): void {
    this.willWrite();
    const { blocks, index } = this.findBlockInAnyArray(siblingBlockId);
    blocks.splice(index + 1, 0, JSON.parse(JSON.stringify(block)));
  }

  insertBlocksAfter(siblingBlockId: string, newBlocks: Block[]): void {
    if (newBlocks.length === 0) return;
    this.willWrite();
    const { blocks, index } = this.findBlockInAnyArray(siblingBlockId);
    blocks.splice(index + 1, 0, ...JSON.parse(JSON.stringify(newBlocks)));
  }

  deleteBlock(id: string): void {
    this.willWrite();
    const { blocks, index } = this.findBlockInAnyArray(id);
    blocks.splice(index, 1);
  }

  deleteBlockByIndex(index: number): void {
    if (index < 0 || index >= this.doc.blocks.length) {
      throw new Error(`Block index out of bounds: ${index}`);
    }
    this.willWrite();
    this.doc.blocks.splice(index, 1);
  }

  getPageSetup(): PageSetup {
    return resolvePageSetup(this.doc.pageSetup);
  }

  setPageSetup(setup: PageSetup): void {
    this.willWrite();
    this.doc.pageSetup = JSON.parse(JSON.stringify(setup));
  }

  getDocStyles(): DocStyles {
    return this.doc.styles ? JSON.parse(JSON.stringify(this.doc.styles)) : {};
  }

  setDocStyles(styles: DocStyles): void {
    this.willWrite();
    this.doc.styles = JSON.parse(JSON.stringify(styles));
    // Re-materialize spacing across all styled blocks so "Use my default
    // styles" applies paragraph spacing too (inline defaults reflow lazily).
    rematerializeDocSpacing(this.doc);
  }

  updateStyleDefinition(styleId: StyleId, def: NamedStyleDef): void {
    this.willWrite();
    if (!this.doc.styles) this.doc.styles = {};
    this.doc.styles[styleId] = JSON.parse(JSON.stringify(def));
    rematerializeDocSpacing(this.doc, styleId);
  }

  resetStyle(styleId: StyleId): void {
    this.willWrite();
    if (this.doc.styles) delete this.doc.styles[styleId];
    rematerializeDocSpacing(this.doc, styleId);
  }

  resetAllStyles(): void {
    this.willWrite();
    this.doc.styles = {};
    rematerializeDocSpacing(this.doc);
  }

  getHeader(): HeaderFooter | undefined {
    return this.doc.header ? JSON.parse(JSON.stringify(this.doc.header)) : undefined;
  }

  getFooter(): HeaderFooter | undefined {
    return this.doc.footer ? JSON.parse(JSON.stringify(this.doc.footer)) : undefined;
  }

  setHeader(header: HeaderFooter | undefined): void {
    this.willWrite();
    this.doc.header = header ? JSON.parse(JSON.stringify(header)) : undefined;
  }

  setFooter(footer: HeaderFooter | undefined): void {
    this.willWrite();
    this.doc.footer = footer ? JSON.parse(JSON.stringify(footer)) : undefined;
  }

  undo(): void {
    if (!this.canUndo()) return;
    // A checkpoint nothing has written against describes the state this is
    // about to leave, so it cannot be the "before" of anything that comes
    // next. Discarding it here (and in `redo`) is what upholds
    // `pendingSnapshot`'s invariant, since these are the only two places
    // `this.doc` moves without a write.
    this.pendingSnapshot = null;
    this.redoStack.push(cloneDocument(this.doc));
    this.doc = this.undoStack.pop()!;
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.pendingSnapshot = null;
    this.undoStack.push(cloneDocument(this.doc));
    this.doc = this.redoStack.pop()!;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Claim the pending checkpoint and drop the redo history, because the
   * document is about to change.
   *
   * A **write** is what costs an undo unit and what invalidates redo here —
   * not `snapshot()`, which only records a checkpoint.  `YorkieDocStore` has
   * both rules for free: its `snapshot()` is a no-op, and `doc.history` takes
   * its units from `doc.update()` and clears redo when a change is pushed.
   * Doing either in `snapshot()` instead made the two stores answer
   * differently for the `saveSnapshot(); withUndoUnit(…)` ordering
   * `TextEditor` requires — see `snapshot()` and `batch()`.
   *
   * Called before the mutation rather than after, so a method that throws
   * part-way still leaves the checkpoint that makes its partial write
   * undoable, and no redo entry that could be applied on top of it.
   */
  private willWrite(): void {
    if (this.pendingSnapshot !== null) {
      this.undoStack.push(this.pendingSnapshot);
      this.pendingSnapshot = null;
    }
    this.redoStack = [];
  }

  snapshot(): void {
    // Inside a batch the checkpoint has already been taken by `batch()`
    // itself, and it captured the true pre-batch state. Recording again here
    // would be harmless (the pending one already holds this state) but would
    // discard the batch's own handle on it, so it is skipped outright.
    if (this.batchDepth > 0) return;
    // Recorded, not pushed. A checkpoint holds exactly the current document,
    // so until something is written it is a Cmd+Z that changes nothing — and
    // an action that snapshots and then writes nothing is ordinary (the
    // indent button with every list item already at `MAX_LIST_LEVEL`, a
    // find-replace with no matches). Pushing eagerly cost the user a dead
    // Cmd+Z and, since redo survives, a dead Cmd+Shift+Z after it, leaving
    // the real redo entry one press further away than it looks.
    // `willWrite()` materializes it if and when a write arrives, which is
    // also the answer `YorkieDocStore` gives.
    this.pendingSnapshot = cloneDocument(this.doc);
  }

  batch(fn: () => void): void {
    // Nested batch: already covered by the outer one's checkpoint. Just run
    // the body — opening a second would split one action into two undo
    // units, exactly what the seam exists to prevent.
    if (this.batchDepth > 0) {
      this.batchDepth++;
      try {
        fn();
      } finally {
        this.batchDepth--;
      }
      return;
    }
    // Open a checkpoint for the whole body rather than letting the body's own
    // `snapshot()` do it. A body that writes *before* it snapshots is
    // ordinary — every editor operation snapshots partway through, so
    // composing two of them lands here — and those first writes must not
    // become unundoable; a body that never snapshots at all must still cost
    // one unit. `YorkieDocStore` answers both by construction: its single
    // `doc.update` covers the body regardless.
    //
    // A `snapshot()` taken *immediately before* the batch is the one ordering
    // this must not double-count. `TextEditor.withUndoUnit()` needs it there,
    // because on `YorkieDocStore` the snapshot also flushes the pre-edit
    // caret into presence and that write is dropped inside an open batch
    // (`skipNonHistoryPresence`). Here it has left a checkpoint pending which
    // — by `pendingSnapshot`'s invariant — holds exactly this state, so it
    // *is* the "before" this batch wants: adopt it instead of recording a
    // second, identical one, which would cost a dead Cmd+Z on every edit in
    // every `MemDocStore` host (slides text boxes, the docs demo, the visual
    // harness).
    //
    // This is not `MemSlidesStore.batch()`'s shape. That store has no
    // `snapshot()` seam at all — its mutators `requireBatch()` — so it pushes
    // unconditionally and clears redo inside `batch()`, and there is no
    // ordering for it to reconcile. The two stores agree on what a *user*
    // sees (one batch, one undo unit); they do not share this implementation.
    const adopted = this.pendingSnapshot !== null;
    const before = this.pendingSnapshot ?? cloneDocument(this.doc);
    this.pendingSnapshot = before;
    const beforeJson = JSON.stringify(before);
    // Redo is dropped by the body's first write (`willWrite`), not here, so a
    // body that writes nothing never touches it. `priorRedo` still puts it
    // back for a body that writes and then reverts itself, which
    // `wroteNothing` also treats as free.
    const priorRedo = this.redoStack;
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      // A batch that wrote nothing costs no undo unit — and no redo history
      // either, which is why `priorRedo` is put back rather than left
      // cleared. `YorkieDocStore` pushes no change in that case, so
      // `doc.history` keeps its redo stack; the two stores share one
      // contract, so this one must too.
      //
      // Compared rather than tracked with a flag so a body that writes and
      // then reverts itself is also free. Both sides of the comparison go
      // through `cloneDocument`, which normalizes block styles: comparing a
      // normalized clone against the raw live document would report a write
      // for any document holding a partial style (`updateBlock` stores one
      // verbatim), leaving a dead undo checkpoint behind.
      //
      // On a throw the partial writes stand (this store does not roll back),
      // so a materialized checkpoint is kept — that is what makes the mess
      // undoable.
      const wroteNothing = beforeJson === JSON.stringify(cloneDocument(this.doc));
      if (wroteNothing) {
        // Give back only a checkpoint this batch opened itself. An *adopted*
        // one belongs to the `snapshot()` that ran before the batch, and that
        // snapshot covers the whole action — including writes the caller makes
        // after the unit closes. `TextEditor.handleBackspace()` is exactly
        // that shape (`saveSnapshot()`, then `deleteSelection()`, then more
        // writes when it returns false), so dropping it here would leave
        // those trailing writes permanently unundoable.
        if (!adopted) {
          if (this.undoStack[this.undoStack.length - 1] === before) {
            // The body wrote (and reverted): the checkpoint was materialized.
            this.undoStack.pop();
          } else if (this.pendingSnapshot === before) {
            // The body never wrote at all, so it is still pending.
            this.pendingSnapshot = null;
          }
        }
        this.redoStack = priorRedo;
      }
    }
  }

  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void {
    this.willWrite();
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.splice(atIndex, 0, JSON.parse(JSON.stringify(row)));
  }

  deleteTableRow(tableBlockId: string, rowIndex: number): void {
    this.willWrite();
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.splice(rowIndex, 1);
  }

  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void {
    this.willWrite();
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.forEach((row, i) => {
      row.cells.splice(atIndex, 0, JSON.parse(JSON.stringify(cells[i])));
    });
  }

  deleteTableColumn(tableBlockId: string, colIndex: number): void {
    this.willWrite();
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.forEach((row) => {
      row.cells.splice(colIndex, 1);
    });
  }

  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void {
    this.willWrite();
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows[rowIndex].cells[colIndex] = JSON.parse(JSON.stringify(cell));
  }

  updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: (number | undefined)[] }): void {
    this.willWrite();
    const block = this.findBlock(tableBlockId);
    block.tableData!.columnWidths = [...attrs.cols];
    if (attrs.rowHeights !== undefined) {
      block.tableData!.rowHeights = [...attrs.rowHeights];
    }
  }

  insertText(blockId: string, offset: number, text: string): void {
    this.willWrite();
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    blocks[index] = applyInsertText(blocks[index], offset, text);
  }

  deleteText(blockId: string, offset: number, length: number): void {
    this.willWrite();
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    blocks[index] = applyDeleteText(blocks[index], offset, length);
  }

  applyStyle(blockId: string, fromOffset: number, toOffset: number, style: Partial<InlineStyle>): void {
    this.willWrite();
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    blocks[index] = applyInlineStyleHelper(blocks[index], fromOffset, toOffset, style);
  }

  applyStyles(
    edits: Array<{ blockId: string; fromOffset: number; toOffset: number; style: Partial<InlineStyle> }>,
  ): void {
    for (const edit of edits) {
      this.applyStyle(edit.blockId, edit.fromOffset, edit.toOffset, edit.style);
    }
  }

  splitBlock(blockId: string, offset: number, newBlockId: string, newBlockType: BlockType): void {
    this.willWrite();
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    const [before, after] = applySplitBlock(blocks[index], offset, newBlockId, newBlockType);
    blocks[index] = before;
    blocks.splice(index + 1, 0, after);
  }

  mergeBlock(blockId: string, nextBlockId: string): void {
    if (blockId === nextBlockId) throw new Error('Cannot merge a block with itself');
    const { blocks: arr1, index: idx1 } = this.findBlockInAnyArray(blockId);
    const { blocks: arr2, index: idx2 } = this.findBlockInAnyArray(nextBlockId);
    if (arr1 !== arr2) throw new Error('Cannot merge blocks from different regions');
    this.willWrite();
    arr1[idx1] = applyMergeBlocks(arr1[idx1], arr2[idx2]);
    arr2.splice(idx2, 1);
  }

  setBlockType(
    blockId: string,
    type: BlockType,
    opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number },
  ): void {
    this.willWrite();
    const block = this.findBlock(blockId);
    const prevStyleId = blockStyleId(block);
    const prevHeadingLevel = block.headingLevel;
    block.type = type;
    delete block.headingLevel;
    delete block.listKind;
    delete block.listLevel;
    if (type === 'heading') {
      block.headingLevel = opts?.headingLevel ?? 1;
    }
    if (type === 'list-item') {
      // A bulleted heading remembers its level so removing the list restores
      // the heading instead of flattening it to body text (see `Block`).
      if (prevHeadingLevel !== undefined) block.headingLevel = prevHeadingLevel;
      block.listKind = opts?.listKind ?? 'unordered';
      block.listLevel = opts?.listLevel ?? 0;
    }
    if (type === 'horizontal-rule' || type === 'page-break') {
      block.inlines = [];
    } else if (block.inlines.length === 0) {
      block.inlines = [{ text: '', style: {} }];
    }
    // Applying a different named style resets the block's style-owned spacing
    // to that style's definition (Google Docs parity). A bullet toggle
    // (paragraph↔list-item, both 'normal') leaves spacing untouched.
    if (blockStyleId(block) !== prevStyleId) {
      block.style = materializeBlockSpacing(block, this.doc.styles);
    }
  }

  applyBlockStyle(blockId: string, style: Partial<BlockStyle>): void {
    this.willWrite();
    const block = this.findBlock(blockId);
    block.style = normalizeBlockStyle({ ...block.style, ...style });
  }

  applyCellStyle(
    tableBlockId: string, rowIndex: number, colIndex: number,
    style: Partial<CellStyle>,
  ): void {
    this.willWrite();
    const block = this.findBlock(tableBlockId);
    const cell = block.tableData!.rows[rowIndex].cells[colIndex];
    // The cell-background "Reset" entry passes `''`; normalizing it to an
    // explicit `undefined` and then dropping the key keeps this cache in step
    // with the Yorkie store, which removes the attribute outright (#793).
    // Spreading alone would leave the key present holding `undefined`, so
    // `'backgroundColor' in cell.style` would answer true here and false there.
    const cleared = normalizeCellStyleClears(style);
    const merged: CellStyle = { ...cell.style, ...cleared };
    for (const key of Object.keys(cleared) as Array<keyof CellStyle>) {
      if (cleared[key] === undefined) delete merged[key];
    }
    cell.style = merged;
  }

  applyCellSpan(
    tableBlockId: string, rowIndex: number, colIndex: number,
    span: { colSpan?: number; rowSpan?: number },
  ): void {
    this.willWrite();
    const block = this.findBlock(tableBlockId);
    const cell = block.tableData!.rows[rowIndex].cells[colIndex];
    if (span.colSpan !== undefined) {
      cell.colSpan = span.colSpan === 1 ? undefined : span.colSpan;
    }
    if (span.rowSpan !== undefined) {
      cell.rowSpan = span.rowSpan === 1 ? undefined : span.rowSpan;
    }
  }

  insertImageInline(blockId: string, offset: number, inline: Inline): void {
    this.willWrite();
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    blocks[index] = applyInsertInline(blocks[index], offset, inline);
  }

  private findBlock(id: string): Block {
    const { blocks, index } = this.findBlockInAnyArray(id);
    return blocks[index];
  }

  private findBlockInAnyArray(id: string): { blocks: Block[]; index: number } {
    const bodyIdx = this.doc.blocks.findIndex((b) => b.id === id);
    if (bodyIdx !== -1) return { blocks: this.doc.blocks, index: bodyIdx };
    if (this.doc.header) {
      const hIdx = this.doc.header.blocks.findIndex((b) => b.id === id);
      if (hIdx !== -1) return { blocks: this.doc.header.blocks, index: hIdx };
    }
    if (this.doc.footer) {
      const fIdx = this.doc.footer.blocks.findIndex((b) => b.id === id);
      if (fIdx !== -1) return { blocks: this.doc.footer.blocks, index: fIdx };
    }
    // Recursively search inside table cells (supports nested tables)
    const nested = this.findBlockInTableCells(id, this.doc.blocks);
    if (nested) return nested;
    if (this.doc.header) {
      const hNested = this.findBlockInTableCells(id, this.doc.header.blocks);
      if (hNested) return hNested;
    }
    if (this.doc.footer) {
      const fNested = this.findBlockInTableCells(id, this.doc.footer.blocks);
      if (fNested) return fNested;
    }
    throw new Error(`Block not found: ${id}`);
  }

  private findBlockInTableCells(
    id: string,
    blocks: Block[],
  ): { blocks: Block[]; index: number } | undefined {
    for (const block of blocks) {
      if (!block.tableData) continue;
      for (const row of block.tableData.rows) {
        for (const cell of row.cells) {
          const idx = cell.blocks.findIndex((b) => b.id === id);
          if (idx !== -1) return { blocks: cell.blocks, index: idx };
          // Recurse into nested tables
          const nested = this.findBlockInTableCells(id, cell.blocks);
          if (nested) return nested;
        }
      }
    }
    return undefined;
  }

}
