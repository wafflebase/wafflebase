import { extractReferences } from '../formula/formula';
import { parseRef, toSref, toSrefs } from '../model/coordinates';
import { shiftGrid, shiftDimensionMap, moveGrid, moveDimensionMap } from '../model/shifting';
import { Axis, Cell, CellStyle, Grid, Ref, Range, Sref, Direction } from '../model/types';
import { CellIndex } from './cell-index';
import { findEdgeWithIndex } from './find-edge';
import { Store } from './store';

/**
 * `MemStore` class represents an in-memory storage.
 * It is used in testing and development.
 */
export class MemStore implements Store {
  private grid: Map<Sref, Cell>;
  private cellIndex: CellIndex = new CellIndex();
  private rowHeights: Map<number, number> = new Map();
  private colWidths: Map<number, number> = new Map();
  private colStyles: Map<number, CellStyle> = new Map();
  private rowStyles: Map<number, CellStyle> = new Map();
  private sheetStyle?: CellStyle;
  private frozenRows = 0;
  private frozenCols = 0;

  constructor(grid?: Grid) {
    this.grid = grid || new Map();
    this.rebuildIndex();
  }

  async set(ref: Ref, value: Cell) {
    this.grid.set(toSref(ref), value);
    this.cellIndex.add(ref.r, ref.c);
  }

  async get(ref: Ref): Promise<Cell | undefined> {
    return this.grid.get(toSref(ref));
  }

  async has(ref: Ref): Promise<boolean> {
    return this.grid.has(toSref(ref));
  }

  async delete(ref: Ref): Promise<boolean> {
    const deleted = this.grid.delete(toSref(ref));
    if (deleted) {
      this.cellIndex.remove(ref.r, ref.c);
    }
    return deleted;
  }

  async deleteRange(range: Range): Promise<Set<Sref>> {
    const deleted = new Set<Sref>();
    const toRemove: Array<[number, number]> = [];

    for (const [row, col] of this.cellIndex.cellsInRange(range)) {
      const sref = toSref({ r: row, c: col });
      this.grid.delete(sref);
      deleted.add(sref);
      toRemove.push([row, col]);
    }

    // Remove from index after iteration to avoid mutating during iteration
    for (const [row, col] of toRemove) {
      this.cellIndex.remove(row, col);
    }

    return deleted;
  }

  async setGrid(grid: Grid): Promise<void> {
    for (const [sref, cell] of grid) {
      this.grid.set(sref, cell);
      const ref = parseRef(sref);
      this.cellIndex.add(ref.r, ref.c);
    }
  }

  async getGrid(range: Range): Promise<Grid> {
    const grid: Grid = new Map();

    for (const [row, col] of this.cellIndex.cellsInRange(range)) {
      const sref = toSref({ r: row, c: col });
      const value = this.grid.get(sref);
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
    dimension: Range,
  ): Promise<Ref> {
    return findEdgeWithIndex(this.cellIndex, ref, direction, dimension);
  }

  async shiftCells(axis: Axis, index: number, count: number): Promise<void> {
    this.grid = shiftGrid(this.grid, axis, index, count);
    this.rebuildIndex();

    // Shift dimension sizes for the affected axis
    if (axis === 'row') {
      this.rowHeights = shiftDimensionMap(this.rowHeights, index, count);
      this.rowStyles = shiftDimensionMap(this.rowStyles, index, count);
    } else {
      this.colWidths = shiftDimensionMap(this.colWidths, index, count);
      this.colStyles = shiftDimensionMap(this.colStyles, index, count);
    }
  }

  async moveCells(axis: Axis, srcIndex: number, count: number, dstIndex: number): Promise<void> {
    this.grid = moveGrid(this.grid, axis, srcIndex, count, dstIndex);
    this.rebuildIndex();

    if (axis === 'row') {
      this.rowHeights = moveDimensionMap(this.rowHeights, srcIndex, count, dstIndex);
      this.rowStyles = moveDimensionMap(this.rowStyles, srcIndex, count, dstIndex);
    } else {
      this.colWidths = moveDimensionMap(this.colWidths, srcIndex, count, dstIndex);
      this.colStyles = moveDimensionMap(this.colStyles, srcIndex, count, dstIndex);
    }
  }

  /**
   * `buildDependantsMap` method builds a map of dependants. Unlike the
   * `IDBStore` implementation, this builds the map from the entire grid.
   */
  async buildDependantsMap(_: Array<Sref>): Promise<Map<Sref, Set<Sref>>> {
    const entries = Array.from(this.grid.entries());

    const dependantsMap = new Map<Sref, Set<Sref>>();
    for (const [ref, cell] of entries) {
      if (!cell.f) {
        continue;
      }

      for (const r of toSrefs(extractReferences(cell.f))) {
        if (!dependantsMap.has(r)) {
          dependantsMap.set(r, new Set());
        }
        dependantsMap.get(r)!.add(ref);
      }
    }
    return dependantsMap;
  }

  /**
   * `getPresences` method gets the user presences.
   * For MemStore, this returns an empty array since it's not connected to real-time collaboration.
   */
  getPresences(): Array<{
    clientID: string;
    presence: { activeCell: string };
  }> {
    return [];
  }

  async setDimensionSize(
    axis: Axis,
    index: number,
    size: number,
  ): Promise<void> {
    const map = axis === 'row' ? this.rowHeights : this.colWidths;
    map.set(index, size);
  }

  async getDimensionSizes(axis: Axis): Promise<Map<number, number>> {
    return new Map(axis === 'row' ? this.rowHeights : this.colWidths);
  }

  /**
   * `updateActiveCell` method updates the active cell of the current user.
   * For MemStore, this is a no-op since it's not connected to real-time collaboration.
   */
  updateActiveCell(_: Ref): void {
    // No-op for memory store
  }

  async setColumnStyle(col: number, style: CellStyle): Promise<void> {
    this.colStyles.set(col, style);
  }

  async getColumnStyles(): Promise<Map<number, CellStyle>> {
    return new Map(this.colStyles);
  }

  async setRowStyle(row: number, style: CellStyle): Promise<void> {
    this.rowStyles.set(row, style);
  }

  async getRowStyles(): Promise<Map<number, CellStyle>> {
    return new Map(this.rowStyles);
  }

  async setSheetStyle(style: CellStyle): Promise<void> {
    this.sheetStyle = style;
  }

  async getSheetStyle(): Promise<CellStyle | undefined> {
    return this.sheetStyle ? { ...this.sheetStyle } : undefined;
  }

  async setFreezePane(frozenRows: number, frozenCols: number): Promise<void> {
    this.frozenRows = frozenRows;
    this.frozenCols = frozenCols;
  }

  async getFreezePane(): Promise<{ frozenRows: number; frozenCols: number }> {
    return { frozenRows: this.frozenRows, frozenCols: this.frozenCols };
  }

  beginBatch(): void {
    // No-op for memory store (no history tracking)
  }

  endBatch(): void {
    // No-op for memory store (no history tracking)
  }

  async undo(): Promise<boolean> {
    return false;
  }

  async redo(): Promise<boolean> {
    return false;
  }

  canUndo(): boolean {
    return false;
  }

  canRedo(): boolean {
    return false;
  }

  private rebuildIndex(): void {
    this.cellIndex.rebuild(
      Array.from(this.grid.keys()).map((sref) => {
        const ref = parseRef(sref);
        return [ref.r, ref.c];
      }),
    );
  }
}
