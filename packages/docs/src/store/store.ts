import type { Block, BlockStyle, CellStyle, Document, HeadingLevel, HeaderFooter, Inline, InlineStyle, PageSetup, TableRow, TableCell, BlockType } from '../model/types.js';
import type { DocStyles, NamedStyleDef, StyleId } from '../model/named-styles.js';

/**
 * DocStore interface — persistence abstraction for documents.
 *
 * Follows the same pattern as the sheet package's Store interface.
 * Currently only MemDocStore exists; future YorkieDocStore will
 * implement this for real-time collaboration.
 */
export interface DocStore {
  /** Return a deep clone of the current document. */
  getDocument(): Document;
  /** Replace the document, pushing the previous state onto the undo stack. */
  setDocument(doc: Document): void;
  /**
   * Replace the internal document WITHOUT pushing to the undo stack.
   * Used by the editor to sync back after direct Doc mutations that
   * were already preceded by a snapshot() call.
   */
  replaceDocument(doc: Document): void;
  getBlock(id: string): Block | undefined;
  updateBlock(id: string, block: Block): void;
  insertBlock(index: number, block: Block): void;
  deleteBlock(id: string): void;
  deleteBlockByIndex(index: number): void;
  getPageSetup(): PageSetup;
  setPageSetup(setup: PageSetup): void;

