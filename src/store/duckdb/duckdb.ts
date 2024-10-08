import * as arrow from 'apache-arrow';
import {
  LogLevel,
  Logger,
  LogEntryVariant,
  AsyncDuckDB,
  AsyncDuckDBConnection,
  selectBundle,
} from '@duckdb/duckdb-wasm';
import dbwasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpworker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import dbwasmnext from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehworker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

import { Cell, Grid, Ref, Range, Sref, Direction } from '../../worksheet/types';
import { parseRef, toSref, toSrefs } from '../../worksheet/coordinates';
import { extractReferences } from '../../formula/formula';

/**
 * `CellRecord` is a type that represents a cell record.
 */
type CellRecord = {
  r: arrow.Int;
  c: arrow.Int;
  v: arrow.Utf8;
  f: arrow.Utf8;
};

/**
 * `DependencyRecord` is a type that represents a dependency record.
 */
type DependencyRecord = {
  ref: arrow.Utf8;
  dependant: arrow.Utf8;
};

class ConsoleLogger implements Logger {
  private level: LogLevel;
  constructor(level?: LogLevel) {
    this.level = level || LogLevel.INFO;
  }
  log(entry: LogEntryVariant) {
    if (entry.level < this.level) {
      return;
    }

    console.log(entry.timestamp, entry.value);
  }
}

export async function createDuckDBStore(_: string): Promise<DuckDBStore> {
  const DUCKDB_CONFIG = await selectBundle({
    mvp: {
      mainModule: dbwasm,
      mainWorker: mvpworker,
    },
    eh: {
      mainModule: dbwasmnext,
      mainWorker: ehworker,
    },
    coi: {
      mainModule: './duckdb-coi.wasm',
      mainWorker: './duckdb-browser-coi.worker.js',
      pthreadWorker: './duckdb-browser-coi.pthread.worker.js',
    },
  });

  const logger = new ConsoleLogger(LogLevel.WARNING);
  const worker = new Worker(DUCKDB_CONFIG.mainWorker!);
  const db = new AsyncDuckDB(logger, worker);
  await db.instantiate(DUCKDB_CONFIG.mainModule, DUCKDB_CONFIG.pthreadWorker);

  const conn = await db.connect();

  await conn.query<CellRecord>(
    `CREATE TABLE IF NOT EXISTS cells (r INTEGER, c INTEGER, v STRING, f STRING, PRIMARY KEY (r, c))`,
  );

  await conn.query<DependencyRecord>(
    'CREATE TABLE IF NOT EXISTS dependencies (ref STRING, dependant STRING, PRIMARY KEY (ref, dependant))',
  );

  return new DuckDBStore(db, conn, worker);
}

class DuckDBStore {
  private db: AsyncDuckDB;
  private conn: AsyncDuckDBConnection;
  private worker: Worker;

  constructor(db: AsyncDuckDB, conn: AsyncDuckDBConnection, worker: Worker) {
    this.db = db;
    this.conn = conn;
    this.worker = worker;
  }

  public async setGrid(grid: Grid): Promise<void> {
    await this.conn.query(`BEGIN TRANSACTION;`);

    for (const [sref, cell] of grid) {
      const ref = parseRef(sref);
      await this.upsertCell(ref, cell);
    }

    await this.conn.query(`COMMIT;`);
  }

  public async set(ref: Ref, cell: Cell): Promise<void> {
    await this.conn.query('BEGIN TRANSACTION;');
    await this.upsertCell(ref, cell);
    await this.conn.query('COMMIT;');
  }

  public async get(ref: Ref): Promise<Cell | undefined> {
    const table = await this.conn.query<CellRecord>(
      `SELECT * FROM cells WHERE r = ${ref.r} AND c = ${ref.c}`,
    );

    const res = table.toArray();
    if (res.length === 0) {
      return;
    }

    return {
      v: res[0].v.toString(),
      f: res[0].f.toString(),
    };
  }

  public async has(ref: Ref): Promise<boolean> {
    const table = await this.conn.query<CellRecord>(
      `SELECT r, c FROM cells WHERE r = ${ref.r} AND c = ${ref.c}`,
    );

    return table.numRows > 0;
  }

  public async delete(ref: Ref): Promise<boolean> {
    await this.conn.query('BEGIN TRANSACTION;');

    const table = await this.conn.query<CellRecord>(
      `DELETE FROM cells WHERE r = ${ref.r} AND c = ${ref.c}`,
    );
    const result = table.numRows > 0;
    await this.deleteDependency(ref);

    await this.conn.query('COMMIT;');

    return result;
  }

