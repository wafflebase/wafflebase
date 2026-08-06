import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DuckDbService } from './duckdb.service';

// `readSchema`/`readTable` no longer lock themselves — every caller must go
// through `withReadSlot`, which is what these tests exercise. The scenario
// below is the regression `withReadSlot` exists to close: a per-phase
// acquire/release left a gap between a request's own schema and table reads
// for a second request's schema read (which alone claims the whole lock) to
// cut in ahead of, serializing every request at the schema-read boundary
// instead of merely bounding total concurrency.
describe('DuckDbService.withReadSlot', () => {
  let duckdb: DuckDbService;
  let directory: string;
  let path: string;

  beforeAll(async () => {
    duckdb = new DuckDbService();
    directory = await mkdtemp(join(tmpdir(), 'duckdb-lock-test-'));
    path = join(directory, 'data.csv');
    await writeFile(path, 'name,qty\napple,3\n');
  });

  afterAll(async () => {
    await duckdb.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  });

  it('never runs two withReadSlot bodies at once, in call order', async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    const job = (id: number) =>
      duckdb.withReadSlot(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(id);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
      });

    await Promise.all([job(1), job(2), job(3)]);

    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  // A parse failure is an ordinary outcome — a malformed file reaches this
  // path in normal use. If the release ever left `finally`, the FIFO chain
  // would stop advancing and every later import would hang for the process
  // lifetime rather than fail, surfacing as "slow" rather than as an error.
  it('releases the slot when the body throws', async () => {
    await expect(
      duckdb.withReadSlot(() => Promise.reject(new Error('parse failed'))),
    ).rejects.toThrow('parse failed');

    const result = await duckdb.withReadSlot(() =>
      duckdb.readSchema('csv', path),
    );

    expect(result.hasHeader).toBe(true);
  }, 20_000);

  it('does not let a second request start before the first finishes both its schema and table reads', async () => {
    const events: string[] = [];

    const requestFlow = (label: string) =>
      duckdb.withReadSlot(async () => {
        events.push(`${label}:schema-start`);
        await duckdb.readSchema('csv', path);
        events.push(`${label}:schema-end`);
        await duckdb.readTable('csv', path, 10);
        events.push(`${label}:table-end`);
      });

    await Promise.all([requestFlow('A'), requestFlow('B')]);

    // B's schema phase must not start until A's whole pipeline — schema AND
    // table — has finished. Before the fix, B's schema read (which alone
    // claims the whole gate) could win the race to run between A's schema
    // and table phases.
    expect(events.indexOf('B:schema-start')).toBeGreaterThan(
      events.indexOf('A:table-end'),
    );
  }, 20_000);

  it('resolves many concurrent requests without hanging', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        duckdb.withReadSlot(() => duckdb.readSchema('csv', path)),
      ),
    );
    for (const result of results) {
      expect(result.hasHeader).toBe(true);
    }
  }, 20_000);
});
