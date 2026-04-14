import type { Document } from "@yorkie-js/react";
import {
  CellIndex,
  findEdgeWithIndex,
  toSref,
  parseRef,
  extractReferences,
  toSrefs,
  getWorksheetCell,
  getWorksheetEntries,
  getWorksheetKeys,
  isCrossSheetRef,
  cloneConditionalFormatRule,
  normalizeConditionalFormatRule,
  cloneRangeStylePatch,
  normalizeRangeStylePatch,
  writeWorksheetCell,
  safeWorksheetRecordEntries,
} from "@wafflebase/sheets";
import type {
  Store,
  Grid,
  Cell,
  CellStyle,
  CellAnchor,
  RangeAnchor,
  FilterCondition,
  FilterState,
  HiddenState,
  PivotTableDefinition,
  Ref,
  Sref,
  Range,
  Direction,
  Axis,
  ConditionalFormatRule,
  RangeStylePatch,
} from "@wafflebase/sheets";
import type { SpreadsheetDocument, Worksheet } from "@/types/worksheet";
import type { UserPresence } from "@/types/users";
import {
  applyYorkieWorksheetMove,
  applyYorkieWorksheetShift,
} from "./yorkie-worksheet-structure";

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

    // Keep presence aligned with the currently opened tab so peer cursors can
    // be scoped to that tab.
    this.doc.update((_, p) => {
      p.set({ activeTabId: this.tabId });
    });

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

  private worksheetKeys(ws: Worksheet): Sref[] {
    return getWorksheetKeys(ws);
  }

  private worksheetEntries(ws: Worksheet): Array<[Sref, Cell]> {
    return getWorksheetEntries(ws);
  }

  private getWorksheetCell(ws: Worksheet, ref: Ref): Cell | undefined {
    return getWorksheetCell(ws, ref);
  }

  private setWorksheetCell(
    ws: Worksheet,
    ref: Ref,
    cell: Cell | undefined,
  ): void {
    writeWorksheetCell(ws, ref, cell);
  }

  private toPlainString(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (typeof value === "object") {
      const withValue = value as { value?: unknown; toJSON?: () => unknown };
      if (withValue.value !== undefined && withValue.value !== value) {
        return this.toPlainString(withValue.value);
      }
      if (typeof withValue.toJSON === "function") {
        try {
          const jsonValue = withValue.toJSON.call(value);
          if (jsonValue !== value) {
            return this.toPlainString(jsonValue);
          }
        } catch {
          // Ignore and fall back to generic string conversion.
        }
      }
    }
    return String(value);
  }

  private normalizeFilterCondition(condition: FilterCondition): FilterCondition {
    const normalized: FilterCondition = { op: condition.op };
    if (condition.value !== undefined) {
      normalized.value = this.toPlainString(condition.value);
    }
    if (condition.values !== undefined) {
      normalized.values = condition.values.map((value) =>
        this.toPlainString(value),
      );
    }
    return normalized;
  }

  private toWorksheetFilterState(state: FilterState): NonNullable<Worksheet["filter"]> {
    return {
      startRow: state.range[0].r,
      endRow: state.range[1].r,
      startCol: state.range[0].c,
      endCol: state.range[1].c,
      columns: Object.fromEntries(
        Object.entries(state.columns).map(([key, condition]) => [
          key,
          this.normalizeFilterCondition(condition),
        ]),
      ),
      hiddenRows: [...state.hiddenRows],
    };
  }

  private fromWorksheetFilterState(
    state: Worksheet["filter"] | undefined,
  ): FilterState | undefined {
    if (!state) return undefined;
    return {
      range: [
        { r: state.startRow, c: state.startCol },
        { r: state.endRow, c: state.endCol },
      ],
      columns: Object.fromEntries(
        Object.entries(state.columns || {}).map(([key, condition]) => [
          key,
          this.normalizeFilterCondition(condition as FilterCondition),
        ]),
      ),
      hiddenRows: [...(state.hiddenRows || [])],
    };
  }

  private ensureIndex(): void {
    if (!this.dirty) return;

    const ws = this.getSheet();
    const entries: Array<[number, number]> = [];
    for (const sref of this.worksheetKeys(ws)) {
      const ref = parseRef(sref);
      entries.push([ref.r, ref.c]);
    }
    this.cellIndex.rebuild(entries);
    this.dirty = false;
  }

  /**
   * Normalizes a cell before persistence.
   * - Drops empty-string values (`v: ""`) as default.
   * - Drops empty formulas/styles.
   * - Returns null when the cell has no meaningful payload.
   */
  private normalizeCell(cell: Cell): Cell | null {
    const normalized: Cell = {};

    if (cell.v !== undefined && cell.v !== "") {
      normalized.v = cell.v;
    }

    if (cell.f !== undefined && cell.f !== "") {
      normalized.f = cell.f;
    }

    if (cell.s && Object.keys(cell.s).length > 0) {
      normalized.s = cell.s;
    }

    if (
      normalized.v === undefined &&
      normalized.f === undefined &&
      normalized.s === undefined
    ) {
      return null;
    }

    return normalized;
  }

  /**
   * `set` method sets the value of a cell.
   */
  async set(ref: Ref, value: Cell): Promise<void> {
    const sref = toSref(ref);
    const normalized = this.normalizeCell(value);

    if (this.batchOverlay) {
      if (normalized) {
        this.batchOverlay.set(sref, normalized);
        if (!this.dirty) {
          this.cellIndex.add(ref.r, ref.c);
        }
      } else {
        this.batchOverlay.set(sref, null);
        if (!this.dirty) {
          this.cellIndex.remove(ref.r, ref.c);
        }
      }
      return;
    }

    if (!normalized) {
      await this.delete(ref);
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      this.setWorksheetCell(root.sheets[tabId], ref, normalized);
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
    return this.getWorksheetCell(this.getSheet(), ref);
  }

  /**
   * `has` method checks if a cell exists.
   */
  async has(ref: Ref): Promise<boolean> {
    const sref = toSref(ref);
    if (this.batchOverlay && this.batchOverlay.has(sref)) {
      return this.batchOverlay.get(sref) !== null;
    }
    return this.getWorksheetCell(this.getSheet(), ref) !== undefined;
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
        exists = this.getWorksheetCell(this.getSheet(), ref) !== undefined;
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
      if (this.getWorksheetCell(root.sheets[tabId], ref) !== undefined) {
        this.setWorksheetCell(root.sheets[tabId], ref, undefined);
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
        const ref = { r: row, c: col };
        this.setWorksheetCell(root.sheets[tabId], ref, undefined);
        deleted.add(toSref(ref));
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
        const ref = parseRef(sref);
        const normalized = this.normalizeCell(cell);
        if (normalized) {
          this.batchOverlay.set(sref, normalized);
          if (!this.dirty) {
            this.cellIndex.add(ref.r, ref.c);
          }
        } else {
          this.batchOverlay.set(sref, null);
          if (!this.dirty) {
            this.cellIndex.remove(ref.r, ref.c);
          }
        }
      }
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      for (const [sref, cell] of grid) {
        const ref = parseRef(sref);
        const normalized = this.normalizeCell(cell);
        if (normalized) {
          this.setWorksheetCell(root.sheets[tabId], ref, normalized);
        } else {
          this.setWorksheetCell(root.sheets[tabId], ref, undefined);
        }
      }
    });
    if (!this.dirty) {
      for (const [sref, cell] of grid) {
        const ref = parseRef(sref);
        if (this.normalizeCell(cell)) {
          this.cellIndex.add(ref.r, ref.c);
        } else {
          this.cellIndex.remove(ref.r, ref.c);
        }
      }
    }
  }

  /**
   * `getGrid` method gets the grid.
   */
  async getGrid(range: Range): Promise<Grid> {
    this.ensureIndex();

    const ws = this.getSheet();
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
      const value = this.getWorksheetCell(ws, { r: row, c: col });
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
        const cell = this.getWorksheetCell(this.getSheet(), { r, c });
        return cell !== undefined && (!!cell.v || !!cell.f);
      },
    );
  }

  async shiftCells(axis: Axis, index: number, count: number): Promise<void> {
    const tabId = this.tabId;
    const applyShift = (root: SpreadsheetDocument) => {
      applyYorkieWorksheetShift({
        ws: root.sheets[tabId],
        axis,
        index,
        count,
        normalizeCell: this.normalizeCell.bind(this),
      });
    };

    if (this.batchOps) {
      this.batchOps.push(applyShift);
      this.dirty = true;
      return;
    }

    this.doc.update((root) => {
      applyShift(root);
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
    const applyMove = (root: SpreadsheetDocument) => {
      applyYorkieWorksheetMove({
        ws: root.sheets[tabId],
        axis,
        srcIndex,
        count,
        dstIndex,
        normalizeCell: this.normalizeCell.bind(this),
      });
    };

    if (this.batchOps) {
      this.batchOps.push(applyMove);
      this.dirty = true;
      return;
    }

    this.doc.update((root) => {
      applyMove(root);
    });

    this.dirty = true;
  }

  async getFormulaGrid(): Promise<Map<Sref, Cell>> {
    const grid = new Map<Sref, Cell>();
    const ws = this.getSheet();
    for (const [sref, cell] of this.worksheetEntries(ws)) {
      if (cell.f) {
        grid.set(sref, cell as Cell);
      }
    }
    return grid;
  }

  async buildDependantsMap(
    srefs: Iterable<Sref>,
  ): Promise<Map<Sref, Set<Sref>>> {
    void srefs;
    const dependantsMap = new Map<Sref, Set<Sref>>();
    const ws = this.getSheet();

    if (this.batchOverlay) {
      // Iterate document cells, skipping those deleted in overlay
      for (const [sref, cell] of this.worksheetEntries(ws)) {
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

    for (const [sref, cell] of this.worksheetEntries(ws)) {
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
      for (const [key, value] of safeWorksheetRecordEntries(obj)) {
        result.set(Number(key), value);
      }
    }
    return result;
  }

  updateActiveCell(activeCell: Ref) {
    this.doc.update((_, p) => {
      p.set({ activeCell: toSref(activeCell), activeTabId: this.tabId });
    });
  }

  updateSelection(activeCell: CellAnchor, ranges: RangeAnchor[]) {
    this.doc.update((_, p) => {
      p.set({
        selection: { activeCell, ranges },
        activeTabId: this.tabId,
      });
    });
  }

  getRowOrder(): string[] {
    const ws = this.getSheet();
    return ws.rowOrder ? [...ws.rowOrder] : [];
  }

  getColOrder(): string[] {
    const ws = this.getSheet();
    return ws.colOrder ? [...ws.colOrder] : [];
  }

  getPresences(): Array<{ clientID: string; presence: UserPresence }> {
    return this.doc
      .getOthersPresences()
      .filter((data) => data.presence?.activeTabId === this.tabId);
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
      for (const [key, value] of safeWorksheetRecordEntries(ws.colStyles)) {
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
      for (const [key, value] of safeWorksheetRecordEntries(ws.rowStyles)) {
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

  async addRangeStyle(patch: RangeStylePatch): Promise<void> {
    const normalized = normalizeRangeStylePatch(patch);
    if (!normalized) {
      return;
    }

    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        if (!root.sheets[tabId].rangeStyles) {
          root.sheets[tabId].rangeStyles = [];
        }
        root.sheets[tabId].rangeStyles.push(cloneRangeStylePatch(normalized));
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      if (!root.sheets[tabId].rangeStyles) {
        root.sheets[tabId].rangeStyles = [];
      }
      root.sheets[tabId].rangeStyles.push(cloneRangeStylePatch(normalized));
    });
  }

  async setRangeStyles(patches: RangeStylePatch[]): Promise<void> {
    const normalized = patches
      .map((patch) => normalizeRangeStylePatch(patch))
      .filter((patch): patch is RangeStylePatch => !!patch)
      .map((patch) => cloneRangeStylePatch(patch));

    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        if (normalized.length === 0) {
          delete root.sheets[tabId].rangeStyles;
          return;
        }
        root.sheets[tabId].rangeStyles = normalized.map((patch) =>
          cloneRangeStylePatch(patch),
        );
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      if (normalized.length === 0) {
        delete root.sheets[tabId].rangeStyles;
        return;
      }
      root.sheets[tabId].rangeStyles = normalized.map((patch) =>
        cloneRangeStylePatch(patch),
      );
    });
  }

  async getRangeStyles(): Promise<RangeStylePatch[]> {
    const ws = this.getSheet();
    if (!ws.rangeStyles || ws.rangeStyles.length === 0) {
      return [];
    }
    return (ws.rangeStyles as RangeStylePatch[]).map((patch) =>
      cloneRangeStylePatch(patch),
    );
  }

  async setConditionalFormats(rules: ConditionalFormatRule[]): Promise<void> {
    const normalized = rules
      .map((rule) => normalizeConditionalFormatRule(rule))
      .filter((rule): rule is ConditionalFormatRule => !!rule)
      .map((rule) => cloneConditionalFormatRule(rule));

    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        if (normalized.length === 0) {
          delete root.sheets[tabId].conditionalFormats;
          return;
        }
        root.sheets[tabId].conditionalFormats = normalized.map((rule) =>
          cloneConditionalFormatRule(rule),
        );
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      if (normalized.length === 0) {
        delete root.sheets[tabId].conditionalFormats;
        return;
      }
      root.sheets[tabId].conditionalFormats = normalized.map((rule) =>
        cloneConditionalFormatRule(rule),
      );
    });
  }

  async getConditionalFormats(): Promise<ConditionalFormatRule[]> {
    const ws = this.getSheet();
    if (!ws.conditionalFormats || ws.conditionalFormats.length === 0) {
      return [];
    }
    return (ws.conditionalFormats as ConditionalFormatRule[]).map((rule) =>
      cloneConditionalFormatRule(rule),
    );
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
    for (const [sref, span] of safeWorksheetRecordEntries(ws.merges)) {
      result.set(sref, { ...span });
    }
    return result;
  }

  async setFilterState(state: FilterState | undefined): Promise<void> {
    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        const ws = root.sheets[tabId];
        if (!state) {
          delete ws.filter;
          return;
        }
        ws.filter = this.toWorksheetFilterState(state);
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      const ws = root.sheets[tabId];
      if (!state) {
        delete ws.filter;
        return;
      }
      ws.filter = this.toWorksheetFilterState(state);
    });
  }

  async getFilterState(): Promise<FilterState | undefined> {
    return this.fromWorksheetFilterState(this.getSheet().filter);
  }

  async setPivotDefinition(def: PivotTableDefinition | undefined): Promise<void> {
    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        const ws = root.sheets[tabId];
        if (!def) {
          delete ws.pivotTable;
          return;
        }
        ws.pivotTable = def;
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      const ws = root.sheets[tabId];
      if (!def) {
        delete ws.pivotTable;
        return;
      }
      ws.pivotTable = def;
    });
  }

  async getPivotDefinition(): Promise<PivotTableDefinition | undefined> {
    const ws = this.getSheet();
    const pt = ws.pivotTable;
    if (!pt) return undefined;

    // Read properties directly from Yorkie CRDT proxy to avoid
    // structuredClone failures on proxy objects.
    const readField = (f: { sourceColumn: number; label: string; sort?: string }) => ({
      sourceColumn: f.sourceColumn,
      label: f.label,
      sort: f.sort as 'asc' | 'desc' | undefined,
    });
    return {
      id: pt.id,
      sourceTabId: pt.sourceTabId,
      sourceRange: pt.sourceRange,
      rowFields: Array.from(pt.rowFields ?? []).map(readField),
      columnFields: Array.from(pt.columnFields ?? []).map(readField),
      valueFields: Array.from(pt.valueFields ?? []).map((f: Record<string, unknown>) => ({
        ...readField(f as { sourceColumn: number; label: string; sort?: string }),
        aggregation: (f as { aggregation: string }).aggregation,
      })),
      filterFields: Array.from(pt.filterFields ?? []).map((f: Record<string, unknown>) => ({
        ...readField(f as { sourceColumn: number; label: string; sort?: string }),
        hiddenValues: Array.from((f as { hiddenValues?: string[] }).hiddenValues ?? []),
      })),
      showTotals: pt.showTotals
        ? { rows: pt.showTotals.rows, columns: pt.showTotals.columns }
        : { rows: true, columns: true },
    } as PivotTableDefinition;
  }

  async setHiddenState(state: HiddenState | undefined): Promise<void> {
    if (this.batchOps) {
      const tabId = this.tabId;
      this.batchOps.push((root) => {
        const ws = root.sheets[tabId];
        if (!state) {
          delete ws.hiddenRows;
          delete ws.hiddenColumns;
          return;
        }
        ws.hiddenRows = [...state.rows];
        ws.hiddenColumns = [...state.columns];
      });
      return;
    }

    const tabId = this.tabId;
    this.doc.update((root) => {
      const ws = root.sheets[tabId];
      if (!state) {
        delete ws.hiddenRows;
        delete ws.hiddenColumns;
        return;
      }
      ws.hiddenRows = [...state.rows];
      ws.hiddenColumns = [...state.columns];
    });
  }

  async getHiddenState(): Promise<HiddenState | undefined> {
    const ws = this.getSheet();
    const rows = ws.hiddenRows;
    const columns = ws.hiddenColumns;
    if (!rows && !columns) return undefined;
    return {
      rows: rows ? [...rows] : [],
      columns: columns ? [...columns] : [],
    };
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
          const ref = parseRef(sref);
          if (cell === null) {
            this.setWorksheetCell(ws, ref, undefined);
          } else {
            const normalized = this.normalizeCell(cell);
            this.setWorksheetCell(ws, ref, normalized ?? undefined);
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

    const beforeCellKeys = new Set(this.worksheetKeys(this.getSheet()));
    const beforeMerges = new Map<Sref, MergeSpan>(
      safeWorksheetRecordEntries(this.getSheet().merges) as Array<[Sref, MergeSpan]>,
    );
    this.doc.history.undo();
    this.dirty = true;

    const affectedRange = this.computeAffectedRange(beforeCellKeys, beforeMerges);
    return { success: true, affectedRange };
  }

  async redo(): Promise<{ success: boolean; affectedRange?: Range }> {
    if (!this.doc.history.canRedo()) return { success: false };

    const beforeCellKeys = new Set(this.worksheetKeys(this.getSheet()));
    const beforeMerges = new Map<Sref, MergeSpan>(
      safeWorksheetRecordEntries(this.getSheet().merges) as Array<[Sref, MergeSpan]>,
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
    const afterKeys = new Set(this.worksheetKeys(this.getSheet()));
    const afterMerges = new Map<Sref, MergeSpan>(
      safeWorksheetRecordEntries(this.getSheet().merges) as Array<[Sref, MergeSpan]>,
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

  invalidate(): void {
    this.dirty = true;
  }
}
