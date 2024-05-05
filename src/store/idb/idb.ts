import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { extractReferences } from '../../formula/formula';
import { parseRef, toSref, toSrefs } from '../../sheet/coordinates';
import { Cell, Grid, Ref, Range, Sref } from '../../sheet/types';

const DBName = 'wafflebase';
const DBVersion = 1;
const CellStore = 'cells';
const DependantStore = 'dependants';

/**
 * `CellRecord` type represents a record in the database.
 */
type CellRecord = {
  r: number;
  c: number;
  v?: string;
  f?: string;
};

/**
 * `DependantRecord` type represents a record in the dependants store.
 */
type DependantRecord = {
  sref: Sref;
  dependants: Array<Sref>;
};

/**
 * `DBType` interface represents the database schema.
 */
interface DBType extends DBSchema {
  [CellStore]: {
    key: [number, number];
    value: CellRecord;
  };
  [DependantStore]: {
    key: Sref;
    value: DependantRecord;
  };
}

/**
 * `toCell` function converts a record to a cell.
 */
function toCell(record: CellRecord | undefined): Cell | undefined {
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
function toRecord(ref: Ref, cell: Cell): CellRecord {
  const record: CellRecord = {
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
      if (!db.objectStoreNames.contains(CellStore)) {
        db.createObjectStore(CellStore, { keyPath: ['r', 'c'] });
      }
      if (!db.objectStoreNames.contains(DependantStore)) {
        db.createObjectStore(DependantStore, { keyPath: 'sref' });
      }
    },
  });
}

/**
 * `IDBStore` class is a wrapper around the `IDBPDatabase` object.
 * It provides a set of methods to interact with the database.
 */
export class IDBStore {
  private db: IDBPDatabase<DBType>;

  constructor(db: IDBPDatabase<DBType>) {
    this.db = db;
  }

  public async set(ref: Ref, cell: Cell): Promise<void> {
    const tx = this.db.transaction([CellStore, DependantStore], 'readwrite');
    await tx.objectStore(CellStore).put(toRecord(ref, cell));

    if (cell.f) {
      for (const sref of toSrefs(extractReferences(cell.f))) {
        const record = await tx.objectStore(DependantStore).get(sref);
        const dependants = new Set(record ? record.dependants : []);
        dependants.add(toSref(ref));
        await tx
          .objectStore(DependantStore)
          .put({ sref, dependants: Array.from(dependants) });
      }
    }

    await tx.done;
  }

  public async get(ref: Ref): Promise<Cell | undefined> {
    const tx = this.db.transaction(CellStore, 'readonly');
    const record = await tx.objectStore(CellStore).get([ref.r, ref.c]);
    return toCell(record);
  }

  public async has(ref: Ref): Promise<boolean> {
    const tx = this.db.transaction(CellStore, 'readonly');
    const store = tx.objectStore(CellStore);
    const cell = await store.get([ref.r, ref.c]);
    return cell !== undefined;
  }

  public async delete(ref: Ref): Promise<boolean> {
    const tx = this.db.transaction([CellStore, DependantStore], 'readwrite');
    const store = tx.objectStore(CellStore);
    const cell = await store.get([ref.r, ref.c]);
    if (cell === undefined) {
      return false;
    }

    await store.delete([ref.r, ref.c]);

    if (cell.f) {
      for (const sref of toSrefs(extractReferences(cell.f))) {
        const record = await tx.objectStore(DependantStore).get(sref);
        const dependants = new Set(record?.dependants || []);
        dependants.delete(toSref(ref));

        if (dependants.size === 0) {
          await tx.objectStore(DependantStore).delete(sref);
          continue;
        }
        await tx
          .objectStore(DependantStore)
          .put({ sref, dependants: Array.from(dependants) });
      }
    }

    await tx.done;

    return true;
  }

  public async setGrid(grid: Grid): Promise<void> {
    const tx = this.db.transaction(CellStore, 'readwrite');
    const store = tx.objectStore(CellStore);

    for (const [sref, cell] of grid) {
      await store.put(toRecord(parseRef(sref), cell));
    }

    await tx.done;
  }

  public async getGrid(range: Range): Promise<Grid> {
    const [from, to] = range;
    const tx = this.db.transaction(CellStore, 'readonly');
    let cursor = await tx
      .objectStore(CellStore)
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
    const tx = this.db.transaction(DependantStore, 'readonly');

    const stack = Array.from(srefs);
    const dependantsMap = new Map<Sref, Set<Sref>>();
    while (stack.length) {
      const sref = stack.pop()!;
      if (dependantsMap.has(sref)) {
        continue;
      }

      const record = await tx.objectStore(DependantStore).get(sref);
      if (record === undefined) {
        dependantsMap.set(sref, new Set());
        continue;
      }

      dependantsMap.set(sref, new Set(record.dependants));
      stack.push(...record.dependants);
    }

    return dependantsMap;
  }
}
