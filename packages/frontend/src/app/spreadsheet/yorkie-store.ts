import { Document } from "@yorkie-js/react";
import {
  Store,
  Grid,
  Cell,
  CellStyle,
  MergeSpan,
  Ref,
  Sref,
  Range,
  Direction,
  Axis,
  CellIndex,
  findEdgeWithIndex,
  toSref,
  parseRef,
  extractReferences,
  toSrefs,
  shiftSref,
  shiftFormula,
  moveRef,
  moveFormula,
  remapIndex,
  isCrossSheetRef,
  shiftMergeMap,
  moveMergeMap,
} from "@wafflebase/sheet";
import { SpreadsheetDocument, Worksheet } from "@/types/worksheet";
import { UserPresence } from "@/types/users";

export class YorkieStore implements Store {
  private doc: Document<SpreadsheetDocument, UserPresence>;
  private tabId: string;
  private cellIndex: CellIndex = new CellIndex();
  private dirty = true;

  // Batch state: when non-null, mutations are buffered instead of immediately
  // flushed to doc.update(). endBatch() flushes all ops in a single update.
  private batchOverlay: Map<Sref, Cell | null> | null = null;
  private batchOps: Array<(root: SpreadsheetDocument) => void> | null = null;

  constructor(doc: Document<SpreadsheetDocument, UserPresence>, tabId: string) {
    this.doc = doc;
    this.tabId = tabId;

    // Mark index as dirty on remote changes so it gets rebuilt lazily.
    doc.subscribe((e) => {
      if (e.type === "remote-change") {
        this.dirty = true;
      }
    });
  }

  private getSheet(): Worksheet {
    return this.doc.getRoot().sheets[this.tabId];
  }

  private ensureIndex(): void {
    if (!this.dirty) return;

    const sheet = this.getSheet().sheet;
    const entries: Array<[number, number]> = [];
    for (const sref of Object.keys(sheet)) {
      const ref = parseRef(sref);
      entries.push([ref.r, ref.c]);
    }
    this.cellIndex.rebuild(entries);
    this.dirty = false;
  }

