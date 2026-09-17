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
const ARCHIVES = "archives";

interface SnapshotRecord {
  docKey: string;
  /** gzip-compressed snapshot bytes. */
  snapshot: ArrayBuffer;
  /** gzip-compressed meta header, absent until a sync records one. */
  meta?: ArrayBuffer;
  /** Last write to this entry, in epoch ms. Drives stale collection. */
  updatedAt: number;
  /**
   * Who wrote it, so logout can drop one account's entries without touching
   * another's on the same device. Recorded explicitly rather than parsed back
   * out of the key: the key's shape is the SDK's to change, and a cleanup that
   * silently matches nothing is the worst way to find that out.
   */
  userId?: string;
}

interface ChangeRecord {
  docKey: string;
  clientSeq: number;
  /** gzip-compressed change bytes. */
  bytes: ArrayBuffer;
}

/**
 * A whole entry, kept after `remove` deleted it.
 *
 * The log is inlined rather than left in `changes`, so that writing the archive
 * and deleting the original is one `put` inside one transaction: a crash
 * between the two halves must not be able to leave the only copy deleted.
 */
interface ArchiveRecord {
  /** Auto-incremented, so two removals of one document both survive. */
  id?: number;
  docKey: string;
  snapshot: ArrayBuffer;
  meta?: ArrayBuffer;
  changes: Array<{ clientSeq: number; bytes: ArrayBuffer }>;
  archivedAt: number;
  userId?: string;
}

/** What an archived entry looks like from outside, without its bytes. */
export interface ArchiveSummary {
  id: number;
  docKey: string;
  archivedAt: number;
}

export interface WafflebaseDocStoreOptions {
  /** Overridable so tests get an isolated database per case. */
  dbName?: string;
  /** Stamped on entries this store writes, for per-user cleanup. */
  userId?: string;
  /**
   * The clock, injected so tests can age an entry without
   * `vi.useFakeTimers()` — which stops the timers fake-indexeddb schedules its
   * own callbacks on, hanging every store call instead of advancing time.
   */
  now?: () => number;
}

/** How long an untouched entry survives before collection claims it. */
export const DefaultMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether a failure is the origin running out of room, as opposed to any other
 * thing that can go wrong with a write. Only this answer may delete a user's
 * documents, so it is deliberately narrow: an unrelated bug that evicted would
 * be a self-inflicted data loss.
 */
