import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { extractReferences } from '../../formula/formula';
import { parseRef, toSref, toSrefs } from '../../sheet/coordinates';
import { Cell, Grid, Ref, Range, Sref } from '../../sheet/types';

const DBName = 'wafflebase';
const DBVersion = 1;
const GridStore = 'grid';
const DependantsStore = 'dependants';

interface DBType extends DBSchema {
  grid: {
    key: [number, number];
    value: GridRecord;
  };
  dependants: {
    key: Sref;
    value: { sref: Sref; dependants: Array<Sref> };
  };
}

/**
 * `GridRecord` type represents a record in the IndexedDB database.
 */
type GridRecord = {
  r: number;
  c: number;
  v?: string;
  f?: string;
};

/**
 * `toCell` function converts a record to a cell.
 */
function toCell(record: GridRecord | undefined): Cell | undefined {
  if (!record) {
    return undefined;
  }

  const cell: Cell = {};

  if (record.v) {
    cell.v = record.v;
  }

  if (record.f) {
    cell.f = record.f;
  }

  return cell;
}

/**
 * `toRecord` function converts a cell to a record.
 */
function toRecord(ref: Ref, cell: Cell): GridRecord {
  const record: GridRecord = {
    r: ref.r,
    c: ref.c,
  };

  if (cell.v) {
    record.v = cell.v;
  }

  if (cell.f) {
    record.f = cell.f;
  }

  return record;
}

/**
 * `createIDBStore` function creates an instance of `IDBStore` class.
 */
export async function createIDBStore(key: string): Promise<IDBStore> {
  const db = await openIDB(key);
  return new IDBStore(db);
}

/**
 * `openIDB` function opens the IndexedDB database.
 */
async function openIDB(key: string): Promise<IDBPDatabase<DBType>> {
  return await openDB<DBType>(`${DBName}-${key}`, DBVersion, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(GridStore)) {
        db.createObjectStore(GridStore, { keyPath: ['r', 'c'] });
      }
      if (!db.objectStoreNames.contains(DependantsStore)) {
        db.createObjectStore(DependantsStore, { keyPath: 'sref' });
      }
    },
  });
}

/**
 * `IDBStore` class is a wrapper around the `IDBDatabase` object.
 * It provides a set of methods to interact with the database.
 */
export class IDBStore {
  private db: IDBPDatabase<DBType>;

  constructor(db: IDBPDatabase<DBType>) {
    this.db = db;
  }

  /**
   * `setGrid` method stores a grid in the database.
   */
  public async setGrid(grid: Grid): Promise<void> {
    const tx = this.db.transaction(GridStore, 'readwrite');
    const store = tx.objectStore(GridStore);

    for (const [sref, cell] of grid) {
      await store.put(toRecord(parseRef(sref), cell));
    }

    await tx.done;
  }

  /**
   * `set` stores a value in the database with the specified key.
   * @param ref The key to store the value under.
   * @param cell The value to store.
   */
  public async set(ref: Ref, cell: Cell): Promise<void> {
    const tx = this.db.transaction([GridStore, DependantsStore], 'readwrite');
    await tx.objectStore(GridStore).put(toRecord(ref, cell));
    if (cell.f) {
      for (const sref of toSrefs(extractReferences(cell.f))) {
        const record = await tx.objectStore(DependantsStore).get(sref);
        const dependants = new Set(record ? record.dependants : []);
        dependants.add(toSref(ref));
        await tx
          .objectStore(DependantsStore)
          .put({ sref, dependants: Array.from(dependants) });
      }
    }
    await tx.done;
  }

  /**
   * `get` retrieves a value from the database by key.
   */
  public async get(ref: Ref): Promise<Cell | undefined> {
    const tx = this.db.transaction(GridStore, 'readonly');
    const record = await tx.objectStore(GridStore).get([ref.r, ref.c]);
    return toCell(record);
  }

  /**
   * `has` method checks if the database contains a value with the specified key.
   */
  public async has(ref: Ref): Promise<boolean> {
    const tx = this.db.transaction(GridStore, 'readonly');
    const store = tx.objectStore(GridStore);
    const cell = await store.get([ref.r, ref.c]);
    return cell !== undefined;
  }

  /**
   * `delete` method removes a value from the database by key.
   */
  public async delete(ref: Ref): Promise<boolean> {
    const tx = this.db.transaction([GridStore, DependantsStore], 'readwrite');
    const store = tx.objectStore(GridStore);
    const cell = await store.get([ref.r, ref.c]);
    if (cell === undefined) {
      return false;
    }

    await store.delete([ref.r, ref.c]);
    if (cell.f) {
      for (const sref of toSrefs(extractReferences(cell.f))) {
        const record = await tx.objectStore(DependantsStore).get(sref);
        const dependants = new Set(record?.dependants || []);
        dependants.delete(toSref(ref));

        if (dependants.size === 0) {
          await tx.objectStore(DependantsStore).delete(sref);
          continue;
        }
        await tx
          .objectStore(DependantsStore)
          .put({ sref, dependants: Array.from(dependants) });
      }
    }

    return true;
  }

  public async getGrid(range: Range): Promise<Grid> {
    const [from, to] = range;
    const tx = this.db.transaction(GridStore, 'readonly');
    let cursor = await tx
      .objectStore(GridStore)
      .openCursor(IDBKeyRange.bound([from.r, from.c], [to.r, to.c]));

    const grid: Grid = new Map();
    while (cursor) {
      const {
        key: [row, col],
        value,
      } = cursor;
      grid.set(toSref({ r: row, c: col }), toCell(value)!);
      cursor = await cursor.continue();
    }
    return grid;
  }

  async buildDependantsMap(
    srefs: Iterable<Sref>,
  ): Promise<Map<Sref, Set<Sref>>> {
    const tx = this.db.transaction(DependantsStore, 'readonly');

    const dependantsMap = new Map<Sref, Set<Sref>>();
    for (const sref of srefs) {
      const record = await tx.objectStore(DependantsStore).get(sref);
      if (record === undefined) {
        continue;
      }

      dependantsMap.set(sref, new Set(record.dependants));
    }

    return dependantsMap;
  }
}
