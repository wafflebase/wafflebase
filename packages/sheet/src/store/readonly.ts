import { parseRef, toSref } from '../model/coordinates';
import {
  Axis,
  Cell,
  CellStyle,
  ConditionalFormatRule,
  FilterState,
  Grid,
  MergeSpan,
  Ref,
  Range,
  Sref,
  Direction,
} from '../model/types';
import { RangeStylePatch } from '../model/range-styles';
import { CellIndex } from './cell-index';
import { findEdgeWithIndex } from './find-edge';
import { Store } from './store';

/**
 * `ReadOnlyStore` is a Store implementation for displaying query results.
 * All write operations are no-ops. Data is loaded via `loadQueryResults`.
 */
export class ReadOnlyStore implements Store {
  private grid: Map<Sref, Cell> = new Map();
  private cellIndex: CellIndex = new CellIndex();

  /**
   * Loads query result data into the store.
   * Row 1 contains column headers (bold), rows 2+ contain data.
   * Uses 1-based indices to match the sheet coordinate system.
   */
  loadQueryResults(
    columns: Array<{ name: string }>,
    rows: Array<Record<string, unknown>>,
  ): void {
    this.grid.clear();

    // Row 1: column headers (1-based)
    for (let c = 0; c < columns.length; c++) {
      const sref = toSref({ r: 1, c: c + 1 });
      this.grid.set(sref, {
        v: columns[c].name,
        s: { b: true },
      });
    }

    // Row 2+: data rows (1-based)
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < columns.length; c++) {
        const val = row[columns[c].name];
        if (val === null || val === undefined) continue;
        const sref = toSref({ r: r + 2, c: c + 1 });
        this.grid.set(sref, { v: String(val) });
      }
    }

    this.rebuildIndex();
  }

  async set(_ref: Ref, _value: Cell): Promise<void> {
    // no-op
  }

  async get(ref: Ref): Promise<Cell | undefined> {
    return this.grid.get(toSref(ref));
  }

  async has(ref: Ref): Promise<boolean> {
    return this.grid.has(toSref(ref));
  }

  async delete(_ref: Ref): Promise<boolean> {
    return false;
  }

  async deleteRange(_range: Range): Promise<Set<Sref>> {
    return new Set();
  }

  async setGrid(_grid: Grid): Promise<void> {
    // no-op
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

  async findEdge(
    ref: Ref,
    direction: Direction,
    dimension: Range,
  ): Promise<Ref> {
    return findEdgeWithIndex(
      this.cellIndex,
      ref,
      direction,
      dimension,
      (r, c) => {
        const cell = this.grid.get(toSref({ r, c }));
        return cell !== undefined && (!!cell.v || !!cell.f);
      },
    );
  }

  async shiftCells(_axis: Axis, _index: number, _count: number): Promise<void> {
    // no-op
  }

  async moveCells(
    _axis: Axis,
    _srcIndex: number,
    _count: number,
    _dstIndex: number,
  ): Promise<void> {
    // no-op
  }

  async buildDependantsMap(
    _srefs: Iterable<Sref>,
  ): Promise<Map<Sref, Set<Sref>>> {
    return new Map();
  }

  async getFormulaGrid(): Promise<Grid> {
    return new Map();
  }

  getPresences(): Array<{
    clientID: string;
    presence: { activeCell: string };
  }> {
    return [];
  }

  updateActiveCell(_ref: Ref): void {
    // no-op
  }

  async setDimensionSize(
    _axis: Axis,
    _index: number,
    _size: number,
  ): Promise<void> {
    // no-op
  }

  async getDimensionSizes(_axis: Axis): Promise<Map<number, number>> {
    return new Map();
  }

  async setColumnStyle(_col: number, _style: CellStyle): Promise<void> {
    // no-op
  }

  async getColumnStyles(): Promise<Map<number, CellStyle>> {
    return new Map();
  }

  async setRowStyle(_row: number, _style: CellStyle): Promise<void> {
    // no-op
  }

  async getRowStyles(): Promise<Map<number, CellStyle>> {
    return new Map();
  }

  async setSheetStyle(_style: CellStyle): Promise<void> {
    // no-op
  }

  async getSheetStyle(): Promise<CellStyle | undefined> {
    return undefined;
  }

  async addRangeStyle(_patch: RangeStylePatch): Promise<void> {
    // no-op
  }

  async setRangeStyles(_patches: RangeStylePatch[]): Promise<void> {
    // no-op
  }

  async getRangeStyles(): Promise<RangeStylePatch[]> {
    return [];
  }

  async setConditionalFormats(
    _rules: ConditionalFormatRule[],
  ): Promise<void> {
    // no-op
  }

  async getConditionalFormats(): Promise<ConditionalFormatRule[]> {
    return [];
  }

  async setMerge(_anchor: Ref, _span: MergeSpan): Promise<void> {
    // no-op
  }

  async deleteMerge(_anchor: Ref): Promise<boolean> {
    return false;
  }

  async getMerges(): Promise<Map<Sref, MergeSpan>> {
    return new Map();
  }

  async setFilterState(_state: FilterState | undefined): Promise<void> {
    // no-op
  }

  async getFilterState(): Promise<FilterState | undefined> {
    return undefined;
  }

  async setFreezePane(_frozenRows: number, _frozenCols: number): Promise<void> {
    // no-op
  }

  async getFreezePane(): Promise<{ frozenRows: number; frozenCols: number }> {
    return { frozenRows: 0, frozenCols: 0 };
  }

  beginBatch(): void {
    // no-op
  }

  endBatch(): void {
    // no-op
  }

  async undo(): Promise<{ success: boolean }> {
    return { success: false };
  }

  async redo(): Promise<{ success: boolean }> {
    return { success: false };
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
