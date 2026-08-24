/**
 * Persistence for a reporting session, split by size.
 *
 * Blobs go to IndexedDB, metadata to `localStorage`. That split is not
 * fastidiousness: a DPR-2 canvas `toDataURL()` is megabytes, so three captures
 * exhaust the 5-10 MB `localStorage` quota, and the failure arrives as an
 * exception in the middle of collecting — the worst possible moment, because
 * the reporter is mid-thought and the app is the thing they were describing.
 * Metadata stays in `localStorage` because it is small, synchronous, and
 * readable before an async database has opened.
 *
 * Two rules the rest of the design leans on:
 *
 *   - **An item outlives its capture.** When the budget is exceeded the oldest
 *     capture is evicted and the item keeps its sentence, which is the part
 *     that carries the report. The reverse — dropping the item to keep pixels —
 *     would discard the only thing a review lens can judge against.
 *   - **Eviction is never silent.** Every drop is reported to the caller so the
 *     panel can say what went, because a reporter confirming a bundle whose
 *     pixels have quietly vanished is worse than one told they are gone.
 *
 * Design: `docs/design/debug-report.md`.
 */

import type { Capture, DebugItem } from './types';

/** Persisted metadata schema. Independent of `BUNDLE_SCHEMA`: this never leaves the browser. */
export const STORE_SCHEMA = 1;

/**
 * Total capture budget, bytes.
 *
 * Captures are capped at 1280 px on the longest side and encoded as JPEG, which
 * measured at roughly 6 KB for a small region and 81 KB for a full 1280x721
 * screen, so this holds hundreds of realistic captures. It is a guard against
 * a pathological session, not a tight allowance — the point is that hitting it
 * degrades one capture instead of throwing.
 */
export const DEFAULT_BUDGET_BYTES = 32 * 1024 * 1024;

export type BlobRecord = {
  id: string;
  dataUrl: string;
  bytes: number;
  createdAt: number;
};

/** What the blob store knows without decoding anything. */
export type BlobStat = { id: string; bytes: number; createdAt: number };

/**
 * Blob persistence, behind an interface for two reasons: the eviction and
 * recovery logic is the part worth testing and it should not need a browser
 * database to test, and a profile that refuses IndexedDB (private mode) has to
 * degrade to memory rather than throw.
 */
export interface BlobBackend {
  put(record: BlobRecord): Promise<void>;
  get(id: string): Promise<string | undefined>;
  delete(ids: string[]): Promise<void>;
  stats(): Promise<BlobStat[]>;
}

/** Metadata persistence: one string, synchronously. */
export interface MetaBackend {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

export function memoryBlobs(): BlobBackend {
  const records = new Map<string, BlobRecord>();
  return {
    async put(record) {
      records.set(record.id, record);
    },
    async get(id) {
      return records.get(id)?.dataUrl;
    },
    async delete(ids) {
      for (const id of ids) records.delete(id);
    },
    async stats() {
      return Array.from(records.values(), ({ id, bytes, createdAt }) => ({
        id,
        bytes,
        createdAt,
      }));
    },
  };
}

export function memoryMeta(): MetaBackend {
  let value: string | null = null;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
    clear: () => {
      value = null;
    },
  };
}

const DEFAULT_META_KEY = 'wb.debug-report.session';

/**
 * `localStorage` metadata backend.
 *
 * Every access is guarded: a browser configured to block site data throws on
 * the property access itself, not just on `setItem`, and the debug overlay is
 * not worth taking the app down for. A failed write degrades to "this session
 * will not survive a reload", which the panel can say.
 */
export function localStorageMeta(key: string = DEFAULT_META_KEY): MetaBackend {
  return {
    read() {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // Quota or blocked storage. Reported by `save()`'s return value.
      }
    },
    clear() {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // Nothing to do; a stale entry is harmless — `load()` reconciles.
      }
    },
  };
}

const DEFAULT_DB_NAME = 'wafflebase-debug-report';
const DEFAULT_OBJECT_STORE = 'captures';

/** Promise wrapper for an IDB request. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB blob backend.
 *
 * Records carry `bytes` and `createdAt` alongside the data URL, so the
 * eviction ledger lives where the bytes live. A separate ledger would be a
 * second copy of the same facts, and the two would drift the first time a
 * write half-failed.
 */
