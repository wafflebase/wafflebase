import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DuckDBInstance } from '@duckdb/node-api';
import type { ImportExtension } from '../file/file.constants';

/**
 * The formats this service is allowed to read. This union *is* the allowlist
 * the design doc requires ("expose only an allowlist of import functions — no
 * raw SQL passthrough on the import path"): callers name a format, never a
 * query, so there is no string for a caller to inject into.
 *
 * Aliased to `ImportExtension` rather than its own literal union: that type is
 * `file.constants.ts`'s documented single source of truth for the extension
 * set, and `READER_SQL`/`SNIFF_SQL` below are `Record`s keyed by this type —
 * so a format added there without a matching entry here is a compile error
 * instead of an `undefined` SQL string surfacing as an opaque 500 at runtime.
 *
 * Parquet (#554) and JSON (#555) each add one member to `IMPORT_EXTENSIONS`
 * plus their entry in `READER_SQL`/`SNIFF_SQL`, and nothing else.
 *
 * `tsv` is its own member rather than an alias for `csv` because the delimiter
 * is the difference: the extension states it, so the reader is told rather than
 * left to sniff. The client does the same for the same reason — a delimiter
 * guessed on one path and stated on the other is how file size starts deciding
 * how a row splits.
 */
export type ImportFormat = ImportExtension;

/**
 * How each format is read. The options are not incidental — they are what makes
 * the backend path agree with the client's papaparse path, which matters
 * because file *size* picks between them:
 *
 *   - `all_varchar`: every value comes back as the text the file contained.
 *     The sheets importer re-infers each cell with `inferInput` anyway, so
 *     DuckDB's typing is discarded work — and asking for it actively breaks
 *     things the client path gets right: an integer wider than BIGINT is
 *     sniffed as DOUBLE and silently loses precision, a value that changes
 *     type past the sniffer's sample aborts the whole import, and BIGINT
 *     arrives as a `bigint` that `JSON.stringify` refuses to serialize at all.
 *   - `null_padding`: a row with fewer fields than the header keeps its
 *     columns. Without it DuckDB gives up on the whole file and returns a
 *     single column named after the joined header — every row one text cell,
 *     no error raised. papaparse writes each field at its own index, so the
 *     same ragged file imports correctly below the size threshold.
 *   - `parallel = false`: required by the option above, not a tuning choice.
 *     DuckDB's parallel scanner refuses `null_padding` the moment a field
 *     contains a quoted newline — "the parallel scanner does not support
 *     null_padding in conjunction with quoted new lines" — and a quoted newline
 *     is ordinary in an address or a description. It costs nothing: the
 *     instance already runs `threads = 1`, so there is nothing to parallelize.
 *
 * They are a constant of their own because `sniff_csv` is a separate parse and
 * has to agree with the reader about the file's *shape*: an unpadded sniff of a
 * padded read disagrees about the header. `a,b\n1,2,3` is the case — padded,
 * row 1 is the header (`a`, `b`, `column2`); unpadded, `HasHeader` comes back
 * false and the caller drops the header row out of the sheet.
 */
const CSV_SHARED_OPTIONS =
  'all_varchar = true, null_padding = true, parallel = false';

/**
 * The reader's options. `header = false` is here and **must never be given to
 * `sniff_csv`**, which is why these are two constants rather than one.
 *
 * To the reader it means "row 0 is data, not names". That is what keeps the
 * file's own header text reachable: with a header DuckDB *consumes* row 0 and
 * only exposes it through `columns`, which are names it has post-processed —
 * duplicates get a suffix (`a,a,b` → `a`, `a_1`, `b`), an empty one becomes a
 * placeholder (`name,,qty` → `name`, `column1`, `qty`), and after a leading
 * blank line the header is reported *and* handed back again as the first data
 * row. Every one of those reached the sheet as header text the file never had.
 *
 * To the sniffer the same option is not a request to leave the header alone —
 * it is the answer. `sniff_csv(…, header = false)` returns `HasHeader = false`
 * for a file that plainly has one, so the bold would be decided by the option
 * we passed rather than by the file.
 */