function isQuotaExceeded(err: unknown): boolean {
  return err instanceof DOMException && err.name === "QuotaExceededError";
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
  private readonly userId?: string;
  private readonly now: () => number;
  private opening?: Promise<IDBDatabase>;

  constructor(options: WafflebaseDocStoreOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.userId = options.userId;
    this.now = options.now ?? (() => Date.now());
  }

  /** The database this store reads and writes; a second store can share it. */
  public get databaseName(): string {
    return this.dbName;
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
          if (!db.objectStoreNames.contains(ARCHIVES)) {
            // Auto-incremented rather than keyed by docKey: two documents can
            // fail to reconcile in one session, and the same document can fail
            // twice, so a removal must never replace an earlier one.
            db.createObjectStore(ARCHIVES, {
              keyPath: "id",
              autoIncrement: true,
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
    return this.withQuotaRetry(async () => {
      const db = await this.open();
      const tx = db.transaction([SNAPSHOTS, CHANGES], "readwrite");
      const record: SnapshotRecord = {
        docKey,
        snapshot,
        updatedAt: this.now(),
        userId: this.userId,
      };
      tx.objectStore(SNAPSHOTS).put(record);
      tx.objectStore(CHANGES).delete(WafflebaseDocStore.rangeFor(docKey));
      return WafflebaseDocStore.completed(tx);
    });
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
    return this.withQuotaRetry(async () => {
      const db = await this.open();
      const tx = db.transaction([SNAPSHOTS, CHANGES], "readwrite");
      const existing = await requested<SnapshotRecord | undefined>(
        tx.objectStore(SNAPSHOTS).get(docKey),
      );
      if (!existing) {
        return WafflebaseDocStore.completed(tx);
      }

      const record: ChangeRecord = {
        docKey,
        clientSeq: change.clientSeq,
        bytes,
      };
      tx.objectStore(CHANGES).put(record);
      // An append touches the entry. Without this, a document edited daily for
      // a month is collected on its anniversary with its unsent work still in
      // the log, because only `saveSnapshot` ever moved the clock.
      existing.updatedAt = this.now();
      tx.objectStore(SNAPSHOTS).put(existing);
      return WafflebaseDocStore.completed(tx);
    });
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
    return this.withQuotaRetry(async () => {
      const db = await this.open();
      const tx = db.transaction(SNAPSHOTS, "readwrite");
      const existing = await requested<SnapshotRecord | undefined>(
        tx.objectStore(SNAPSHOTS).get(docKey),
      );
      // A header with no snapshot under it describes nothing, so this is a
      // no-op rather than a row that `load` would have to learn to ignore.
      if (existing) {
        existing.meta = meta;
        existing.updatedAt = this.now();
        tx.objectStore(SNAPSHOTS).put(existing);
      }
      return WafflebaseDocStore.completed(tx);
    });
  }

  /**
   * `remove` clears the snapshot, the meta and the log — **archiving them
   * first**. Missing keys are fine and archive nothing.
   *
   * The SDK calls this on exactly the paths where it has decided local work
   * cannot be reconciled: a re-anchor after server-side compaction, a document
   * purged upstream, an actor mismatch. Deleting outright there is what loses
   * the user's unsent edits, so the bytes are kept and returned later as an
   * offline copy. The archive is written in the same transaction as the delete,
   * so no crash can land between them and leave the only copy gone.
   */
  public async remove(docKey: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([SNAPSHOTS, CHANGES, ARCHIVES], "readwrite");
    const snapshots = tx.objectStore(SNAPSHOTS);
    const changes = tx.objectStore(CHANGES);

    const [record, changeRows] = await Promise.all([
      requested<SnapshotRecord | undefined>(snapshots.get(docKey)),
      requested<Array<ChangeRecord>>(
        changes.getAll(WafflebaseDocStore.rangeFor(docKey)),
      ),
    ]);

    if (record) {
      const archive: ArchiveRecord = {
        docKey,
        snapshot: record.snapshot,
        meta: record.meta,
        changes: changeRows
          .sort((a, b) => a.clientSeq - b.clientSeq)
          .map((row) => ({ clientSeq: row.clientSeq, bytes: row.bytes })),
        archivedAt: this.now(),
        userId: record.userId,
      };
      tx.objectStore(ARCHIVES).put(archive);
      snapshots.delete(docKey);
      changes.delete(WafflebaseDocStore.rangeFor(docKey));
    }

    return WafflebaseDocStore.completed(tx);
  }

  /**
   * `listArchives` describes what `remove` kept, newest last. Bytes are left
   * out: the caller picks one and asks for it.
   */
  public async listArchives(): Promise<Array<ArchiveSummary>> {
    const db = await this.open();
    const tx = db.transaction(ARCHIVES, "readonly");
    const rows = await requested<Array<ArchiveRecord>>(
      tx.objectStore(ARCHIVES).getAll(),
    );
    return rows.map((row) => ({
      id: row.id!,
      docKey: row.docKey,
      archivedAt: row.archivedAt,
    }));
  }

  /** `loadArchive` returns an archived entry's bytes, decompressed. */
  public async loadArchive(id: number): Promise<StoredDoc | undefined> {
    const db = await this.open();
    const tx = db.transaction(ARCHIVES, "readonly");
    const row = await requested<ArchiveRecord | undefined>(
      tx.objectStore(ARCHIVES).get(id),
    );
    if (!row) {
      return undefined;
    }

    return {
      snapshot: await inflate(row.snapshot),
      meta: row.meta ? await inflate(row.meta) : undefined,
      changes: await Promise.all(
        row.changes.map(async (change) => ({
          clientSeq: change.clientSeq,
          bytes: await inflate(change.bytes),
        })),
      ),
    };
  }

  /** Drops archived entries by id. */
  private async dropArchives(ids: Array<number>): Promise<void> {
    if (!ids.length) {
      return;
    }
    const db = await this.open();
    const tx = db.transaction(ARCHIVES, "readwrite");
    const store = tx.objectStore(ARCHIVES);
    for (const id of ids) {
      store.delete(id);
    }
    return WafflebaseDocStore.completed(tx);
  }

  /** Every archive record, for the cleanup passes that scan rather than seek. */
  private async allArchives(): Promise<Array<ArchiveRecord>> {
    const db = await this.open();
    const tx = db.transaction(ARCHIVES, "readonly");
    return requested<Array<ArchiveRecord>>(tx.objectStore(ARCHIVES).getAll());
  }

  /**
   * `purge` deletes an entry outright, for the app's own cleanup — the document
   * was deleted, or workspace access was lost, and the content must not outlive
   * the authority to read it.
   *
   * Distinct from {@link remove}, which the SDK calls on the paths where local
   * work could not be reconciled and therefore archives first. Nothing about
   * losing access says the user should get an offline copy of it.
   */
  public async purge(docKey: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([SNAPSHOTS, CHANGES], "readwrite");
    tx.objectStore(SNAPSHOTS).delete(docKey);
    tx.objectStore(CHANGES).delete(WafflebaseDocStore.rangeFor(docKey));
    return WafflebaseDocStore.completed(tx);
  }

  /**
   * `dropAllForUser` drops every entry that user wrote — logout, on a machine
   * whose disk should not keep their documents.
   *
   * Entries belonging to *another* account on the same device survive, which is
   * the half that makes it correct: signing out of one account must not destroy
   * another's unsent work.
   */
  public async dropAllForUser(userId: string): Promise<number> {
    const keys = (await this.allRecords())
      .filter((record) => record.userId === userId)
      .map((record) => record.docKey);
    for (const docKey of keys) {
      await this.purge(docKey);
    }

    // Archives hold document content too, so the erase logout promises has to
    // reach them — otherwise signing out leaves the content on a shared machine
    // in the one place the user cannot see.
    await this.dropArchives(
      (await this.allArchives())
        .filter((row) => row.userId === userId)
        .map((row) => row.id!),
    );
    return keys.length;
  }

  /**
   * `collectStale` drops entries untouched for longer than `maxAgeMs`,
   * returning how many went. Nothing else collects: the SDK never calls
   * `remove` on a normal detach, and correctly so, since not removing is what
   * makes resume possible.
   */
  public async collectStale(
    maxAgeMs: number = DefaultMaxAgeMs,
  ): Promise<number> {
    const cutoff = this.now() - maxAgeMs;
    const keys = (await this.allRecords())
      .filter((record) => record.updatedAt < cutoff)
      .map((record) => record.docKey);
    for (const docKey of keys) {
      await this.purge(docKey);
    }

    // On the same schedule: an archive store nothing ever collects is a quota
    // leak that looks like a feature.
    const staleArchives = (await this.allArchives()).filter(
      (row) => row.archivedAt < cutoff,
    );
    await this.dropArchives(staleArchives.map((row) => row.id!));
    return keys.length + staleArchives.length;
  }

  /**
   * `changeCount` reports how many log entries a document has. An orphaned log
   * is invisible to `load` and still occupies quota, so cleanup that leaves one
   * behind looks complete and is not — this is how a test can tell.
   */
  public async changeCount(docKey: string): Promise<number> {
    const db = await this.open();
    const tx = db.transaction(CHANGES, "readonly");
    return requested<number>(
      tx.objectStore(CHANGES).count(WafflebaseDocStore.rangeFor(docKey)),
    );
  }

  /** Every snapshot record, for the cleanup passes that scan rather than seek. */
  private async allRecords(): Promise<Array<SnapshotRecord>> {
    const db = await this.open();
    const tx = db.transaction(SNAPSHOTS, "readonly");
    return requested<Array<SnapshotRecord>>(tx.objectStore(SNAPSHOTS).getAll());
  }

  /**
   * Runs a write, and on a full origin frees the oldest entry and tries once
   * more.
   *
   * Once. A store that never accepts a write must report itself undurable —
   * which is what a rejection here becomes — rather than loop until it has
   * deleted every document the user had. And only a genuine quota failure
   * evicts: deleting documents in response to an unrelated bug would be a
   * self-inflicted data loss.
   */
  private async withQuotaRetry<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (!isQuotaExceeded(err)) {
        throw err;
      }
      if (!(await this.evictOldest())) {
        // Nothing left to free, so retrying would fail the same way.
        throw err;
      }
      return op();
    }
  }

  /** Drops the least recently touched entry. False when there was none. */
  private async evictOldest(): Promise<boolean> {
    const records = await this.allRecords();
    if (!records.length) {
      return false;
    }
    const oldest = records.reduce((a, b) =>
      a.updatedAt <= b.updatedAt ? a : b,
    );
    await this.purge(oldest.docKey);
    return true;
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