  /**
   * `set` method sets the value of a cell.
   */
  async set(ref: Ref, value: Cell): Promise<void> {
    const sref = toSref(ref);
    if (this.batchOverlay) {
      this.batchOverlay.set(sref, value);
      if (!this.dirty) {
        this.cellIndex.add(ref.r, ref.c);
      }
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      root.sheets[tabId].sheet[sref] = value;
    });
    if (!this.dirty) {
      this.cellIndex.add(ref.r, ref.c);
    }
  }

  /**
   * `get` method gets the value of a cell.
   */
  async get(ref: Ref): Promise<Cell | undefined> {
    const sref = toSref(ref);
    if (this.batchOverlay && this.batchOverlay.has(sref)) {
      const val = this.batchOverlay.get(sref);
      return val === null ? undefined : val;
    }
    return this.getSheet().sheet[sref];
  }

  /**
   * `has` method checks if a cell exists.
   */
  async has(ref: Ref): Promise<boolean> {
    const sref = toSref(ref);
    if (this.batchOverlay && this.batchOverlay.has(sref)) {
      return this.batchOverlay.get(sref) !== null;
    }
    const sheet = this.getSheet().sheet;
    return sheet[sref] !== undefined;
  }

  /**
   * `delete` method deletes a cell.
   */
  async delete(ref: Ref): Promise<boolean> {
    const sref = toSref(ref);
    if (this.batchOverlay) {
      // Check if cell exists (in overlay or document)
      let exists = false;
      if (this.batchOverlay.has(sref)) {
        exists = this.batchOverlay.get(sref) !== null;
      } else {
        exists = this.getSheet().sheet[sref] !== undefined;
      }
      if (!exists) return false;

      this.batchOverlay.set(sref, null);
      if (!this.dirty) {
        this.cellIndex.remove(ref.r, ref.c);
      }
      return true;
    }

    let deleted = false;
    const tabId = this.tabId;
    this.doc.update((root) => {
      if (root.sheets[tabId].sheet[sref] !== undefined) {
        delete root.sheets[tabId].sheet[sref];
        deleted = true;
      }
    });
    if (deleted && !this.dirty) {
      this.cellIndex.remove(ref.r, ref.c);
    }
    return deleted;
  }

  /**
   * `deleteRange` method deletes all cells within the given range in a single transaction.
   */
  async deleteRange(range: Range): Promise<Set<Sref>> {
    this.ensureIndex();

    const cellsToDelete = Array.from(this.cellIndex.cellsInRange(range));
    const deleted = new Set<Sref>();

    if (this.batchOverlay) {
      for (const [row, col] of cellsToDelete) {
        const sref = toSref({ r: row, c: col });
        // Skip cells already deleted in overlay
        if (
          this.batchOverlay.has(sref) &&
          this.batchOverlay.get(sref) === null
        ) {
          continue;
        }
        this.batchOverlay.set(sref, null);
        deleted.add(sref);
      }
      for (const [row, col] of cellsToDelete) {
        this.cellIndex.remove(row, col);
      }
      return deleted;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      for (const [row, col] of cellsToDelete) {
        const sref = toSref({ r: row, c: col });
        delete root.sheets[tabId].sheet[sref];
        deleted.add(sref);
      }
    });

    for (const [row, col] of cellsToDelete) {
      this.cellIndex.remove(row, col);
    }

    return deleted;
  }

  /**
   * `setGrid` method sets the grid.
   */
  async setGrid(grid: Grid): Promise<void> {
    if (this.batchOverlay) {
      for (const [sref, cell] of grid) {
        this.batchOverlay.set(sref, cell);
      }
      if (!this.dirty) {
        for (const [sref] of grid) {
          const ref = parseRef(sref);
          this.cellIndex.add(ref.r, ref.c);
        }
      }
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      for (const [sref, cell] of grid) {
        root.sheets[tabId].sheet[sref] = cell;
      }
    });
    if (!this.dirty) {
      for (const [sref] of grid) {
        const ref = parseRef(sref);
        this.cellIndex.add(ref.r, ref.c);
      }
    }
  }

  /**
   * `getGrid` method gets the grid.
   */
  async getGrid(range: Range): Promise<Grid> {
    this.ensureIndex();

    const sheet = this.getSheet().sheet;
    const grid: Grid = new Map();

    for (const [row, col] of this.cellIndex.cellsInRange(range)) {
      const sref = toSref({ r: row, c: col });
      if (this.batchOverlay && this.batchOverlay.has(sref)) {
        const val = this.batchOverlay.get(sref);
        if (val !== null) {
          grid.set(sref, val);
        }
        continue;
      }
      const value = sheet[sref];
      if (value !== undefined) {
        grid.set(sref, value);
      }
    }

    return grid;
  }

  /**
   * `findEdge` method finds the edge of the grid.
   * Style-only cells are excluded from navigation.
   */
  async findEdge(
    ref: Ref,
    direction: Direction,
    dimension: Range,
  ): Promise<Ref> {
    this.ensureIndex();
    return findEdgeWithIndex(
      this.cellIndex,
      ref,
      direction,
      dimension,
      (r, c) => {
        const sref = toSref({ r, c });
        const cell = this.getSheet().sheet[sref];
        return cell !== undefined && (!!cell.v || !!cell.f);
      },
    );
  }

  async shiftCells(axis: Axis, index: number, count: number): Promise<void> {
    const tabId = this.tabId;
    this.doc.update((root) => {
      const ws = root.sheets[tabId];
      // Collect all entries and compute new keys/formulas
      const entries: Array<[string, Cell]> = [];
      for (const [sref, cell] of Object.entries(ws.sheet)) {
        entries.push([sref, { v: cell.v, f: cell.f, s: cell.s }]);
      }

      // Delete all old keys
      for (const [sref] of entries) {
        delete ws.sheet[sref];
      }

      // Write all new keys with shifted positions and updated formulas
      for (const [sref, cell] of entries) {
        const newSref = shiftSref(sref, axis, index, count);
        if (newSref === null) {
          continue;
        }

        if (cell.f) {
          ws.sheet[newSref] = {
            ...cell,
            f: shiftFormula(cell.f, axis, index, count),
          };
        } else {
          ws.sheet[newSref] = { ...cell };
        }
      }

      // Shift dimension sizes for the affected axis
      const dimObj = axis === "row" ? ws.rowHeights : ws.colWidths;
      const dimEntries: Array<[string, number]> = [];
      for (const [key, value] of Object.entries(dimObj)) {
        dimEntries.push([key, value]);
      }
      for (const [key] of dimEntries) {
        delete dimObj[key];
      }
      for (const [key, value] of dimEntries) {
        const idx = Number(key);
        if (count > 0) {
          if (idx >= index) {
            dimObj[String(idx + count)] = value;
          } else {
            dimObj[key] = value;
          }
        } else {
          const absCount = Math.abs(count);
          if (idx >= index && idx < index + absCount) {
            // In deleted zone — drop it
          } else if (idx >= index + absCount) {
            dimObj[String(idx + count)] = value;
          } else {
            dimObj[key] = value;
          }
        }
      }

      // Shift style maps for the affected axis
      const styleObj = axis === "row" ? ws.rowStyles : ws.colStyles;
      if (styleObj) {
        const styleEntries: Array<[string, CellStyle]> = [];
        for (const [key, value] of Object.entries(styleObj)) {
          styleEntries.push([key, value]);
        }
        for (const [key] of styleEntries) {
          delete styleObj[key];
        }
        for (const [key, value] of styleEntries) {
          const idx = Number(key);
          if (count > 0) {
            if (idx >= index) {
              styleObj[String(idx + count)] = value;
            } else {
              styleObj[key] = value;
            }
          } else {
            const absCount = Math.abs(count);
            if (idx >= index && idx < index + absCount) {
              // In deleted zone — drop it
            } else if (idx >= index + absCount) {
              styleObj[String(idx + count)] = value;
            } else {
              styleObj[key] = value;
            }
          }
        }
      }

      // Shift merged ranges for the affected axis
      const mergeMap = new Map<Sref, MergeSpan>(
        Object.entries(ws.merges || {}) as Array<[Sref, MergeSpan]>,
      );
      const shiftedMerges = shiftMergeMap(mergeMap, axis, index, count);
      ws.merges = {};
      for (const [sref, span] of shiftedMerges) {
        ws.merges[sref] = span;
      }
    });

    this.dirty = true;
  }

  async moveCells(
    axis: Axis,
    srcIndex: number,
    count: number,
    dstIndex: number,
  ): Promise<void> {
    const tabId = this.tabId;
    this.doc.update((root) => {
      const ws = root.sheets[tabId];
      // Collect all entries
      const entries: Array<[string, Cell]> = [];
      for (const [sref, cell] of Object.entries(ws.sheet)) {
        entries.push([sref, { v: cell.v, f: cell.f, s: cell.s }]);
      }

      // Delete all old keys
      for (const [sref] of entries) {
        delete ws.sheet[sref];
      }

      // Write new keys with remapped positions and formulas
      for (const [sref, cell] of entries) {
        const ref = parseRef(sref);
        const newRef = moveRef(ref, axis, srcIndex, count, dstIndex);
        const newSref = toSref(newRef);

        if (cell.f) {
          ws.sheet[newSref] = {
            ...cell,
            f: moveFormula(cell.f, axis, srcIndex, count, dstIndex),
          };
        } else {
          ws.sheet[newSref] = { ...cell };
        }
      }

      // Remap dimension sizes
      const dimObj = axis === "row" ? ws.rowHeights : ws.colWidths;
      const dimEntries: Array<[string, number]> = [];
      for (const [key, value] of Object.entries(dimObj)) {
        dimEntries.push([key, value]);
      }
      for (const [key] of dimEntries) {
        delete dimObj[key];
      }
      for (const [key, value] of dimEntries) {
        const idx = Number(key);
        const newIdx = remapIndex(idx, srcIndex, count, dstIndex);
        dimObj[String(newIdx)] = value;
      }

      // Remap style maps
      const styleObj = axis === "row" ? ws.rowStyles : ws.colStyles;
      if (styleObj) {
        const styleEntries: Array<[string, CellStyle]> = [];
        for (const [key, value] of Object.entries(styleObj)) {
          styleEntries.push([key, value]);
        }
        for (const [key] of styleEntries) {
          delete styleObj[key];
        }
        for (const [key, value] of styleEntries) {
          const idx = Number(key);
          const newIdx = remapIndex(idx, srcIndex, count, dstIndex);
          styleObj[String(newIdx)] = value;
        }
      }

      // Remap merged ranges
      const mergeMap = new Map<Sref, MergeSpan>(
        Object.entries(ws.merges || {}) as Array<[Sref, MergeSpan]>,
      );
      const movedMerges = moveMergeMap(mergeMap, axis, srcIndex, count, dstIndex);
      ws.merges = {};
      for (const [sref, span] of movedMerges) {
        ws.merges[sref] = span;
      }
    });

    this.dirty = true;
  }

  async getFormulaGrid(): Promise<Map<Sref, Cell>> {
    const grid = new Map<Sref, Cell>();
    const sheet = this.getSheet().sheet;
    for (const [sref, cell] of Object.entries(sheet)) {
      if (cell.f) {
        grid.set(sref, cell as Cell);
      }
    }
    return grid;
  }

  async buildDependantsMap(_: Iterable<Sref>): Promise<Map<Sref, Set<Sref>>> {
    const dependantsMap = new Map<Sref, Set<Sref>>();
    const sheet = this.getSheet().sheet;

    if (this.batchOverlay) {
      // Iterate document cells, skipping those deleted in overlay
      for (const [sref, cell] of Object.entries(sheet)) {
        if (this.batchOverlay.has(sref)) continue;
        if (!cell.f) continue;
        for (const r of toSrefs(extractReferences(cell.f))) {
          if (isCrossSheetRef(r)) continue;
          if (!dependantsMap.has(r)) dependantsMap.set(r, new Set());
          dependantsMap.get(r)!.add(sref);
        }
      }
      // Iterate overlay cells (skip deleted ones)
      for (const [sref, cell] of this.batchOverlay) {
        if (cell === null || !cell.f) continue;
        for (const r of toSrefs(extractReferences(cell.f))) {
          if (isCrossSheetRef(r)) continue;
          if (!dependantsMap.has(r)) dependantsMap.set(r, new Set());
          dependantsMap.get(r)!.add(sref);
        }
      }
      return dependantsMap;
    }

    for (const [sref, cell] of Object.entries(sheet)) {
      if (!cell.f) {
        continue;
      }

      for (const r of toSrefs(extractReferences(cell.f))) {
        if (isCrossSheetRef(r)) continue;
        if (!dependantsMap.has(r)) {
          dependantsMap.set(r, new Set());
        }
        dependantsMap.get(r)!.add(sref);
      }
    }
    return dependantsMap;
  }

  async setDimensionSize(
    axis: Axis,
    index: number,
    size: number,
  ): Promise<void> {
    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        const map =
          axis === "row"
            ? root.sheets[tabId].rowHeights
            : root.sheets[tabId].colWidths;
        map[String(index)] = size;
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      const map =
        axis === "row"
          ? root.sheets[tabId].rowHeights
          : root.sheets[tabId].colWidths;
      map[String(index)] = size;
    });
  }

  async getDimensionSizes(axis: Axis): Promise<Map<number, number>> {
    const ws = this.getSheet();
    const obj = axis === "row" ? ws.rowHeights : ws.colWidths;
    const result = new Map<number, number>();
    if (obj) {
      for (const [key, value] of Object.entries(obj)) {
        result.set(Number(key), value);
      }
    }
    return result;
  }

  updateActiveCell(activeCell: Ref) {
    this.doc.update((_, p) => {
      p.set({ activeCell: toSref(activeCell) });
    });
  }

  getPresences(): Array<{ clientID: string; presence: UserPresence }> {
    return this.doc.getOthersPresences();
  }

  async setColumnStyle(col: number, style: CellStyle): Promise<void> {
    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        if (!root.sheets[tabId].colStyles) {
          root.sheets[tabId].colStyles = {};
        }
        root.sheets[tabId].colStyles[String(col)] = style;
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      if (!root.sheets[tabId].colStyles) {
        root.sheets[tabId].colStyles = {};
      }
      root.sheets[tabId].colStyles[String(col)] = style;
    });
  }

  async getColumnStyles(): Promise<Map<number, CellStyle>> {
    const ws = this.getSheet();
    const result = new Map<number, CellStyle>();
    if (ws.colStyles) {
      for (const [key, value] of Object.entries(ws.colStyles)) {
        result.set(Number(key), value);
      }
    }
    return result;
  }

  async setRowStyle(row: number, style: CellStyle): Promise<void> {
    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        if (!root.sheets[tabId].rowStyles) {
          root.sheets[tabId].rowStyles = {};
        }
        root.sheets[tabId].rowStyles[String(row)] = style;
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      if (!root.sheets[tabId].rowStyles) {
        root.sheets[tabId].rowStyles = {};
      }
      root.sheets[tabId].rowStyles[String(row)] = style;
    });
  }

  async getRowStyles(): Promise<Map<number, CellStyle>> {
    const ws = this.getSheet();
    const result = new Map<number, CellStyle>();
    if (ws.rowStyles) {
      for (const [key, value] of Object.entries(ws.rowStyles)) {
        result.set(Number(key), value);
      }
    }
    return result;
  }

  async setSheetStyle(style: CellStyle): Promise<void> {
    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        root.sheets[tabId].sheetStyle = style;
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      root.sheets[tabId].sheetStyle = style;
    });
  }

  async getSheetStyle(): Promise<CellStyle | undefined> {
    const ws = this.getSheet();
    return ws.sheetStyle ? { ...ws.sheetStyle } : undefined;
  }

  async setMerge(anchor: Ref, span: MergeSpan): Promise<void> {
    if (this.batchOps) {
      const tabId = this.tabId;
      const sref = toSref(anchor);
      this.batchOps.push((root) => {
        if (!root.sheets[tabId].merges) {
          root.sheets[tabId].merges = {};
        }
        root.sheets[tabId].merges[sref] = { ...span };
      });
      return;
    }

    const tabId = this.tabId;
    const sref = toSref(anchor);
    this.doc.update((root) => {
      if (!root.sheets[tabId].merges) {
        root.sheets[tabId].merges = {};
      }
      root.sheets[tabId].merges[sref] = { ...span };
    });
  }

  async deleteMerge(anchor: Ref): Promise<boolean> {
    const sref = toSref(anchor);
    if (this.batchOps) {
      const tabId = this.tabId;
      const ws = this.getSheet();
      const exists = !!ws.merges?.[sref];
      if (!exists) return false;
      this.batchOps.push((root) => {
        if (root.sheets[tabId].merges?.[sref]) {
          delete root.sheets[tabId].merges[sref];
        }
      });
      return true;
    }

    let deleted = false;
    const tabId = this.tabId;
    this.doc.update((root) => {
      if (root.sheets[tabId].merges?.[sref]) {
        delete root.sheets[tabId].merges[sref];
        deleted = true;
      }
    });
    return deleted;
  }

  async getMerges(): Promise<Map<Sref, MergeSpan>> {
    const ws = this.getSheet();
    const result = new Map<Sref, MergeSpan>();
    if (!ws.merges) return result;
    for (const [sref, span] of Object.entries(ws.merges)) {
      result.set(sref, { ...span });
    }
    return result;
  }

  async setFreezePane(frozenRows: number, frozenCols: number): Promise<void> {
    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        root.sheets[tabId].frozenRows = frozenRows;
        root.sheets[tabId].frozenCols = frozenCols;
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      root.sheets[tabId].frozenRows = frozenRows;
      root.sheets[tabId].frozenCols = frozenCols;
    });
  }

  async getFreezePane(): Promise<{ frozenRows: number; frozenCols: number }> {
    const ws = this.getSheet();
    return {
      frozenRows: ws.frozenRows ?? 0,
      frozenCols: ws.frozenCols ?? 0,
    };
  }

  beginBatch(): void {
    this.batchOverlay = new Map();
    this.batchOps = [];
  }

  endBatch(): void {
    const overlay = this.batchOverlay;
    const ops = this.batchOps;
    this.batchOverlay = null;
    this.batchOps = null;

    const hasOverlay = overlay && overlay.size > 0;
    const hasOps = ops && ops.length > 0;
    if (!hasOverlay && !hasOps) return;

    const tabId = this.tabId;
    this.doc.update((root) => {
      const ws = root.sheets[tabId];
      // Apply cell overlay: deletes first, then sets
      if (overlay) {
        for (const [sref, cell] of overlay) {
          if (cell === null) {
            if (ws.sheet[sref] !== undefined) {
              delete ws.sheet[sref];
            }
          } else {
            ws.sheet[sref] = cell;
          }
        }
      }

      // Apply non-cell ops (styles, freeze pane, dimensions)
      if (ops) {
        for (const op of ops) {
          op(root);
        }
      }
    });
    this.dirty = true;
  }

  async undo(): Promise<{ success: boolean; affectedRange?: Range }> {
    if (!this.doc.history.canUndo()) return { success: false };

    const beforeCellKeys = new Set(Object.keys(this.getSheet().sheet));
    const beforeMerges = new Map<Sref, MergeSpan>(
      Object.entries(this.getSheet().merges || {}) as Array<[Sref, MergeSpan]>,
    );
    this.doc.history.undo();
    this.dirty = true;

    const affectedRange = this.computeAffectedRange(beforeCellKeys, beforeMerges);
    return { success: true, affectedRange };
  }

  async redo(): Promise<{ success: boolean; affectedRange?: Range }> {
    if (!this.doc.history.canRedo()) return { success: false };

    const beforeCellKeys = new Set(Object.keys(this.getSheet().sheet));
    const beforeMerges = new Map<Sref, MergeSpan>(
      Object.entries(this.getSheet().merges || {}) as Array<[Sref, MergeSpan]>,
    );
    this.doc.history.redo();
    this.dirty = true;

    const affectedRange = this.computeAffectedRange(beforeCellKeys, beforeMerges);
    return { success: true, affectedRange };
  }

  /**
   * Computes the bounding range of cells that changed between beforeKeys and current state.
   */
  private computeAffectedRange(
    beforeCellKeys: Set<string>,
    beforeMerges: Map<Sref, MergeSpan>,
  ): Range | undefined {
    const afterKeys = new Set(Object.keys(this.getSheet().sheet));
    const afterMerges = new Map<Sref, MergeSpan>(
      Object.entries(this.getSheet().merges || {}) as Array<[Sref, MergeSpan]>,
    );

    // Find all changed srefs (added, removed, or modified)
    const changedSrefs = new Set<string>();
    for (const sref of afterKeys) {
      if (!beforeCellKeys.has(sref)) changedSrefs.add(sref);
    }
    for (const sref of beforeCellKeys) {
      if (!afterKeys.has(sref)) changedSrefs.add(sref);
    }
    for (const [sref, span] of afterMerges) {
      const prev = beforeMerges.get(sref);
      if (!prev || prev.rs !== span.rs || prev.cs !== span.cs) {
        changedSrefs.add(sref);
      }
    }
    for (const sref of beforeMerges.keys()) {
      if (!afterMerges.has(sref)) changedSrefs.add(sref);
    }

    if (changedSrefs.size === 0) return undefined;

    let minR = Infinity,
      maxR = -Infinity;
    let minC = Infinity,
      maxC = -Infinity;
    for (const sref of changedSrefs) {
      const ref = parseRef(sref);
      if (ref.r < minR) minR = ref.r;
      if (ref.r > maxR) maxR = ref.r;
      if (ref.c < minC) minC = ref.c;
      if (ref.c > maxC) maxC = ref.c;
    }

    return [
      { r: minR, c: minC },
      { r: maxR, c: maxC },
    ];
  }

  canUndo(): boolean {
    return this.doc.history.canUndo();
  }

  canRedo(): boolean {
    return this.doc.history.canRedo();
  }
}
