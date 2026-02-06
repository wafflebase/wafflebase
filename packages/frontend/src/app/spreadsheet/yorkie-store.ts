import { Document } from "@yorkie-js/react";
import {
  Store,
  Grid,
  Cell,
  Ref,
  Sref,
  Range,
  Direction,
  Axis,
  toSref,
  parseRef,
  inRange,
  extractReferences,
  toSrefs,
  shiftSref,
  shiftFormula,
} from "@wafflebase/sheet";
import { Worksheet } from "@/types/worksheet";
import { UserPresence } from "@/types/users";

export class YorkieStore implements Store {
  private doc: Document<Worksheet, UserPresence>;

  constructor(doc: Document<Worksheet, UserPresence>) {
    this.doc = doc;
  }

  /**
   * `set` method sets the value of a cell.
   */
  async set(ref: Ref, value: Cell): Promise<void> {
    this.doc.update((root) => {
      root.sheet[toSref(ref)] = value;
    });
  }

  /**
   * `get` method gets the value of a cell.
   */
  async get(ref: Ref): Promise<Cell | undefined> {
    return this.doc.getRoot().sheet[toSref(ref)];
  }

  /**
   * `has` method checks if a cell exists.
   */
  async has(ref: Ref): Promise<boolean> {
    const sheet = this.doc.getRoot().sheet;
    return sheet[toSref(ref)] !== undefined;
  }

  /**
   * `delete` method deletes a cell.
   */
  async delete(ref: Ref): Promise<boolean> {
    let deleted = false;
    this.doc.update((root) => {
      if (root.sheet[toSref(ref)] !== undefined) {
        delete root.sheet[toSref(ref)];
        deleted = true;
      }
    });
    return deleted;
  }

  /**
   * `setGrid` method sets the grid.
   */
  async setGrid(grid: Grid): Promise<void> {
    this.doc.update((root) => {
      for (const [sref, cell] of grid) {
        root.sheet[sref] = cell;
      }
    });
  }

  /**
   * `getGrid` method gets the grid.
   */
  async getGrid(range: Range): Promise<Grid> {
    const sheet = this.doc.getRoot().sheet;
    const grid: Grid = new Map();

    for (const [sref, value] of Object.entries(sheet)) {
      const ref = parseRef(sref);
      if (inRange(ref, range)) {
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
    let row = ref.r;
    let col = ref.c;

    const sheet = this.doc.getRoot().sheet;
    const rowDelta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
    const colDelta = direction === "left" ? -1 : direction === "right" ? 1 : 0;

    let first = true;
    let prev = true;
    while (true) {
      const nextRow = row + rowDelta;
      const nextCol = col + colDelta;

      if (!inRange({ r: nextRow, c: nextCol }, dimension)) {
        break;
      }

      const curr = sheet[toSref({ r: row, c: col })] !== undefined;
      const next = sheet[toSref({ r: nextRow, c: nextCol })] !== undefined;

      if (!prev && curr) {
        break;
      }
      if (!first && curr && !next) {
        break;
      }

      prev = curr;
      first = false;

      row = nextRow;
      col = nextCol;
    }

    return { r: row, c: col };
  }

  async shiftCells(axis: Axis, index: number, count: number): Promise<void> {
    this.doc.update((root) => {
      // Collect all entries and compute new keys/formulas
      const entries: Array<[string, Cell]> = [];
      for (const [sref, cell] of Object.entries(root.sheet)) {
        entries.push([sref, { v: cell.v, f: cell.f }]);
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
    });
  }

  async buildDependantsMap(_: Iterable<Sref>): Promise<Map<Sref, Set<Sref>>> {
    const dependantsMap = new Map<Sref, Set<Sref>>();
    const sheet = this.doc.getRoot().sheet;
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

  updateActiveCell(activeCell: Ref) {
    this.doc.update((_, p) => {
      p.set({ activeCell: toSref(activeCell) });
    });
  }

  getPresences(): Array<{ clientID: string; presence: UserPresence }> {
    return this.doc.getOthersPresences();
  }
}
