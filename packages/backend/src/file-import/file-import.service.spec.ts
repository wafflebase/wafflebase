import { BadRequestException, GoneException } from '@nestjs/common';
import { readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { FileService } from '../file/file.service';
import { DuckDbService } from '../lakehouse/duckdb.service';
import { FileImportService } from './file-import.service';

const WS = 'ws1';
const FILE_ID = '00000000-0000-4000-8000-000000000000.csv';
const TSV_FILE_ID = '00000000-0000-4000-8000-000000000000.tsv';

let duckdb: DuckDbService;

function makeService(csv: string): FileImportService {
  const fileService = {
    getObjectStream: () => Promise.resolve(Readable.from([Buffer.from(csv)])),
  } as unknown as FileService;
  return new FileImportService(fileService, duckdb);
}

beforeAll(() => {
  duckdb = new DuckDbService();
});

afterAll(async () => {
  await duckdb.onModuleDestroy();
});

describe('FileImportService.preview', () => {
  it('returns columns and rows in the shared response shape', async () => {
    const service = makeService('name,qty\napple,3\npear,10\n');

    const result = await service.preview(WS, FILE_ID);

    // `columns` is a key order and a width, never text: the reader is told
    // not to consume a header, so the file's own header is row 0.
    expect(result.columns).toEqual([{ name: 'column0' }, { name: 'column1' }]);
    expect(result.rows).toEqual([
      { column0: 'name', column1: 'qty' },
      { column0: 'apple', column1: '3' },
      { column0: 'pear', column1: '10' },
    ]);
    expect(result.hasHeader).toBe(true);
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  // DuckDB hands BIGINT back as `bigint`, which JSON.stringify throws on
  // outright — the response would 500 rather than serialize. A string is also
  // the only lossless JSON form: this value is past Number.MAX_SAFE_INTEGER.
  it('renders integer columns as JSON-safe strings', async () => {
    const service = makeService('big\n9007199254740993\n');

    const result = await service.preview(WS, FILE_ID);

    expect(result.rows[1].column0).toBe('9007199254740993');
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  // With type inference off there is no DOUBLE fallback to lose precision in:
  // the value arrives as the text the file held. The client parser reaches the
  // same cell for the same file, which is the point — file size must not
  // decide what a value becomes.
  it('keeps an integer wider than BIGINT exact', async () => {
    const service = makeService('big\n12345678901234567890\n');

    const result = await service.preview(WS, FILE_ID);

    expect(result.rows[1].column0).toBe('12345678901234567890');
  });

  // Without `null_padding` DuckDB abandons the whole file here and returns a
  // single column named after the joined header, every row one text cell — and
  // raises nothing. papaparse writes each field at its own index, so the same
  // file imports correctly below the size threshold.
  it('keeps a short row aligned to its own columns', async () => {
    const service = makeService('a,b,c\n1,2,3\n4,5\n6,7,8\n');

    const result = await service.preview(WS, FILE_ID);

    expect(result.rows).toEqual([
      { column0: 'a', column1: 'b', column2: 'c' },
      { column0: '1', column1: '2', column2: '3' },
      { column0: '4', column1: '5', column2: null },
      { column0: '6', column1: '7', column2: '8' },
    ]);
  });

  it('keeps the header when a row has more fields than the header', async () => {
    const service = makeService('a,b,c\n1,2,3\n4,5,6,7\n');

    const result = await service.preview(WS, FILE_ID);

    // The extra value widens the table instead of collapsing every row into
    // one text cell, which is what happens without the option.
    expect(result.columns).toHaveLength(4);
    expect(result.rows[0]).toEqual({
      column0: 'a',
      column1: 'b',
      column2: 'c',
      column3: null,
    });
    expect(result.rows[2].column3).toBe('7');
  });

  // The caller styles row 0 as a header on this verdict alone, so the sniff
  // has to survive the reader being told there is no header (see
  // `CSV_READ_OPTIONS` — the sniffer must not be given that option).
  it.each([
    ['a file with a header', 'a,b\n1,2\n', true],
    ['a headerless file', '1,2\n3,4\n', false],
  ])('reports hasHeader for %s', async (_label, csv, expected) => {
    const service = makeService(csv);

    const result = await service.preview(WS, FILE_ID);

    expect(result.hasHeader).toBe(expected);
  });

  // `read_csv` reports a placeholder column for an empty file rather than
  // none, so the guard has to be on rows. The client parser rejects the same
  // file; without this the outcome would depend on file size.
  it('rejects an empty file', async () => {
    await expect(makeService('').preview(WS, FILE_ID)).rejects.toThrow(
      /does not contain any data/,
    );
  });

  // A header and nothing else used to be rejected here, because the reader
  // consumed the header and left zero rows. papaparse never did — it writes
  // `a,b` as one bolded row — so the same file imported below the threshold
  // and 400'd above it. Now that the header is row 0 the two agree.
  it('imports a header with no data rows, as the client parser does', async () => {
    const result = await makeService('a,b\n').preview(WS, FILE_ID);

    expect(result.rows).toEqual([{ column0: 'a', column1: 'b' }]);
    expect(result.hasHeader).toBe(true);
  });

  // The wire contract with the sheets importer: it infers dates from these two
  // forms only, so an ISO timestamp here would land as a text cell.
  it.each([
    ['a date column', 'when\n2026-01-02\n', '2026-01-02'],
    [
      'a timestamp column',
      'when\n2026-01-02 14:30:00\n',
      '2026-01-02 14:30:00',
    ],
  ])('emits %s in the form the importer infers', async (_l, csv, expected) => {
    const service = makeService(csv);

    const result = await service.preview(WS, FILE_ID);

    expect(result.rows[1].column0).toBe(expected);
  });

  it('caps by cells, so a narrow table keeps more rows than a wide one', async () => {
    const rows = (columns: number, count: number) =>
      Array.from({ length: count }, (_, r) =>
        Array.from({ length: columns }, (_, c) => `v${r}_${c}`).join(','),
      ).join('\n');
    const header = (columns: number) =>
      Array.from({ length: columns }, (_, c) => `c${c}`).join(',');

    // 50,000 cells / 25 columns = 2,000 rows, the header among them.
    const wide = await makeService(
      `${header(25)}\n${rows(25, 2100)}\n`,
    ).preview(WS, FILE_ID);
    expect(wide.truncated).toBe(true);
    expect(wide.rowCount).toBe(2000);

    // The same row count is comfortably under the cap at 2 columns — 2,100
    // records plus the header row they share the budget with.
    const narrow = await makeService(
      `${header(2)}\n${rows(2, 2100)}\n`,
    ).preview(WS, FILE_ID);
    expect(narrow.truncated).toBe(false);
    expect(narrow.rowCount).toBe(2101);
  });

  // What crosses the wire is exactly what the engine can write — the header is
  // one of the rows counted, not an extra the client bolts on afterwards. Send
  // one row too many and `importTable` drops it, reporting a file that fitted
  // as truncated and losing a record.
  it('sends no more rows than the cell cap can hold', async () => {
    const columns = 25;
    const budget = 50_000 / columns;
    const header = Array.from({ length: columns }, (_, c) => `c${c}`).join(',');
    // One row past the budget, so the limit is what stops it, not the file.
    const rows = Array.from({ length: budget }, (_, r) =>
      Array.from({ length: columns }, (_, c) => `v${r}_${c}`).join(','),
    ).join('\n');

    const result = await makeService(`${header}\n${rows}\n`).preview(WS, FILE_ID);

    expect(result.rowCount * columns).toBeLessThanOrEqual(50_000);
    expect(result.rowCount).toBe(budget);
  });

  // A file the padded read treats as headed must not be sniffed as headerless,
  // or the caller leaves the `a,b` row unbolded. Only reproducible when the
  // sniff runs with different *shape* options than the read, which is why
  // `CSV_SHARED_OPTIONS` exists.
  it('agrees with the padded read about a row wider than the header', async () => {
    const service = makeService('a,b\n1,2,3\n4,5,6\n');

    const result = await service.preview(WS, FILE_ID);

    expect(result.columns).toHaveLength(3);
    expect(result.hasHeader).toBe(true);
  });

  // The trap in the option split. `header = false` tells the *reader* not to
  // consume row 0; handed to `sniff_csv` it is not a request but an answer, so
  // the sniffer echoes `HasHeader = false` for a file that plainly has one and
  // every header silently loses its bold. Merging the two constants back into
  // one is the mistake this pins.
  it('sniffs a header even though the reader is told there is none', async () => {
    const result = await makeService('name,qty\napple,3\n').preview(WS, FILE_ID);

    expect(result.hasHeader).toBe(true);
    expect(result.rows[0]).toEqual({ column0: 'name', column1: 'qty' });
  });

  // The three ways DuckDB's own column names used to reach the sheet as header
  // text. All of them are gone now that the header is simply row 0.
  it.each([
    ['a duplicate header name', 'a,a,b\n1,2,3\n', ['a', 'a', 'b']],
    ['an empty header cell', 'name,,qty\nx,y,3\n', ['name', null, 'qty']],
    ['a leading blank line', '\nname,qty\napple,3\n', ['name', 'qty']],
  ])('keeps the file its own header text with %s', async (_l, csv, expected) => {
    const result = await makeService(csv).preview(WS, FILE_ID);

    expect(Object.values(result.rows[0])).toEqual(expected);
    // ...and exactly once: the blank-line case used to report the header and
    // then hand it back again as the first data row.
    expect(Object.values(result.rows[1] ?? {})).not.toEqual(expected);
  });

  // The client states the delimiter for `.tsv` rather than guessing, because
  // one comma in a tab-separated field defeats papaparse's detector. The reader
  // is told for the same reason: a guess here and a statement there is how the
  // same bytes split differently either side of the size threshold.
  it.each([
    ['a comma inside a field', 'a\tb\n1,5\t2\n', ['a', 'b']],
    ['a blank line', 'a\tb\n\n1\t2\n', ['a', 'b']],
    // Two columns, the second holding commas — which is what a tab split of
    // this file means, and what the client produces once it is told the same.
    ['a comma-heavy header', 'a\tb,c,d\n1\t2,3,4\n', ['a', 'b,c,d']],
  ])('splits a .tsv on tabs despite %s', async (_label, csv, expected) => {
    const result = await makeService(csv).preview(WS, TSV_FILE_ID);

    expect(result.columns).toHaveLength(2);
    expect(Object.values(result.rows[0])).toEqual(expected);
  });

  it('rejects a file id that is not a uuid with a known extension', async () => {
    await expect(
      makeService('a\n1\n').preview(WS, '../../etc/passwd'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // A document blob is not something this endpoint may reach into: the import
  // pattern admits csv/tsv only, so a pdf id never gets as far as the
  // format lookup.
  it('rejects a blob id that is not an importable format', async () => {
    await expect(
      makeService('a\n1\n').preview(
        WS,
        '00000000-0000-4000-8000-000000000000.pdf',
      ),
    ).rejects.toThrow(/Invalid file id/);
  });

  // The parser names the file it was reading, and this message is shown
  // verbatim on the upload row.
  it('strips the server path out of a parser error', async () => {
    const service = makeService('a,b\n1,2\n');
    jest.spyOn(duckdb, 'readTable').mockImplementationOnce((_format, path) => {
      // Built from the path the service actually chose — `mkdtemp` picks a
      // random directory, so a hard-coded one would not exercise the strip.
      throw new Error(`Invalid Input Error: CSV Error in file ${path}: bad`);
    });

    await expect(service.preview(WS, FILE_ID)).rejects.toThrow(
      /CSV Error in file <file>: bad/,
    );
  });

  // Only a bad *file* is the caller's problem. An engine that will not start
  // is ours, and reporting it as 400 both blames the user and tells the upload
  // queue not to retry (it backs off on 429 alone).
  it('lets an infrastructure failure through instead of calling it a bad file', async () => {
    const service = makeService('a,b\n1,2\n');
    jest
      .spyOn(duckdb, 'readSchema')
      .mockRejectedValueOnce(new Error('IO Error: Extension "x" not found'));

    await expect(service.preview(WS, FILE_ID)).rejects.not.toBeInstanceOf(
      BadRequestException,
    );
  });

  // A quoted newline is ordinary — any address or description field has one —
  // and DuckDB's parallel scanner refuses `null_padding` as soon as it meets
  // one. It raised `Parameter Not Allowed Error`, which is not a file-content
  // class, so the item failed with a 500 rather than parsing. `parallel = false`
  // is the fix DuckDB's own message prescribes, and it is free at `threads = 1`.
  it('reads a field containing a quoted newline', async () => {
    const service = makeService('note,qty\n"line one\nline two",2\n');

    const result = await service.preview(WS, FILE_ID);

    expect(result.rows).toEqual([
      { column0: 'note', column1: 'qty' },
      { column0: 'line one\nline two', column1: '2' },
    ]);
  });

  // Pins a real divergence between the two engines. papaparse treats an
  // unterminated quote as fatal (`MissingQuotes`) and the client importer
  // refuses the file; DuckDB recovers and keeps the stray quote as text. So
  // the same broken file is rejected below the size threshold and imported
  // above it. Documented rather than forced into agreement: making DuckDB
  // strict would reject files it can read perfectly well, and neither engine
  // is wrong on its own terms.
  it('recovers from an unterminated quote that the client importer rejects', async () => {
    const service = makeService('a,b\n"unterminated,2\n');

    const result = await service.preview(WS, FILE_ID);

    expect(result.rows).toEqual([
      { column0: 'a', column1: 'b' },
      { column0: '"unterminated', column1: '2' },
    ]);
  });

  // Staged blobs expire after a day, so the id a retry replays can outlive the
  // object. A 500 with a raw SDK message tells the client nothing; a 410 tells
  // it the id is spent, which is what makes it re-upload instead of looping.
  it('reports a blob that no longer exists as gone', async () => {
    const missing = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    const service = new FileImportService(
      {
        getObjectStream: () => Promise.reject(missing),
      } as unknown as FileService,
      duckdb,
    );

    await expect(service.preview(WS, FILE_ID)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  // Anything else from storage is this side's problem, and the queue retries
  // only on a 429 — flattening it to a 4xx would declare it permanent.
  it('lets other storage failures propagate', async () => {
    const service = new FileImportService(
      {
        getObjectStream: () => Promise.reject(new Error('connection reset')),
      } as unknown as FileService,
      duckdb,
    );

    await expect(service.preview(WS, FILE_ID)).rejects.toThrow('connection reset');
  });

  it('leaves no temp directory behind, on success or failure', async () => {
    const before = (await readdir(tmpdir())).filter((n) =>
      n.startsWith('wafflebase-import-'),
    ).length;

    await makeService('a\n1\n').preview(WS, FILE_ID);
    await makeService('a\n1\n')
      .preview(WS, '00000000-0000-4000-8000-000000000000.pdf')
      .catch(() => {});

    const after = (await readdir(tmpdir())).filter((n) =>
      n.startsWith('wafflebase-import-'),
    ).length;
    expect(after).toBe(before);
  });
});
