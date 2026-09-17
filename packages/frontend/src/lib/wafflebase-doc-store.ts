import type { DocStore, StoredChange, StoredDoc } from "@yorkie-js/sdk";

/**
 * The IndexedDB `DocStore` the offline feature writes through.
 *
 * Design: `docs/design/offline-local-persistence.md` § Storage.
 *
 * Three things shape the implementation more than anything else:
 *
 * **It compresses.** CRDT snapshots are extremely repetitive — every member
 * carries a 24-hex actor id — and gzip returns 11-18x on them, taking fifty
 * stored documents from ~139 MB to ~12 MB. `CompressionStream` is a browser
 * built-in, so this costs no dependency, and the SDK stays out of it because
 * `DocStore` takes opaque bytes by design.
 *
 * **The snapshot and its mutable header live in separate object stores.** Every
 * append and every sync has to move `updatedAt`, and the snapshot is the one
 * field large enough to matter: keeping them in one record made a single
 * appended change rewrite ~300 KB, which is the O(document) per-edit cost this
 * whole feature exists to remove. The header row is a few dozen bytes.
 *
 * **An IndexedDB transaction does not survive an `await` on anything else.** It
 * auto-commits once the microtask queue yields to a task it did not schedule,
 * and compression is exactly such an await. So every method here compresses (or
 * decompresses) *outside* the transaction and does only IDB work inside it —
 * awaiting an IDB request is fine, because a pending request keeps the
 * transaction alive; awaiting anything else is not. Getting this backwards does
 * not fail loudly. It fails as `TransactionInactiveError` under load and
 * nowhere in a quiet test.
 */

/** The store's schema version. Bumping it needs an `onupgradeneeded` arm. */
const DB_VERSION = 1;

const DEFAULT_DB_NAME = "wafflebase-offline";

const SNAPSHOTS = "snapshots";
const HEADERS = "headers";
const CHANGES = "changes";
const ARCHIVES = "archives";

const BY_UPDATED_AT = "updatedAt";
const BY_ARCHIVED_AT = "archivedAt";
const BY_USER = "userId";

/** The bytes, written only by `saveSnapshot`. Large, and rarely touched. */
interface SnapshotRecord {
  docKey: string;
  /** gzip-compressed snapshot bytes. */
  snapshot: ArrayBuffer;
}

/**
 * The mutable part of an entry: small, and written on every append and sync.
 * Separate from {@link SnapshotRecord} so the hot path never rewrites bytes.
 */
interface HeaderRecord {
  docKey: string;
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
  userId: string;
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
  userId: string;
}

/** What an archived entry looks like from outside, without its bytes. */
export interface ArchiveSummary {
  id: number;
  docKey: string;
  archivedAt: number;
}

export interface WafflebaseDocStoreOptions {
  /**
   * Whose entries these are. Required, so that it is not possible to write an
   * entry logout cannot find: an unattributed row would sit on a shared
   * machine for thirty days after the user signed out.
   */
  userId: string;
  /** Overridable so tests get an isolated database per case. */
  dbName?: string;
  /**
   * The clock, injected so tests can age an entry without
   * `vi.useFakeTimers()` — which stops the timers fake-indexeddb schedules its
   * own callbacks on, hanging every store call instead of advancing time.
   */
  now?: () => number;
  /**
   * Whether a document is open **anywhere right now** — another tab, or
   * another store instance in this one.
   *
   * Without it, this store knows only what it has touched itself, and that is
   * per-instance memory while eviction reads a shared database. Two tabs on
   * different documents are both durable over one database, so tab B's
   * eviction happily deletes tab A's open document; A's appends then find no
   * header, are treated as the contract's silent "no base" success, and every
   * edit after that goes nowhere while the chip reports the document saved.
   * The same hole lets the periodic sweep collect a document another tab has
   * open, with no quota failure needed at all.
   *
   * The app answers this from the election it already holds — the
   * `wb-durable:` Web Lock, which `navigator.locks.query()` reports across
   * tabs. Left unset, the store falls back to its own in-memory set, which is
   * correct for a single instance and is what the tests use.
   */
  isOpenElsewhere?: (docKey: string) => Promise<boolean> | boolean;
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

