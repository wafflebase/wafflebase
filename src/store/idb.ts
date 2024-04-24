import { Ref, Cell } from '../sheet/types';

const DBName = 'wafflebase';
const DBVersion = 1;

/**
 * `createIDBStore` function creates an instance of `IDBStore` class.
 */
export async function createIDBStore(): Promise<IDBStore> {
  const db = await openIDB();
  return new IDBStore(db);
}

/**
 * `openIDB` function opens the IndexedDB database.
 */
function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DBName, DBVersion);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DBName)) {
        db.createObjectStore(DBName);
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
   * Retrieves a value from the database by key.
   */
  public async get(key: Ref): Promise<Cell> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([DBName], 'readonly');
      const objectStore = transaction.objectStore(DBName);
      const request = objectStore.get(key);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Stores a value in the database with the specified key.
   * @param key The key to store the value under.
   * @param value The value to store.
   */
  public async set(key: Ref, value: Cell): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([DBName], 'readwrite');
      const objectStore = transaction.objectStore(DBName);
      const request = objectStore.put(value, key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * `has` method checks if the database contains a value with the specified key.
   */
  public async has(key: Ref): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([DBName], 'readonly');
      const objectStore = transaction.objectStore(DBName);
      const request = objectStore.getKey(key);

      request.onsuccess = () => {
        resolve(request.result !== undefined);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }
}