const CSV_READ_OPTIONS = `${CSV_SHARED_OPTIONS}, header = false`;

const READER_SQL: Record<ImportFormat, string> = {
  csv: `read_csv(?, ${CSV_READ_OPTIONS})`,
  tsv: `read_csv(?, ${CSV_READ_OPTIONS}, delim = '\\t')`,
};

/** Same split for the sniffer, which must agree with the reader about shape. */
const SNIFF_SQL: Record<ImportFormat, string> = {
  csv: `sniff_csv(?, ${CSV_SHARED_OPTIONS})`,
  tsv: `sniff_csv(?, ${CSV_SHARED_OPTIONS}, delim = '\\t')`,
};

/** One column of a read result. Names only — a file has no Postgres type OID. */
export interface ImportColumn {
  name: string;
}

/** What a read would return, without reading anything. */
export interface ImportSchema {
  columns: ImportColumn[];
  /**
   * The file's first row looked like column names — so **row 0 of the read**
   * is that header, and the caller may style it as one.
   *
   * It says nothing about `columns`, which are always DuckDB's placeholders
   * (`column0`, …) now that the reader is told not to consume a header. They
   * carry key order and a count, never text for the sheet.
   */
  hasHeader: boolean;
}

export interface ImportTable {
  columns: ImportColumn[];
  rows: Record<string, unknown>[];
  /** The file had more rows than `limit`. */
  truncated: boolean;
}

/**
 * Serializes reads against the shared instance. `all_varchar` parsing with no
 * pushdown can use a meaningful slice of the 512MB cap, so unbounded
 * concurrency lets independent uploads race each other into an Out of Memory
 * Error instead of queuing behind one another — and `readSchema` alone opens
 * two connections at once (see its comment), which already saturates a
 * two-connection budget, so there is no narrower unit than "one read pipeline
 * at a time" left to allow.
 *
 * A plain FIFO chain, not a counting semaphore: each `acquire()` links onto
 * the previous holder's release, so ordering is exactly call order with no
 * "wake every waiter and let whichever microtask runs first win" gap. That
 * gap is what let a second caller's `readSchema` — which alone claims the
 * whole prior budget — jump ahead of a first caller's own subsequent
 * `readTable`, each acquired separately with a release in between. See
 * `withReadSlot`, which closes that gap by holding one lock across both.
 *
 * ponytail: no overlap between independent reads, and no backpressure signal
 * to the caller beyond waiting. Revisit if import throughput needs it.
 */
class ReadLock {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = held;
    await previous;
    return release;
  }
}

/**
 * Embedded DuckDB, used only to read uploaded data files.
 *
 * This is the minimal subset of the lakehouse engine (LH-0): one in-memory
 * instance, restricted, with no connection model and no secrets. LH-0 adds
 * `INSTALL`/`LOAD` for iceberg/delta/httpfs/azure and `CREATE SECRET` on top —
 * on its own connection. The design doc splits the two deliberately: the query
 * path loads extensions, the *import* path is locked down.
 */
@Injectable()
export class DuckDbService implements OnModuleDestroy {
  private instance?: Promise<DuckDBInstance>;
  private readonly lock = new ReadLock();

  /**
   * Created on first use, not at boot: the native binary should not be a
   * startup cost (or a startup failure) for a server that may never import a
   * file. Every read shares it — the instance is in-memory and stateless, and
   * each read opens its own connection.
   */
  private getInstance(): Promise<DuckDBInstance> {
    this.instance ??= DuckDBInstance.create(':memory:', {
      // Bound the blast radius of a hostile file: a crafted CSV can otherwise
      // make the parser allocate freely and take the whole server down with it.
      memory_limit: '512MB',
      threads: '1',
      // No extension may be fetched or loaded. `read_csv` is core, so this
      // costs nothing here while closing the network-egress path that the
      // untrusted-upload risk turns on.
      autoinstall_known_extensions: 'false',
      autoload_known_extensions: 'false',
      allow_community_extensions: 'false',
      // Forget a failed start instead of caching the rejection: a transient
      // failure (a full disk, a missing native binary during a rolling
      // deploy) would otherwise disable imports for the whole process
      // lifetime, since `??=` keeps the settled promise either way.
    }).catch((error: unknown) => {
      this.instance = undefined;
      throw error;
    });
    return this.instance;
  }

