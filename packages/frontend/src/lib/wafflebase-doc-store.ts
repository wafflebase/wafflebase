import type { DocStore, StoredChange, StoredDoc } from "@yorkie-js/sdk";

/**
 * The IndexedDB `DocStore` the offline feature writes through.
 *
 * Design: `docs/design/offline-local-persistence.md` § Storage.
 *
 * Two things shape the implementation more than anything else:
 *
 * **It compresses.** CRDT snapshots are extremely repetitive — every member
 * carries a 24-hex actor id — and gzip returns 11-18x on them, taking fifty
 * stored documents from ~139 MB to ~12 MB. `CompressionStream` is a browser
 * built-in, so this costs no dependency, and the SDK stays out of it because
 * `DocStore` takes opaque bytes by design.
 *
 * **An IndexedDB transaction does not survive an `await` on anything else.** It
 * auto-commits once the microtask queue yields to a task it did not schedule,
 * and compression is exactly such an await. So every method here compresses (or
 * decompresses) *outside* the transaction and does only synchronous IDB work
 * inside it. Getting this backwards does not fail loudly — it fails as
 * `TransactionInactiveError` under load and nowhere in a quiet test.
 */

/** The store's schema version. Bumping it needs an `onupgradeneeded` arm. */
const DB_VERSION = 1;

const DEFAULT_DB_NAME = "wafflebase-offline";

const SNAPSHOTS = "snapshots";
const CHANGES = "changes";

interface SnapshotRecord {
  docKey: string;
  /** gzip-compressed snapshot bytes. */
  snapshot: ArrayBuffer;
  /** gzip-compressed meta header, absent until a sync records one. */
  meta?: ArrayBuffer;
  /** Last write to this entry, in epoch ms. Drives stale collection. */
  updatedAt: number;
}

interface ChangeRecord {
  docKey: string;
  clientSeq: number;
  /** gzip-compressed change bytes. */
  bytes: ArrayBuffer;
}

export interface WafflebaseDocStoreOptions {
  /** Overridable so tests get an isolated database per case. */
  dbName?: string;
}

/**
 * Runs `bytes` through a compression or decompression stream.
 *
 * Deliberately built on `ReadableStream` and a manual read loop rather than the
 * shorter `new Response(new Blob([bytes]).stream().pipeThrough(...))`: jsdom's
 * `Blob` has no `.stream()`, so that spelling works in every browser and in no
 * test. This one needs only what `CompressionStream` itself already implies.
 */
async function through(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  const reader = source.pipeThrough(stream).getReader();
  const chunks: Array<Uint8Array> = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }

  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** gzip, for storage. */
function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream("gzip"));
}

/** gunzip, on the way back out. */
function inflate(buffer: ArrayBuffer): Promise<Uint8Array> {
  return through(new Uint8Array(buffer), new DecompressionStream("gzip"));
}

/** A `Uint8Array`'s bytes as their own `ArrayBuffer`, never a view into a pool. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** Resolves with an IDB request's result, or rejects with its error. */
function requested<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * `WafflebaseDocStore` implements the SDK's `DocStore` over IndexedDB.
 *
 * Keys are whatever the SDK supplies — `apiKey/clientKey/docKey`, already
 * scoped by identity, so a shared device cannot hand one account another's
 * envelope.
 */
export class WafflebaseDocStore implements DocStore {
  private readonly dbName: string;
  private opening?: Promise<IDBDatabase>;

  constructor(options: WafflebaseDocStoreOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
  }