  // --- Named styles (Google Docs paragraph styles) ---
  /** Return the document's named-style overrides registry (built-ins omitted). */
  getDocStyles(): DocStyles;
  /** Replace the named-style overrides registry wholesale. */
  setDocStyles(styles: DocStyles): void;
  /**
   * Redefine a style ("Update '<style>' to match"): store the override and
   * re-materialize block spacing onto every block governed by it.
   */
  updateStyleDefinition(styleId: StyleId, def: NamedStyleDef): void;
  /** Reset a single style to its built-in definition. */
  resetStyle(styleId: StyleId): void;
  /** Reset every style to its built-in definition. */
  resetAllStyles(): void;
  getHeader(): HeaderFooter | undefined;
  getFooter(): HeaderFooter | undefined;
  setHeader(header: HeaderFooter | undefined): void;
  setFooter(footer: HeaderFooter | undefined): void;
  /** Save current state to the undo stack before a group of mutations. */
  snapshot(): void;
  /**
   * Run `fn` so that every store write it makes costs **one** undo unit.
   *
   * The seam exists because undo granularity is anchored to different
   * things in different stores: `MemDocStore` pushes a checkpoint on
   * `snapshot()`, while `YorkieDocStore` takes one undo unit per
   * `doc.update()` and its `snapshot()` is a no-op. So a user action that
   * needs two store writes — redefining a named style is the canonical
   * one: the registry write, then the stale-style-off sweep it triggers —
   * cost two Cmd+Z under the collaborative store, the first of which
   * looked like it did nothing.
   *
   * Contract, identical for every implementation:
   *
   * - One top-level `batch(fn)` = at most one undo unit, however many
   *   writes `fn` makes. A batch that writes nothing pushes nothing.
   * - **Nested** `batch()` calls do not create nested undo units; the
   *   inner call just runs its body inside the outer one's unit.
   * - `fn` runs synchronously. An exception propagates, and the batch
   *   state is unwound so the next write behaves normally. Whether a
   *   partially-applied batch is rolled back is store-specific
   *   (`YorkieDocStore` rolls the whole `doc.update` back), so do not
   *   depend on partial writes surviving a throw.
   * - Do not call `undo()` / `redo()` from inside a batch.
   * - Do not call `setDocument()` from inside a batch — **both**
   *   implementations throw. Loading a whole document is not an edit: it
   *   re-arms the undo floor, and `YorkieDocStore` can only read that floor
   *   once the batch's single `doc.update` has closed, so inside a batch the
   *   floor would land one unit low and the freshly loaded document itself
   *   would become undoable. `MemDocStore` throws for parity, so code
   *   written against the in-package store cannot pass there and fail under
   *   the collaborative one.
   *
   * Mirrors `SlidesStore.batch()`; see
   * `docs/design/slides/slides-native-undo.md`.
   */
  batch(fn: () => void): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // --- Table granular updates (Phase C) ---
  /** Insert a row into a table at the given index. */
  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void;
  /** Delete a row from a table. */
  deleteTableRow(tableBlockId: string, rowIndex: number): void;
  /** Insert a column (one cell per row) at the given index. */
  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void;
  /** Delete a column from a table. */
  deleteTableColumn(tableBlockId: string, colIndex: number): void;
  /** Update a single cell (content + style). */
  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void;
  /** Update table-level attributes (column widths, row heights). */
  updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: (number | undefined)[] }): void;

  /** Insert text at the given block-level character offset. */
  insertText(blockId: string, offset: number, text: string): void;
  /** Delete `length` characters starting at the given block-level offset. */
  deleteText(blockId: string, offset: number, length: number): void;
  /** Apply inline style to a character range within a block. */
  applyStyle(
    blockId: string,
    fromOffset: number,
    toOffset: number,
    style: Partial<InlineStyle>,
  ): void;
  /**
   * Apply inline style to multiple (possibly cross-block) character ranges
   * as a single undo unit. Prefer this over looping `applyStyle()` whenever
   * one user action must write several distinct ranges in one step (e.g.
   * relative font-size stepping over a mixed selection) — a loop of
   * `applyStyle()` calls produces one undo unit per call on stores (like
   * `YorkieDocStore`) whose undo granularity is tied to the write itself.
   */
  applyStyles(
    edits: Array<{
      blockId: string;
      fromOffset: number;
      toOffset: number;
      style: Partial<InlineStyle>;
    }>,
  ): void;
  /** Split a block at offset, creating a new block after it. */
  splitBlock(
    blockId: string,
    offset: number,
    newBlockId: string,
    newBlockType: BlockType,
  ): void;
  /** Merge nextBlock into blockId, removing nextBlock. */
  mergeBlock(blockId: string, nextBlockId: string): void;

  // --- Block attribute edits (intent-preserving) ---
  /** Change block type and type-specific attributes via styleByPath. */
  setBlockType(
    blockId: string,
    type: BlockType,
    opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number },
  ): void;
  /** Apply partial block-level style (alignment, margins, etc.) via styleByPath. */
  applyBlockStyle(blockId: string, style: Partial<BlockStyle>): void;
  /** Apply partial cell style (background, borders, alignment) via styleByPath.
   *  Omitted properties are untouched. A property named with the value
   *  `undefined` — or `''` for a color, the "Reset" sentinel the pickers pass —
   *  is removed from the node and from the block, so the key is absent
   *  afterwards rather than present holding `undefined` (#728, #793). */
  applyCellStyle(
    tableBlockId: string, rowIndex: number, colIndex: number,
    style: Partial<CellStyle>,
  ): void;
  /** Update colSpan/rowSpan on a cell node via styleByPath.
   *  Value of 1 (default) removes the attribute from the tree.
   *  Only specified properties are changed; omitted ones are untouched. */
  applyCellSpan(
    tableBlockId: string, rowIndex: number, colIndex: number,
    span: { colSpan?: number; rowSpan?: number },
  ): void;
  /** Insert an image inline at a block-level character offset. */
  insertImageInline(blockId: string, offset: number, inline: Inline): void;
  /** Insert a block after the given sibling block (works for top-level and cell-internal blocks). */
  insertBlockAfter(siblingBlockId: string, block: Block): void;
  /**
   * Insert several blocks after the given sibling, in order, as a single
   * write. Prefer this over looping `insertBlockAfter()` whenever one user
   * action inserts more than one block (paste, import): on stores whose undo
   * granularity is tied to the write itself (`YorkieDocStore`) the loop costs
   * one undo unit and one CRDT change per block, and each call re-resolves
   * the sibling's path against the whole document — quadratic in document
   * size. Same reasoning as `applyStyles()` vs `applyStyle()`.
   */
  insertBlocksAfter(siblingBlockId: string, blocks: Block[]): void;
}
