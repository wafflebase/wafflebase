import indexeddb from 'fake-indexeddb';
import { afterEach } from 'vitest';

if (!globalThis.indexedDB) {
  globalThis.indexedDB = indexeddb;
}

globalThis.resetBeforeEachTest = true;