  /**
   * Opens the database, creating the object stores on first use. The promise is
   * memoized: concurrent callers share one open, which is also what keeps the
   * `onupgradeneeded` from running twice.
   */
  private open(): Promise<IDBDatabase> {
    if (!this.opening) {
      this.opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(this.dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          // Version 1 creates; there is nothing in the wild to migrate. No
          // wafflebase build has ever passed `ClientOptions.store`, so no
          // browser holds an older layout. Versioning ships from the first
          // release anyway, so that a deploy revert finds nothing where it
          // looks rather than something it half-understands.
          if (!db.objectStoreNames.contains(SNAPSHOTS)) {
            db.createObjectStore(SNAPSHOTS, { keyPath: "docKey" });
          }
          if (!db.objectStoreNames.contains(CHANGES)) {
            // The compound key is what makes `appendChange` an upsert and the
            // log naturally ordered: a `put` replaces the same clientSeq, and a
            // bounded range over one docKey comes back in clientSeq order.
            db.createObjectStore(CHANGES, {
              keyPath: ["docKey", "clientSeq"],
            });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.opening;
  }

  /** Every change row for one document, as a key range over the compound key. */
  private static rangeFor(docKey: string): IDBKeyRange {
    return IDBKeyRange.bound([docKey, -Infinity], [docKey, Infinity]);
  }

  /**
   * `load` returns the persisted triple, or `undefined` when nothing is stored
   * for the key.
   */
  public async load(docKey: string): Promise<StoredDoc | undefined> {
    const db = await this.open();
    const tx = db.transaction([SNAPSHOTS, CHANGES], "readonly");
    const [record, changeRows] = await Promise.all([
      requested<SnapshotRecord | undefined>(
        tx.objectStore(SNAPSHOTS).get(docKey),
      ),
      requested<Array<ChangeRecord>>(
        tx.objectStore(CHANGES).getAll(WafflebaseDocStore.rangeFor(docKey)),
      ),
    ]);

    if (!record) {
      return undefined;
    }

    // Decompression happens after the transaction is done with, never inside
    // it. Sorting is belt-and-braces over the key order the range already
    // guarantees; `load`'s caller replays these in sequence.
    const changes: Array<StoredChange> = await Promise.all(
      changeRows
        .sort((a, b) => a.clientSeq - b.clientSeq)
        .map(async (row) => ({
          clientSeq: row.clientSeq,
          bytes: await inflate(row.bytes),
        })),
    );

    return {
      snapshot: await inflate(record.snapshot),
      meta: record.meta ? await inflate(record.meta) : undefined,
      changes,
    };
  }

  /**
   * `saveSnapshot` replaces the snapshot and **drops the log and the meta with
   * it**. This is compaction: the new snapshot already contains those changes
   * and embeds a newer header than meta holds, so keeping either would replay
   * operations twice or regress the client's clocks.
   */
  public async saveSnapshot(docKey: string, bytes: Uint8Array): Promise<void> {
    const snapshot = toBuffer(await deflate(bytes));
    const db = await this.open();
    const tx = db.transaction([SNAPSHOTS, CHANGES], "readwrite");
    const record: SnapshotRecord = {
      docKey,
      snapshot,
      updatedAt: Date.now(),
    };
    tx.objectStore(SNAPSHOTS).put(record);
    tx.objectStore(CHANGES).delete(WafflebaseDocStore.rangeFor(docKey));
    return WafflebaseDocStore.completed(tx);
  }

  /**
   * `appendChange` records one change, upserting by `clientSeq` so a retried
   * write never becomes a second entry — replaying a duplicate would apply the
   * operation twice.
   *
   * An append for a key with no snapshot is **ignored**, not an error: there is
   * nothing for it to be a delta against, a row written anyway is an orphan
   * `load` cannot see, and the SDK repairs the missing base on the next edit.
   */
  public async appendChange(
    docKey: string,
    change: StoredChange,
  ): Promise<void> {
    const bytes = toBuffer(await deflate(change.bytes));
    const db = await this.open();
    const tx = db.transaction([SNAPSHOTS, CHANGES], "readwrite");
    const existing = await requested<SnapshotRecord | undefined>(
      tx.objectStore(SNAPSHOTS).get(docKey),
    );
    if (!existing) {
      return WafflebaseDocStore.completed(tx);
    }

    const record: ChangeRecord = { docKey, clientSeq: change.clientSeq, bytes };
    tx.objectStore(CHANGES).put(record);
    existing.updatedAt = Date.now();
    tx.objectStore(SNAPSHOTS).put(existing);
    return WafflebaseDocStore.completed(tx);
  }

  /**
   * `saveMeta` records the header a sync advanced, and **never trims the log**.
   *
   * The log does two jobs: it holds un-pushed changes, and it is the delta
   * between the snapshot and the document's current content. A push-ack does
   * not bring the snapshot forward, so trimming acked entries here serves the
   * first job and destroys the second. Only compaction trims.
   */
  public async saveMeta(docKey: string, bytes: Uint8Array): Promise<void> {
    const meta = toBuffer(await deflate(bytes));
    const db = await this.open();
    const tx = db.transaction(SNAPSHOTS, "readwrite");
    const existing = await requested<SnapshotRecord | undefined>(
      tx.objectStore(SNAPSHOTS).get(docKey),
    );
    // A header with no snapshot under it describes nothing, so this is a no-op
    // rather than a row that `load` would have to learn to ignore.
    if (existing) {
      existing.meta = meta;
      existing.updatedAt = Date.now();
      tx.objectStore(SNAPSHOTS).put(existing);
    }
    return WafflebaseDocStore.completed(tx);
  }

  /** `remove` clears the snapshot, the meta and the log. Missing keys are fine. */
  public async remove(docKey: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([SNAPSHOTS, CHANGES], "readwrite");
    tx.objectStore(SNAPSHOTS).delete(docKey);
    tx.objectStore(CHANGES).delete(WafflebaseDocStore.rangeFor(docKey));
    return WafflebaseDocStore.completed(tx);
  }

  /**
   * `storedSnapshotSize` reports the compressed size actually occupied by a
   * document's snapshot, which is what quota accounting and eviction reason
   * about — the uncompressed size says nothing about the pressure on the
   * origin's budget.
   */
  public async storedSnapshotSize(docKey: string): Promise<number | undefined> {
    const db = await this.open();
    const tx = db.transaction(SNAPSHOTS, "readonly");
    const record = await requested<SnapshotRecord | undefined>(
      tx.objectStore(SNAPSHOTS).get(docKey),
    );
    return record?.snapshot.byteLength;
  }

  /** Resolves when the transaction commits, rejecting if it aborts or errors. */
  private static completed(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  }
}