  // Cast because the DOM types describe these two as different pairs — the
  // writable side takes `BufferSource`, the readable yields `Uint8Array` — so
  // the union does not satisfy `pipeThrough` even though both transform bytes
  // to bytes, which is all this function needs.
  const transformed = source.pipeThrough(
    stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  const reader = transformed.getReader();
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

/**
 * Decompresses a log one entry at a time.
 *
 * Sequential on purpose: the SDK replays up to a thousand entries, and a
 * `Promise.all` over that opens a thousand concurrent `DecompressionStream`s at
 * attach — the moment the editor is least able to afford it. Each entry is a
 * few hundred bytes, so the serial cost is noise.
 */
async function inflateLog(
  rows: Array<{ clientSeq: number; bytes: ArrayBuffer }>,
): Promise<Array<StoredChange>> {
  const changes: Array<StoredChange> = [];
  for (const row of rows) {
    changes.push({ clientSeq: row.clientSeq, bytes: await inflate(row.bytes) });
  }
  return changes;
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
  private readonly userId: string;
  private readonly now: () => number;
  private opening?: Promise<IDBDatabase>;
  private db?: IDBDatabase;

  /**
   * Keys this store has written since it was constructed — in practice, the
   * documents this session has open. Eviction and collection skip them: freeing
   * space by deleting a document the SDK is actively persisting makes every
   * later append for it vanish, which is the failure this store exists to
   * prevent.
   */
  private readonly touched = new Set<string>();

  /**
   * Keys eviction took. An append for one of these must fail rather than be
   * ignored — see {@link appendChange}.
   */
  private readonly evicted = new Set<string>();

  private readonly isOpenElsewhere?: (
    docKey: string,
  ) => Promise<boolean> | boolean;

  constructor(options: WafflebaseDocStoreOptions) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.userId = options.userId;
    this.now = options.now ?? (() => Date.now());
    this.isOpenElsewhere = options.isOpenElsewhere;
  }

  /**
   * Whether deleting `docKey` right now could pull it out from under a live
   * client — this instance's, or one in another tab.
   */
  private async isLive(docKey: string): Promise<boolean> {
    if (this.touched.has(docKey)) {
      return true;
    }
    return (await this.isOpenElsewhere?.(docKey)) ?? false;
  }

  /** The database this store reads and writes; a second store can share it. */
  public get databaseName(): string {
    return this.dbName;
  }

  /**
   * Opens the database, creating the object stores on first use.
   *
   * The promise is memoized so concurrent callers share one open — but the memo
   * is **cleared on failure**. Caching a rejection would mean one transient
   * open error (a storage permission the user later grants, a locked profile)
   * bricks the store for the rest of the session, with every later call
   * rejecting with the same stale error.
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
          if (!db.objectStoreNames.contains(HEADERS)) {
            const headers = db.createObjectStore(HEADERS, {
              keyPath: "docKey",
            });
            // Eviction and collection walk these indexes, so neither has to
            // materialize a single compressed snapshot to decide what goes —
            // and eviction runs exactly when the origin is out of room.
            headers.createIndex(BY_UPDATED_AT, "updatedAt");
            headers.createIndex(BY_USER, "userId");
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
            const archives = db.createObjectStore(ARCHIVES, {
              keyPath: "id",
              autoIncrement: true,
            });
            archives.createIndex(BY_ARCHIVED_AT, "archivedAt");
            archives.createIndex(BY_USER, "userId");
          }
        };
        // Without this a blocked open never settles, and because the promise is
        // memoized that wedges every later call too, not just this one.
        request.onblocked = () =>
          reject(
            new DOMException(
              `opening "${this.dbName}" is blocked by another connection`,
              "InvalidStateError",
            ),
          );
        request.onsuccess = () => {
          const db = request.result;
          // Another tab upgrading or deleting the database needs this
          // connection to step aside, or its request blocks indefinitely —
          // including the `deleteDatabase` that backs "turning this off
          // deletes them".
          db.onversionchange = () => {
            db.close();
            this.db = undefined;
            this.opening = undefined;
          };
          this.db = db;
          resolve(db);
        };
        request.onerror = () => reject(request.error);
      }).catch((err) => {
        this.opening = undefined;
        throw err;
      });
    }
    return this.opening;
  }

  /** Closes the connection, so a `deleteDatabase` elsewhere is not blocked. */
  public close(): void {
    this.db?.close();
    this.db = undefined;
    this.opening = undefined;
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
    const tx = db.transaction([SNAPSHOTS, HEADERS, CHANGES], "readonly");
    const [record, header, changeRows] = await Promise.all([
      requested<SnapshotRecord | undefined>(
        tx.objectStore(SNAPSHOTS).get(docKey),
      ),
      requested<HeaderRecord | undefined>(tx.objectStore(HEADERS).get(docKey)),
      requested<Array<ChangeRecord>>(
        tx.objectStore(CHANGES).getAll(WafflebaseDocStore.rangeFor(docKey)),
      ),
    ]);

    if (!record) {
      return undefined;
    }

    // Reading an entry is what "this session has this document open" means —
    // the SDK loads on attach and writes only when the user edits. Without
    // this, a document opened and not yet typed into keeps its old timestamp,
    // which makes it the *first* eviction candidate: the one case where
    // freeing space silently kills a live document.
    this.touched.add(docKey);
    // Recorded in the database too, not only here. `touched` is this
    // instance's memory, and the ordering eviction reads is shared — so an
    // attach that never writes would stay the oldest row in every *other*
    // tab's view. Best effort: failing to note the read must not fail the read.
    void this.touch(docKey);

    // Decompression happens after the transaction is done with, never inside
    // it. Sorting is belt-and-braces over the key order the range already
    // guarantees; `load`'s caller replays these in sequence.
    return {
      snapshot: await inflate(record.snapshot),
      meta: header?.meta ? await inflate(header.meta) : undefined,
      changes: await inflateLog(
        changeRows.sort((a, b) => a.clientSeq - b.clientSeq),
      ),
    };
  }

  /**
   * Moves an entry's `updatedAt` to now without touching anything else, so that
   * having it open is visible to instances that cannot see {@link touched}.
   */
  private async touch(docKey: string): Promise<void> {
    try {
      const db = await this.open();
      const tx = db.transaction(HEADERS, "readwrite");
      await WafflebaseDocStore.atomically(tx, async () => {
        const headers = tx.objectStore(HEADERS);
        const header = await requested<HeaderRecord | undefined>(
          headers.get(docKey),
        );
        if (header) {
          header.updatedAt = this.now();
          headers.put(header);
        }
      });
    } catch {
      // Advisory. A document that could not be marked as read is still read.
    }
  }

  /**
   * `saveSnapshot` replaces the snapshot and **drops the log and the meta with
   * it**. This is compaction: the new snapshot already contains those changes
   * and embeds a newer header than meta holds, so keeping either would replay
   * operations twice or regress the client's clocks.
   */
  public async saveSnapshot(docKey: string, bytes: Uint8Array): Promise<void> {
    const snapshot = toBuffer(await deflate(bytes));
    return this.withQuotaRetry(docKey, async () => {
      const db = await this.open();
      const tx = db.transaction([SNAPSHOTS, HEADERS, CHANGES], "readwrite");
      await WafflebaseDocStore.atomically(tx, () => {
        const snapshotRecord: SnapshotRecord = { docKey, snapshot };
        const headerRecord: HeaderRecord = {
          docKey,
          updatedAt: this.now(),
          userId: this.userId,
        };
        tx.objectStore(SNAPSHOTS).put(snapshotRecord);
        tx.objectStore(HEADERS).put(headerRecord);
        tx.objectStore(CHANGES).delete(WafflebaseDocStore.rangeFor(docKey));
      });
      // A fresh base is exactly the repair an evicted key needed.
      this.evicted.delete(docKey);
      this.touched.add(docKey);
    });
  }

  /**
   * `appendChange` records one change, upserting by `clientSeq` so a retried
   * write never becomes a second entry — replaying a duplicate would apply the
   * operation twice.
   *
   * An append for a key that was never stored is **ignored**, not an error:
   * there is nothing for it to be a delta against, a row written anyway is an
   * orphan `load` cannot see, and the SDK repairs the missing base on the next
   * edit. That is the SDK's own contract.
   *
   * An append for a key **this store evicted** is a different thing, and it
   * throws. The SDK cannot repair what it does not know it lost: it believes
   * the base is there, and silence would let it keep handing us edits that go
   * nowhere while the sync chip reports the document durable. A rejection is
   * what makes it poison the log and write a fresh snapshot.
   */
  public async appendChange(
    docKey: string,
    change: StoredChange,
  ): Promise<void> {
    const bytes = toBuffer(await deflate(change.bytes));
    return this.withQuotaRetry(docKey, async () => {
      const db = await this.open();
      const tx = db.transaction([HEADERS, CHANGES], "readwrite");
      const present = await WafflebaseDocStore.atomically(tx, async () => {
        const headers = tx.objectStore(HEADERS);
        const header = await requested<HeaderRecord | undefined>(
          headers.get(docKey),
        );
        if (!header) {
          return false;
        }

        const record: ChangeRecord = {
          docKey,
          clientSeq: change.clientSeq,
          bytes,
        };
        tx.objectStore(CHANGES).put(record);
        // An append touches the entry. Without this, a document edited daily
        // for a month is collected on its anniversary with its unsent work
        // still in the log, because only `saveSnapshot` ever moved the clock.
        // It costs a few dozen bytes, because the snapshot is not in this
        // record.
        header.updatedAt = this.now();
        headers.put(header);
        return true;
      });

      if (!present) {
        this.refuseIfEvicted(docKey);
        return;
      }
      this.touched.add(docKey);
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
    return this.withQuotaRetry(docKey, async () => {
      const db = await this.open();
      const tx = db.transaction(HEADERS, "readwrite");
      const present = await WafflebaseDocStore.atomically(tx, async () => {
        const headers = tx.objectStore(HEADERS);
        const header = await requested<HeaderRecord | undefined>(
          headers.get(docKey),
        );
        // A header with no snapshot under it describes nothing, so this is a
        // no-op rather than a row that `load` would have to learn to ignore.
        if (!header) {
          return false;
        }
        header.meta = meta;
        header.updatedAt = this.now();
        headers.put(header);
        return true;
      });

      if (!present) {
        // The same condition `appendChange` refuses on, and for the same
        // reason: reporting success for a header we deleted would tell the SDK
        // its position is recorded when nothing holds it.
        this.refuseIfEvicted(docKey);
        return;
      }
      this.touched.add(docKey);
    });
  }

  /**
   * Throws when `docKey` is one eviction took.
   *
   * An absent entry is contractually a silent success: the SDK repairs a base
   * it knows it failed to write. It knows nothing about one deleted behind its
   * back, so silence there would let it keep handing us edits that go nowhere
   * while the chip reports the document durable. A rejection is what makes it
   * poison the log and write a fresh snapshot.
   */
  private refuseIfEvicted(docKey: string): void {
    if (!this.evicted.has(docKey)) {
      return;
    }
    throw new DOMException(
      `offline entry for "${docKey}" was evicted under storage pressure; ` +
        `the base must be written again`,
      "InvalidStateError",
    );
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
    const tx = db.transaction(
      [SNAPSHOTS, HEADERS, CHANGES, ARCHIVES],
      "readwrite",
    );
    const snapshots = tx.objectStore(SNAPSHOTS);
    const headers = tx.objectStore(HEADERS);
    const changes = tx.objectStore(CHANGES);

    const [record, header, changeRows] = await Promise.all([
      requested<SnapshotRecord | undefined>(snapshots.get(docKey)),
      requested<HeaderRecord | undefined>(headers.get(docKey)),
      requested<Array<ChangeRecord>>(
        changes.getAll(WafflebaseDocStore.rangeFor(docKey)),
      ),
    ]);

    if (record) {
      const archive: ArchiveRecord = {
        docKey,
        snapshot: record.snapshot,
        meta: header?.meta,
        changes: changeRows
          .sort((a, b) => a.clientSeq - b.clientSeq)
          .map((row) => ({ clientSeq: row.clientSeq, bytes: row.bytes })),
        archivedAt: this.now(),
        userId: header?.userId ?? this.userId,
      };
      tx.objectStore(ARCHIVES).put(archive);
    }

    // Unconditionally, not gated on the snapshot: a header without one is a
    // shape a torn write can produce, and gating would leave it behind for a
    // `load` that answers on the snapshot alone and a cleanup that walks
    // headers — invisible and uncollectable at once.
    snapshots.delete(docKey);
    headers.delete(docKey);
    changes.delete(WafflebaseDocStore.rangeFor(docKey));

    await WafflebaseDocStore.completed(tx);
    this.touched.delete(docKey);
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
    const tx = db.transaction([SNAPSHOTS, HEADERS, CHANGES], "readwrite");
    tx.objectStore(SNAPSHOTS).delete(docKey);
    tx.objectStore(HEADERS).delete(docKey);
    tx.objectStore(CHANGES).delete(WafflebaseDocStore.rangeFor(docKey));
    await WafflebaseDocStore.completed(tx);
    this.touched.delete(docKey);
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
      changes: await inflateLog(row.changes),
    };
  }

  /**
   * `dropArchive` forgets one archived entry, once its work has been handed
   * back as a document. Dropping it before that would trade an archive for
   * nothing if the hand-back failed.
   */
  public async dropArchive(id: number): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(ARCHIVES, "readwrite");
    tx.objectStore(ARCHIVES).delete(id);
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
    const keys = await this.headerKeysWhere(BY_USER, IDBKeyRange.only(userId));
    for (const docKey of keys) {
      await this.purge(docKey);
    }

    // Archives hold document content too, so the erase logout promises has to
    // reach them — otherwise signing out leaves the content on a shared machine
    // in the one place the user cannot see.
    await this.dropArchivesWhere(BY_USER, IDBKeyRange.only(userId));
    return keys.length;
  }

  /**
   * `collectStale` drops entries untouched for longer than `maxAgeMs`,
   * returning how many entries and archives went. Nothing else collects: the
   * SDK never calls `remove` on a normal detach, and correctly so, since not
   * removing is what makes resume possible.
   */
  public async collectStale(
    maxAgeMs: number = DefaultMaxAgeMs,
  ): Promise<number> {
    const cutoff = this.now() - maxAgeMs;
    const range = IDBKeyRange.upperBound(cutoff, true);

    // A document open right now is not stale, whatever its timestamp says:
    // purging it out from under a live SDK client is the same silent loss
    // eviction has to avoid, and it needs no quota failure to happen.
    const aged = await this.headerKeysWhere(BY_UPDATED_AT, range);
    const keys: Array<string> = [];
    for (const docKey of aged) {
      if (!(await this.isLive(docKey))) {
        keys.push(docKey);
      }
    }
    for (const docKey of keys) {
      await this.purge(docKey);
    }

    // On the same schedule: an archive store nothing ever collects is a quota
    // leak that looks like a feature.
    const archived = await this.dropArchivesWhere(BY_ARCHIVED_AT, range);

    // And anything with a snapshot but no header. Every other path here walks
    // the header indexes, so such a row is unreachable by all of them while
    // `load` still reports the document as present — a permanent quota leak
    // holding document content that logout cannot erase.
    const orphans = await this.orphanSnapshotKeys();
    for (const docKey of orphans) {
      await this.purge(docKey);
    }

    return keys.length + archived + orphans.length;
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

  /**
   * Snapshot rows with no header beside them, which no index can reach.
   *
   * Reads keys on both sides, so reconciliation never materializes a snapshot.
   *
   * Unlike collection, this does **not** spare what this session has open. An
   * orphan is already dead for writes — `appendChange` keys on the header and
   * discards everything — so clearing it is the repair, not a loss: `load` then
   * answers `undefined` and the SDK writes a fresh base. And it cannot fire on
   * a healthy entry, because both rows are written in one transaction and no
   * other transaction can observe one without the other.
   */
  private async orphanSnapshotKeys(): Promise<Array<string>> {
    const db = await this.open();
    const tx = db.transaction([SNAPSHOTS, HEADERS], "readonly");
    const [snapshotKeys, headerKeys] = await Promise.all([
      requested<Array<IDBValidKey>>(tx.objectStore(SNAPSHOTS).getAllKeys()),
      requested<Array<IDBValidKey>>(tx.objectStore(HEADERS).getAllKeys()),
    ]);
    const known = new Set(headerKeys as Array<string>);
    return (snapshotKeys as Array<string>).filter(
      (docKey) => !known.has(docKey),
    );
  }

  /**
   * The doc keys whose header matches a range on an index, in index order.
   *
   * Reads keys rather than records, so no cleanup pass materializes a
   * compressed snapshot to decide what to delete — which matters most for
   * eviction, since it runs when the origin is already out of room.
   */
  private async headerKeysWhere(
    index: string,
    range: IDBKeyRange,
  ): Promise<Array<string>> {
    const db = await this.open();
    const tx = db.transaction(HEADERS, "readonly");
    const keys = await requested<Array<IDBValidKey>>(
      tx.objectStore(HEADERS).index(index).getAllKeys(range),
    );
    return keys as Array<string>;
  }

  /** Drops archives matching a range on an index, returning how many went. */
  private async dropArchivesWhere(
    index: string,
    range: IDBKeyRange,
  ): Promise<number> {
    const db = await this.open();
    const tx = db.transaction(ARCHIVES, "readwrite");
    const store = tx.objectStore(ARCHIVES);
    const ids = await requested<Array<IDBValidKey>>(
      store.index(index).getAllKeys(range),
    );
    for (const id of ids) {
      store.delete(id);
    }
    await WafflebaseDocStore.completed(tx);
    return ids.length;
  }

  /**
   * Runs a write, and on a full origin frees the oldest *idle* entry and tries
   * once more.
   *
   * Once. A store that never accepts a write must report itself undurable —
   * which is what a rejection here becomes — rather than loop until it has
   * deleted every document the user had. And only a genuine quota failure
   * evicts: deleting documents in response to an unrelated bug would be a
   * self-inflicted data loss.
   */
  private async withQuotaRetry<T>(
    docKey: string,
    op: () => Promise<T>,
  ): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (!isQuotaExceeded(err)) {
        throw err;
      }
      if (!(await this.evictOldest(docKey))) {
        // Nothing idle left to free, so retrying would fail the same way.
        throw err;
      }
      return op();
    }
  }

