import { Document } from "@yorkie-js/react";
import {
  Store,
  Grid,
  Cell,
  CellStyle,
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
} from "@wafflebase/sheet";
import { Worksheet } from "@/types/worksheet";
import { UserPresence } from "@/types/users";

export class YorkieStore implements Store {
  private doc: Document<Worksheet, UserPresence>;
  private cellIndex: CellIndex = new CellIndex();
  private dirty = true;

  // Batch state: when non-null, mutations are buffered instead of immediately
  // flushed to doc.update(). endBatch() flushes all ops in a single update.
  private batchOverlay: Map<Sref, Cell | null> | null = null;
  private batchOps: Array<(root: Worksheet) => void> | null = null;

  constructor(doc: Document<Worksheet, UserPresence>) {
    this.doc = doc;

    // Mark index as dirty on remote changes so it gets rebuilt lazily.
    doc.subscribe((e) => {
      if (e.type === "remote-change") {
        this.dirty = true;
      }
    });
  }

  private ensureIndex(): void {
    if (!this.dirty) return;

    const sheet = this.doc.getRoot().sheet;
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

    this.doc.update((root) => {
      root.sheet[sref] = value;
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
    return this.doc.getRoot().sheet[sref];
  }

  /**
   * `has` method checks if a cell exists.
   */
  async has(ref: Ref): Promise<boolean> {
    const sref = toSref(ref);
    if (this.batchOverlay && this.batchOverlay.has(sref)) {
      return this.batchOverlay.get(sref) !== null;
    }
    const sheet = this.doc.getRoot().sheet;
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
        exists = this.doc.getRoot().sheet[sref] !== undefined;
      }
      if (!exists) return false;

      this.batchOverlay.set(sref, null);
      if (!this.dirty) {
        this.cellIndex.remove(ref.r, ref.c);
      }
      return true;
    }

    let deleted = false;
    this.doc.update((root) => {
      if (root.sheet[sref] !== undefined) {
        delete root.sheet[sref];
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
        if (this.batchOverlay.has(sref) && this.batchOverlay.get(sref) === null) {
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

    this.doc.update((root) => {
      for (const [row, col] of cellsToDelete) {
        const sref = toSref({ r: row, c: col });
        delete root.sheet[sref];
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

    this.doc.update((root) => {
      for (const [sref, cell] of grid) {
        root.sheet[sref] = cell;
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

    const sheet = this.doc.getRoot().sheet;
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
   */
  async findEdge(
    ref: Ref,
    direction: Direction,
    dimension: Range
  ): Promise<Ref> {
    this.ensureIndex();
    return findEdgeWithIndex(this.cellIndex, ref, direction, dimension);
  }

  async shiftCells(axis: Axis, index: number, count: number): Promise<void> {
    this.doc.update((root) => {
      // Collect all entries and compute new keys/formulas
      const entries: Array<[string, Cell]> = [];
      for (const [sref, cell] of Object.entries(root.sheet)) {
        entries.push([sref, { v: cell.v, f: cell.f, s: cell.s }]);
      }

      // Delete all old keys
      for (const [sref] of entries) {
        delete root.sheet[sref];
      }

      // Write all new keys with shifted positions and updated formulas
      for (const [sref, cell] of entries) {
        const newSref = shiftSref(sref, axis, index, count);
        if (newSref === null) {
          continue;
        }

        if (cell.f) {
          root.sheet[newSref] = {
            ...cell,
            f: shiftFormula(cell.f, axis, index, count),
          };
        } else {
          root.sheet[newSref] = { ...cell };
        }
      }

      // Shift dimension sizes for the affected axis
      const dimObj = axis === "row" ? root.rowHeights : root.colWidths;
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
      const styleObj = axis === "row" ? root.rowStyles : root.colStyles;
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
    });

    this.dirty = true;
  }

  async moveCells(
    axis: Axis,
    srcIndex: number,
    count: number,
    dstIndex: number
  ): Promise<void> {
    this.doc.update((root) => {
      // Collect all entries
      const entries: Array<[string, Cell]> = [];
      for (const [sref, cell] of Object.entries(root.sheet)) {
        entries.push([sref, { v: cell.v, f: cell.f, s: cell.s }]);
      }

      // Delete all old keys
      for (const [sref] of entries) {
        delete root.sheet[sref];
      }

      // Write new keys with remapped positions and formulas
      for (const [sref, cell] of entries) {
        const ref = parseRef(sref);
        const newRef = moveRef(ref, axis, srcIndex, count, dstIndex);
        const newSref = toSref(newRef);

        if (cell.f) {
          root.sheet[newSref] = {
            ...cell,
            f: moveFormula(cell.f, axis, srcIndex, count, dstIndex),
          };
        } else {
          root.sheet[newSref] = { ...cell };
        }
      }

      // Remap dimension sizes
      const dimObj = axis === "row" ? root.rowHeights : root.colWidths;
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
      const styleObj = axis === "row" ? root.rowStyles : root.colStyles;
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
    });

    this.dirty = true;
  }

  async buildDependantsMap(_: Iterable<Sref>): Promise<Map<Sref, Set<Sref>>> {
    const dependantsMap = new Map<Sref, Set<Sref>>();
    const sheet = this.doc.getRoot().sheet;

    if (this.batchOverlay) {
      // Iterate document cells, skipping those deleted in overlay
      for (const [sref, cell] of Object.entries(sheet)) {
        if (this.batchOverlay.has(sref)) continue;
        if (!cell.f) continue;
        for (const r of toSrefs(extractReferences(cell.f))) {
          if (!dependantsMap.has(r)) dependantsMap.set(r, new Set());
          dependantsMap.get(r)!.add(sref);
        }
      }
      // Iterate overlay cells (skip deleted ones)
      for (const [sref, cell] of this.batchOverlay) {
        if (cell === null || !cell.f) continue;
        for (const r of toSrefs(extractReferences(cell.f))) {
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
    size: number
  ): Promise<void> {
    if (this.batchOps) {
      this.batchOps.push((root) => {
        const map = axis === "row" ? root.rowHeights : root.colWidths;
        map[String(index)] = size;
      });
      return;
    }

    this.doc.update((root) => {
      const map = axis === "row" ? root.rowHeights : root.colWidths;
      map[String(index)] = size;
    });
  }

  async getDimensionSizes(axis: Axis): Promise<Map<number, number>> {
    const root = this.doc.getRoot();
    const obj = axis === "row" ? root.rowHeights : root.colWidths;
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
      this.batchOps.push((root) => {
        if (!root.colStyles) {
          root.colStyles = {};
        }
        root.colStyles[String(col)] = style;
      });
      return;
    }

    this.doc.update((root) => {
      if (!root.colStyles) {
        root.colStyles = {};
      }
      root.colStyles[String(col)] = style;
    });
  }

  async getColumnStyles(): Promise<Map<number, CellStyle>> {
    const root = this.doc.getRoot();
    const result = new Map<number, CellStyle>();
    if (root.colStyles) {
      for (const [key, value] of Object.entries(root.colStyles)) {
        result.set(Number(key), value);
      }
    }
    return result;
  }

  async setRowStyle(row: number, style: CellStyle): Promise<void> {
    if (this.batchOps) {
      this.batchOps.push((root) => {
        if (!root.rowStyles) {
          root.rowStyles = {};
        }
        root.rowStyles[String(row)] = style;
      });
      return;
    }

    this.doc.update((root) => {
      if (!root.rowStyles) {
        root.rowStyles = {};
      }
      root.rowStyles[String(row)] = style;
    });
  }

  async getRowStyles(): Promise<Map<number, CellStyle>> {
    const root = this.doc.getRoot();
    const result = new Map<number, CellStyle>();
    if (root.rowStyles) {
      for (const [key, value] of Object.entries(root.rowStyles)) {
        result.set(Number(key), value);
      }
    }
    return result;
  }

  async setSheetStyle(style: CellStyle): Promise<void> {
    if (this.batchOps) {
      this.batchOps.push((root) => {
        root.sheetStyle = style;
      });
      return;
    }

    this.doc.update((root) => {
      root.sheetStyle = style;
    });
  }

  async getSheetStyle(): Promise<CellStyle | undefined> {
    const root = this.doc.getRoot();
    return root.sheetStyle ? { ...root.sheetStyle } : undefined;
  }

  async setFreezePane(frozenRows: number, frozenCols: number): Promise<void> {
    if (this.batchOps) {
      this.batchOps.push((root) => {
        root.frozenRows = frozenRows;
        root.frozenCols = frozenCols;
      });
      return;
    }

    this.doc.update((root) => {
      root.frozenRows = frozenRows;
      root.frozenCols = frozenCols;
    });
  }

  async getFreezePane(): Promise<{ frozenRows: number; frozenCols: number }> {
    const root = this.doc.getRoot();
    return {
      frozenRows: root.frozenRows ?? 0,
      frozenCols: root.frozenCols ?? 0,
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

    this.doc.update((root) => {
      // Apply cell overlay: deletes first, then sets
      if (overlay) {
        for (const [sref, cell] of overlay) {
          if (cell === null) {
            if (root.sheet[sref] !== undefined) {
              delete root.sheet[sref];
            }
          } else {
            root.sheet[sref] = cell;
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

    const beforeKeys = new Set(Object.keys(this.doc.getRoot().sheet));
    this.doc.history.undo();
    this.dirty = true;

    const affectedRange = this.computeAffectedRange(beforeKeys);
    return { success: true, affectedRange };
  }

  async redo(): Promise<{ success: boolean; affectedRange?: Range }> {
    if (!this.doc.history.canRedo()) return { success: false };

    const beforeKeys = new Set(Object.keys(this.doc.getRoot().sheet));
    this.doc.history.redo();
    this.dirty = true;

    const affectedRange = this.computeAffectedRange(beforeKeys);
    return { success: true, affectedRange };
  }

  /**
   * Computes the bounding range of cells that changed between beforeKeys and current state.
   */
  private computeAffectedRange(beforeKeys: Set<string>): Range | undefined {
    const afterKeys = new Set(Object.keys(this.doc.getRoot().sheet));

    // Find all changed srefs (added, removed, or modified)
    const changedSrefs = new Set<string>();
    for (const sref of afterKeys) {
      if (!beforeKeys.has(sref)) changedSrefs.add(sref);
    }
    for (const sref of beforeKeys) {
      if (!afterKeys.has(sref)) changedSrefs.add(sref);
    }

    if (changedSrefs.size === 0) return undefined;

    let minR = Infinity, maxR = -Infinity;
    let minC = Infinity, maxC = -Infinity;
    for (const sref of changedSrefs) {
      const ref = parseRef(sref);
      if (ref.r < minR) minR = ref.r;
      if (ref.r > maxR) maxR = ref.r;
      if (ref.c < minC) minC = ref.c;
      if (ref.c > maxC) maxC = ref.c;
    }

    return [{ r: minR, c: minC }, { r: maxR, c: maxC }];
  }

  canUndo(): boolean {
    return this.doc.history.canUndo();
  }

  canRedo(): boolean {
    return this.doc.history.canRedo();
  }
}