  public async getGrid(range: Range): Promise<Grid> {
    const [from, to] = range;
    const table = await this.conn.query<CellRecord>(
      `SELECT * FROM cells
       WHERE r >= ${from.r} AND r <= ${to.r} AND c >= ${from.c} AND c <= ${to.c}`,
    );

    const grid = new Map<string, Cell>();
    const res = table.toArray();
    for (const row of res) {
      const cell = row.toJSON();
      grid.set(toSref({ r: cell.r, c: cell.c }), {
        v: cell.v.toString(),
        f: cell.f.toString(),
      });
    }
    return grid;
  }

  public async findEdge(
    ref: Ref,
    direction: Direction,
    dimension: Range,
  ): Promise<Ref> {
    const [from, to] = dimension;
    const isVertical = direction === 'up' || direction === 'down';
    const isAscending = direction === 'up' || direction === 'left';
    const axis = isVertical ? 'r' : 'c';
    const fixedAxis = isVertical ? 'c' : 'r';
    const fixedValue = ref[fixedAxis];
    const fromValue = from[axis];
    const toValue = to[axis];

    const table = await this.conn.query<CellRecord>(
      `SELECT r, c FROM cells
       WHERE ${axis} ${isAscending ? '<=' : '>='} ${ref[axis]}
       AND ${fixedAxis} = ${fixedValue} AND ${axis} >= ${fromValue} AND ${axis} <= ${toValue}
       ORDER BY ${axis} ${isAscending ? 'DESC' : 'ASC'}`,
    );

    if (table.numRows === 0) {
      return {
        [fixedAxis]: fixedValue,
        [axis]: isAscending ? fromValue : toValue,
      } as Ref;
    }

    // TODO(hackerwins): toArray might be expensive. We should consider
    // implementing a custom iterator to avoid this.
    const cells = table.toArray();
    const first = cells[0];
    const hasValue = first[axis] === ref[axis];

    if (!hasValue) {
      return { r: first.r, c: first.c };
    }

    if (cells.length === 1) {
      return {
        [fixedAxis]: fixedValue,
        [axis]: isAscending ? fromValue : toValue,
      } as Ref;
    }

    // NOTE(hackerwins): Find the cell on the edge. If ref is on the edge,
    // return the next cell.
    for (let i = 1; i < cells.length; i++) {
      const curr = cells[i - 1];
      const next = cells[i];
      if (next[axis] !== curr[axis] + (isAscending ? -1 : 1)) {
        return curr[axis] == ref[axis]
          ? { r: next.r, c: next.c }
          : { r: curr.r, c: curr.c };
      }
    }

    return { r: cells[cells.length - 1].r, c: cells[cells.length - 1].c };
  }

  public async buildDependantsMap(
    srefs: Iterable<Sref>,
  ): Promise<Map<string, Set<string>>> {
    const stack = Array.from(srefs);
    const dependants = new Map<string, Set<string>>();

    while (stack.length) {
      const srefs = stack
        .filter((sref) => !dependants.has(sref))
        .map((sref) => `'${sref}'`);
      stack.length = 0;
      if (srefs.length === 0) {
        continue;
      }

      const table = await this.conn.query<DependencyRecord>(
        `SELECT * FROM dependencies WHERE ref IN (${srefs.join(', ')})`,
      );

      for (const row of table.toArray()) {
        const record = row.toJSON();
        if (!dependants.has(record.ref)) {
          dependants.set(record.ref, new Set());
        }

        dependants.get(record.ref)!.add(record.dependant);
        stack.push(record.dependant);
      }
    }

    return dependants;
  }

  public async close() {
    await this.conn.close();
    await this.db.terminate();
    await this.worker.terminate();
  }

  private escape(str: string): string {
    return str.replace(/'/g, "''");
  }

  private async upsertCell(ref: Ref, cell: Cell) {
    await this.conn.query(
      `INSERT INTO cells
       VALUES (${ref.r}, ${ref.c}, '${this.escape(cell.v || '')}', '${this.escape(cell.f || '')}')
       ON CONFLICT (r, c)
       DO UPDATE 
       SET v = '${this.escape(cell.v || '')}', f = '${this.escape(cell.f || '')}'`,
    );

    if (cell.f) {
      for (const sref of toSrefs(extractReferences(cell.f))) {
        await this.conn.query(
          `INSERT INTO dependencies
           VALUES ('${sref}', '${toSref(ref)}')
           ON CONFLICT (ref, dependant)
           DO NOTHING`,
        );
      }
    } else {
      await this.deleteDependency(ref);
    }
  }

  private async deleteDependency(ref: Ref) {
    await this.conn.query(
      `DELETE FROM dependencies WHERE dependant = '${toSref(ref)}'`,
    );
  }
}