  /**
   * Drops the least recently touched entry that is not open in this session,
   * and is not the one being written. False when there is no such entry.
   *
   * The exclusion is the whole point. Evicting the key currently being written
   * makes its own retry write into nothing; evicting another open document
   * makes every later append for it silently vanish while the chip still says
   * the document is saved. Entries from earlier sessions are the safe ones.
   */
  private async evictOldest(exceptDocKey: string): Promise<boolean> {
    const candidates = await this.headerKeysWhere(
      BY_UPDATED_AT,
      IDBKeyRange.lowerBound(-Infinity),
    );
    let victim: string | undefined;
    for (const docKey of candidates) {
      if (docKey === exceptDocKey) continue;
      if (await this.isLive(docKey)) continue;
      victim = docKey;
      break;
    }
    if (victim === undefined) {
      return false;
    }
    await this.purge(victim);
    // Remembered so an append for it fails loudly rather than being ignored:
    // the SDK believes that base is still there.
    this.evicted.add(victim);
    return true;
  }

  /**
   * Runs `body` against `tx` and resolves when the transaction commits.
   *
   * The `catch` is the point. Each method issues several requests into one
   * transaction; if one after the first throws, an `async` function unwinds
   * without touching the transaction, and IndexedDB **commits whatever was
   * already issued**. That produced a snapshot advanced over a log it was
   * supposed to drop (replay then applies those operations twice) and a
   * snapshot row with no header — which `load` reports as present, every append
   * silently discards, and no cleanup path could reach. Aborting turns both
   * into "the write did not happen", which every caller already handles.
   */
  private static async atomically<T>(
    tx: IDBTransaction,
    body: () => Promise<T> | T,
  ): Promise<T> {
    try {
      const result = await body();
      await WafflebaseDocStore.completed(tx);
      return result;
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // Already finished — committed, or aborted by the failure itself.
      }
      throw err;
    }
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
