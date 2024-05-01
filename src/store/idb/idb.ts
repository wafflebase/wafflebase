import { parseRef, toRef } from '../../sheet/coordinates';
import { Ref, Cell, Grid } from '../../sheet/types';

const DBName = 'wafflebase';
const DBVersion = 1;
const GridStore = 'grid';

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
  const id = parseRef(ref);

  const record: GridRecord = {
    r: id.row,
    c: id.col,
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
function openIDB(key: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`${DBName}-${key}`, DBVersion);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GridStore)) {
        db.createObjectStore(GridStore, { keyPath: ['r', 'c'] });
      }
    };
  });
}

/**
 * `IDBStore` class is a wrapper around the `IDBDatabase` object.
 * It provides a set of methods to interact with the database.
 */
export class IDBStore {
  private db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  /**
   * `setGrid` method stores a grid in the database.
   */
  public async setGrid(items: Grid): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(GridStore, 'readwrite');
      const store = transaction.objectStore(GridStore);

      for (const [ref, cell] of items) {
        store.put(toRecord(ref, cell));
      }

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        reject(transaction.error);
      };
    });
  }

  /**
   * `set` stores a value in the database with the specified key.
   * @param ref The key to store the value under.
   * @param value The value to store.
   */
  public async set(ref: Ref, value: Cell): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(GridStore, 'readwrite');
      const store = transaction.objectStore(GridStore);
      const request = store.put(toRecord(ref, value));

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * `get` retrieves a value from the database by key.
   */
  public async get(ref: Ref): Promise<Cell | undefined> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(GridStore, 'readonly');
      const store = transaction.objectStore(GridStore);
      const id = parseRef(ref);
      const request = store.get([id.row, id.col]);

      request.onsuccess = () => {
        resolve(toCell(request.result));
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * `has` method checks if the database contains a value with the specified key.
   */
  public async has(ref: Ref): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(GridStore, 'readonly');
      const store = transaction.objectStore(GridStore);
      const id = parseRef(ref);
      const request = store.get([id.row, id.col]);

      request.onsuccess = () => {
        resolve(request.result !== undefined);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * `delete` method removes a value from the database by key.
   */
  public async delete(ref: Ref): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(GridStore, 'readwrite');
      const store = transaction.objectStore(GridStore);
      const id = parseRef(ref);
      const request = store.get([id.row, id.col]);

      request.onsuccess = () => {
        if (request.result !== undefined) {
          const deleteRequest = store.delete([id.row, id.col]);

          deleteRequest.onsuccess = () => {
            resolve(true);
          };

          deleteRequest.onerror = () => {
            reject(deleteRequest.error);
          };
        } else {
          resolve(false);
        }
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * `range` method returns an async iterable that allows iterating over a range of values.
   */
  range(from: Ref, to: Ref): AsyncIterable<[Ref, Cell]> {
    const transaction = this.db.transaction(GridStore, 'readonly');
    const store = transaction.objectStore(GridStore);
    const fromID = parseRef(from);
    const toID = parseRef(to);
    const keyRange = IDBKeyRange.bound(
      [fromID.row, fromID.col],
      [toID.row, toID.col],
    );
    const cursor = store.openCursor(keyRange);

    return {
      [Symbol.asyncIterator](): AsyncIterator<[Ref, Cell]> {
        return {
          next: () => {
            return new Promise((resolve, reject) => {
              cursor.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                  const [row, col] = cursor.key;
                  resolve({
                    value: [toRef({ row, col }), cursor.value],
                    done: false,
                  });
                  cursor.continue();
                } else {
                  resolve({ value: undefined, done: true });
                }
              };

              cursor.onerror = () => {
                reject(cursor.error);
              };
            });
          },
        };
      },
    };
  }

  /**
   * `Symbol.asyncIterator` method returns an async iterator.
   */
  [Symbol.asyncIterator](): AsyncIterator<[Ref, Cell]> {
    const transaction = this.db.transaction(GridStore, 'readonly');
    const store = transaction.objectStore(GridStore);
    const cursor = store.openCursor();

    return {
      next: (): Promise<IteratorResult<[Ref, Cell]>> => {
        return new Promise((resolve, reject) => {
          cursor.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result;
            if (cursor) {
              const [row, col] = cursor.key;
              resolve({
                value: [toRef({ row, col }), toCell(cursor.value)!],
                done: false,
              });
              cursor.continue();
            } else {
              resolve({ value: undefined, done: true });
            }
          };

          cursor.onerror = () => {
            reject(cursor.error);
          };
        });
      },
    };
  }
}