export function indexedDbBlobs(
  dbName: string = DEFAULT_DB_NAME,
  storeName: string = DEFAULT_OBJECT_STORE,
): BlobBackend {
  let opening: Promise<IDBDatabase> | undefined;

  const open = (): Promise<IDBDatabase> => {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const idb = globalThis.indexedDB;
      if (!idb) {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) {
          req.result.createObjectStore(storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // A failed open must not be cached as a permanent verdict: the next call
    // gets to try again (a first open can fail on a transient version change).
    opening.catch(() => {
      opening = undefined;
    });
    return opening;
  };

  /**
   * Run one transaction.
   *
   * `issue` receives the object store and must create EVERY request it needs
   * synchronously, before returning. An IndexedDB transaction commits as soon as
   * its request queue drains, so a loop that awaits one request before issuing
   * the next hits `TransactionInactiveError` on the second — the classic version
   * of this bug, and invisible in a test that deletes a single key.
   *
   * A `readwrite` transaction is additionally awaited to COMPLETION, not merely
   * to request success: a request can succeed and its transaction still abort,
   * which would report a capture as stored that is not there.
   */
  const tx = async <T>(
    mode: IDBTransactionMode,
    issue: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> => {
    const db = await open();
    const transaction = db.transaction(storeName, mode);
    const settled = issue(transaction.objectStore(storeName));
    if (mode === 'readonly') return settled;
    const committed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const [result] = await Promise.all([settled, committed]);
    return result;
  };

  return {
    async put(record) {
      await tx('readwrite', (store) => request(store.put(record)));
    },
    async get(id) {
      const record = await tx('readonly', (store) =>
        request<BlobRecord | undefined>(store.get(id)),
      );
      return record?.dataUrl;
    },
    async delete(ids) {
      if (ids.length === 0) return;
      await tx('readwrite', (store) =>
        Promise.all(ids.map((id) => request(store.delete(id)))),
      );
    },
    async stats() {
      const records = await tx('readonly', (store) =>
        request<BlobRecord[]>(store.getAll()),
      );
      return records.map(({ id, bytes, createdAt }) => ({ id, bytes, createdAt }));
    },
  };
}

/**
 * The blob backend for this environment: IndexedDB where it exists, memory
 * where it does not.
 *
 * Memory is a real fallback, not a stub — a private-mode profile still gets to
 * report, it just loses captures on reload. Which of the two is in use is
 * returned so the panel can say so rather than quietly promising persistence.
 */
export function createBlobBackend(): { backend: BlobBackend; persistent: boolean } {
  if (globalThis.indexedDB) return { backend: indexedDbBlobs(), persistent: true };
  return { backend: memoryBlobs(), persistent: false };
}

type Persisted = {
  schema: number;
  sessionId: string;
  savedAt: number;
  items: DebugItem[];
};

export type SaveResult = { persisted: boolean };

export type PutCaptureInput = {
  dataUrl: string;
  w: number;
  h: number;
  layers: number;
  mime?: string;
};

export type PutCaptureResult =
  /** Stored. `evicted` names captures dropped to make room. */
  | { ok: true; capture: Capture; evicted: string[] }
  /** A single capture larger than the whole budget. Nothing was evicted for it. */
  | { ok: false; reason: 'too-large' | 'write-failed'; evicted: string[] };

export type LoadResult = {
  sessionId: string;
  items: DebugItem[];
  /**
   * Items whose capture reference no longer resolves, by item id. The item is
   * returned with `capture` stripped — it keeps its sentence — and the panel
   * says which pixels are gone.
   */
  droppedCaptures: string[];
};

export interface CaptureStore {
  /** Persist metadata. Returns whether the write survived. */
  save(sessionId: string, items: readonly DebugItem[]): SaveResult;
  /** Rehydrate, reconciling metadata against the blobs that actually exist. */
  load(): Promise<LoadResult | undefined>;
  putCapture(input: PutCaptureInput): Promise<PutCaptureResult>;
  getCapture(id: string): Promise<string | undefined>;
  /** Forget everything: after a bundle has been handed over. */
  clear(): Promise<void>;
  /** Delete blobs no persisted item references. */
  sweep(): Promise<string[]>;
}

export type StoreOptions = {
  blobs: BlobBackend;
  meta: MetaBackend;
  budgetBytes?: number;
  newId?: () => string;
  now?: () => number;
};

let captureCounter = 0;

function defaultCaptureId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `cap-${c.randomUUID()}`;
  captureCounter += 1;
  return `cap-${captureCounter}`;
}

/** Bytes a data URL costs once stored — its payload, not its display size. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const payload = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  if (/;base64/i.test(dataUrl.slice(0, comma === -1 ? 0 : comma))) {
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }
  return payload.length;
}

export function createStore(options: StoreOptions): CaptureStore {
  const { blobs, meta } = options;
  const budget = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const newId = options.newId ?? defaultCaptureId;
  const now = options.now ?? (() => Date.now());

  const readPersisted = (): Persisted | undefined => {
    const raw = meta.read();
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as Persisted).schema !== STORE_SCHEMA ||
        !Array.isArray((parsed as Persisted).items)
      ) {
        // A schema we do not recognise is not repaired and not kept: it would
        // otherwise sit there being re-read and re-rejected on every load.
        meta.clear();
        return undefined;
      }
      return parsed as Persisted;
    } catch {
      meta.clear();
      return undefined;
    }
  };

  return {
    save(sessionId, items) {
      const payload: Persisted = {
        schema: STORE_SCHEMA,
        sessionId,
        savedAt: now(),
        items: [...items],
      };
      const serialized = JSON.stringify(payload);
      meta.write(serialized);
      // Read back rather than trusting the write: `localStorageMeta` swallows
      // a quota failure to keep the app alive, so the only honest way to know
      // the session will survive a reload is to look.
      //
      // COMPARE THE VALUE, NOT ITS PRESENCE. A refused write leaves the
      // PREVIOUS payload in the key, so `read() !== null` was true whenever any
      // earlier save had succeeded — and quota is reached exactly as the item
      // list grows, which makes the stale case the common one. The reporter was
      // told the session survives a reload and got the older list back.
      return { persisted: meta.read() === serialized };
    },

    async load() {
      const persisted = readPersisted();
      if (!persisted) return undefined;

      let present: Set<string>;
      try {
        present = new Set((await blobs.stats()).map((s) => s.id));
      } catch {
        // The blob store is unreachable (blocked, or a failed upgrade). The
        // sentences are still worth having, so treat every capture as gone
        // rather than losing the whole session.
        present = new Set();
      }

      const droppedCaptures: string[] = [];
      const items = persisted.items.map((item) => {
        if (!item.capture || present.has(item.capture.id)) return item;
        droppedCaptures.push(item.id);
        const { capture: _dropped, ...rest } = item;
        return rest;
      });

      return { sessionId: persisted.sessionId, items, droppedCaptures };
    },

    async putCapture(input) {
      const bytes = dataUrlBytes(input.dataUrl);
      if (bytes > budget) {
        // Evicting the entire history for one oversized capture would trade
        // many reports for one, so this fails instead. The caller keeps the
        // item without pixels.
        return { ok: false, reason: 'too-large', evicted: [] };
      }

      const evicted: string[] = [];
      try {
        const stats = (await blobs.stats()).sort((a, b) => a.createdAt - b.createdAt);
        let total = stats.reduce((sum, s) => sum + s.bytes, 0);
        for (const stat of stats) {
          if (total + bytes <= budget) break;
          evicted.push(stat.id);
          total -= stat.bytes;
        }
        if (evicted.length > 0) await blobs.delete(evicted);

        const capture: Capture = {
          id: newId(),
          w: input.w,
          h: input.h,
          bytes,
          layers: input.layers,
          mime: input.mime ?? 'image/jpeg',
        };
        await blobs.put({
          id: capture.id,
          dataUrl: input.dataUrl,
          bytes,
          createdAt: now(),
        });
        return { ok: true, capture, evicted };
      } catch {
        // Anything the blob store refuses lands here. Eviction may already
        // have happened, so it is reported even on the failure path — those
        // captures are gone whether or not this one arrived.
        return { ok: false, reason: 'write-failed', evicted };
      }
    },

    async getCapture(id) {
      try {
        return await blobs.get(id);
      } catch {
        return undefined;
      }
    },

    async clear() {
      const persisted = readPersisted();
      meta.clear();
      const ids = (persisted?.items ?? [])
        .map((item) => item.capture?.id)
        .filter((id): id is string => Boolean(id));
      // Sweep as well: a capture taken and then evicted from the item list
      // still has a blob, and `clear()` is the one place it can be collected.
      try {
        const orphans = (await blobs.stats()).map((s) => s.id);
        const all = Array.from(new Set([...ids, ...orphans]));
        if (all.length > 0) await blobs.delete(all);
      } catch {
        // Best effort. A leftover blob costs space, not correctness — the next
        // `load()` reconciles against metadata regardless.
      }
    },

    async sweep() {
      const persisted = readPersisted();
      const referenced = new Set(
        (persisted?.items ?? [])
          .map((item) => item.capture?.id)
          .filter((id): id is string => Boolean(id)),
      );
      try {
        const orphans = (await blobs.stats())
          .map((s) => s.id)
          .filter((id) => !referenced.has(id));
        if (orphans.length > 0) await blobs.delete(orphans);
        return orphans;
      } catch {
        return [];
      }
    },
  };
}

/** The store a browser host gets: IndexedDB blobs, `localStorage` metadata. */
export function createBrowserStore(
  options: Omit<StoreOptions, 'blobs' | 'meta'> = {},
): { store: CaptureStore; persistent: boolean } {
  const { backend, persistent } = createBlobBackend();
  return {
    store: createStore({ ...options, blobs: backend, meta: localStorageMeta() }),
    persistent,
  };
}