  async onModuleDestroy(): Promise<void> {
    const instance = await this.instance?.catch(() => undefined);
    instance?.closeSync();
  }

  /**
   * Runs one full read pipeline (typically `readSchema` then `readTable`)
   * under the lock, held for the whole span rather than each acquiring and
   * releasing it separately — see `ReadLock`'s comment for the race that
   * left open. `readSchema`/`readTable` do not lock themselves; every caller
   * of either must go through this.
   */
  async withReadSlot<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.lock.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Read the first rows of a local file. Caller must hold `withReadSlot`.
   *
   * `limit + 1` rows are requested so the extra row is the truncation signal —
   * the same trick `datasource.service.ts` uses — rather than counting the file
   * twice.
   */
  async readTable(
    format: ImportFormat,
    path: string,
    limit: number,
  ): Promise<ImportTable> {
    const connection = await (await this.getInstance()).connect();
    try {
      const result = await connection.run(
        `SELECT * FROM ${READER_SQL[format]} LIMIT ?`,
        [path, limit + 1],
      );
      const columns = result.columnNames().map((name) => ({ name }));
      const raw = await result.getRowObjectsJS();

      const truncated = raw.length > limit;
      // No value conversion: `all_varchar` means every cell is already the
      // text the file held, which is both JSON-safe and exactly what the
      // client's parser would have produced for the same file.
      const rows = truncated ? raw.slice(0, limit) : raw;

      return { columns, rows, truncated };
    } finally {
      connection.closeSync();
    }
  }

  /**
   * The table's width and whether its first row is a header, without reading a
   * single row. Caller must hold `withReadSlot`.
   *
   * The reader never consumes a header (see `CSV_READ_OPTIONS`), so `columns`
   * is a count and a key order — the caller takes header *text* from row 0 of
   * the data like any other row. `sniff_csv` is the only thing that can say
   * whether that row is a header, and it needs the shared options to reach the
   * same verdict the reader's shape implies.
   */
  async readSchema(format: ImportFormat, path: string): Promise<ImportSchema> {
    const instance = await this.getInstance();
    // Two independent reads of the same file (column names, then a sniff),
    // each on its own connection — a single connection cannot run two
    // queries at once — so they overlap instead of paying their latency
    // twice. Both run under the same single-slot `withReadSlot` hold: they
    // are two connections against one reservation, not two reservations.
    const readConn = await instance.connect();
    // Opened one at a time, not as a pair: if the second `connect()` fails
    // once the first has opened, nothing below closes it — the `try` is never
    // entered, so its `finally` never arms — and a leaked connection holds
    // native resources for the process lifetime. Only the `connect()` calls
    // are serialized; the two queries below still overlap, which is the point
    // the comment above makes, and `connect()` on an in-memory instance costs
    // nothing.
    const sniffConn = await instance.connect().catch((error) => {
      readConn.closeSync();
      throw error;
    });
    try {
      const [result, sniffed] = await Promise.all([
        readConn.run(`SELECT * FROM ${READER_SQL[format]} LIMIT 0`, [path]),
        // Deliberately the *shared* options, not the reader's: see
        // `CSV_READ_OPTIONS`. Handing `header = false` to the sniffer makes
        // it report the option back instead of sniffing the file.
        sniffConn.run(`SELECT HasHeader FROM ${SNIFF_SQL[format]}`, [path]),
      ]);
      const columns = result.columnNames().map((name) => ({ name }));
      const [row] = await sniffed.getRowObjectsJS();

      return { columns, hasHeader: row?.HasHeader === true };
    } finally {
      readConn.closeSync();
      sniffConn.closeSync();
    }
  }
}
