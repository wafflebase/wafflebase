import { getWorksheetCell, MAX_IMPORT_CELLS } from "@wafflebase/sheets";
import Papa from "papaparse";
import { afterEach, describe, expect, it } from "vitest";
import { __setMaxRowlessBytesForTest, parseCsvFile } from "./csv-actions";
import { sheetImportBaseName } from "./sheet-import-actions";

/**
 * Builds a `File` the way the picker would hand one over.
 *
 * Bytes rather than a string so a test can control the exact encoding — which
 * is the whole point of the CP949 and chunk-boundary cases below.
 */
function fileOf(name: string, bytes: Uint8Array | string): File {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return new File([data.buffer as ArrayBuffer], name);
}

/**
 * Parses the way the import path does, deriving the sheet name from the file
 * with the same helper `importSheetFile` uses.
 */
function importCsv(file: File) {
  return parseCsvFile(file, sheetImportBaseName(file.name));
}

type ImportedCsv = Awaited<ReturnType<typeof parseCsvFile>>;

/** Reads a cell by 1-indexed position out of the produced worksheet. */
function cellAt(table: ImportedCsv, r: number, c: number) {
  return getWorksheetCell(table.worksheet, { r, c });
}

// papaparse reads a local File in 10 MB chunks by default. Shrinking it lets
// the boundary tests use small fixtures instead of 10 MB ones.
const DEFAULT_LOCAL_CHUNK_SIZE = Papa.LocalChunkSize;
const DEFAULT_MAX_ROWLESS_BYTES = 200_000_000;
afterEach(() => {
  Papa.LocalChunkSize = DEFAULT_LOCAL_CHUNK_SIZE;
  __setMaxRowlessBytesForTest(DEFAULT_MAX_ROWLESS_BYTES);
});

describe("parseCsvFile — parsing", () => {
  it("imports a comma-separated file into one sheet", async () => {
    const result = await importCsv(
      fileOf("data.csv", "name,qty\napple,3\npear,5\n"),
    );
    expect(result.rowCount).toBe(3);
    expect(result.columnCount).toBe(2);
    expect(result.cellCount).toBe(6);
    expect(result.truncated).toBe(false);
    expect(cellAt(result, 1, 1)?.v).toBe("name");
    expect(cellAt(result, 2, 2)?.v).toBe("3");
  });

  it("splits .tsv on tabs even when a field contains a comma", async () => {
    // The reason `.tsv` states its delimiter instead of letting papaparse
    // guess: one comma can outscore the tabs and take the row as a single cell.
    const result = await importCsv(
      fileOf("data.tsv", "a\tb\n1,5\t2\n"),
    );
    expect(cellAt(result, 2, 1)?.v).toBe("1,5");
    expect(cellAt(result, 2, 2)?.v).toBe("2");
  });

  it("auto-detects a semicolon-separated .csv despite its trailing newline", async () => {
    // Regression: papaparse's own delimiter guess scores by field-count
    // consistency, and the trailing newline every real CSV has appends a
    // one-field empty row. That makes `;` look inconsistent (2,2,1) while `,`
    // looks perfect (1,1,1), so the file silently imports as one column. Sniffed
    // from the header line instead.
    const result = await importCsv(fileOf("data.csv", "name;qty\napple;3\n"));
    expect(cellAt(result, 1, 2)?.v).toBe("qty");
    expect(cellAt(result, 2, 1)?.v).toBe("apple");
  });

  it("auto-detects a pipe-separated .csv", async () => {
    const result = await importCsv(fileOf("data.csv", "name|qty\napple|3\n"));
    expect(cellAt(result, 1, 2)?.v).toBe("qty");
  });

  it("ignores delimiters that only appear inside a quoted header field", async () => {
    // `"Smith, John"` must not let the comma outvote the real semicolon.
    const result = await importCsv(
      fileOf("data.csv", '"Smith, John";qty;city\na;1;b\n'),
    );
    expect(cellAt(result, 1, 1)?.v).toBe("Smith, John");
    expect(cellAt(result, 1, 3)?.v).toBe("city");
  });

  it("imports a single-column file that has no delimiter at all", async () => {
    const result = await importCsv(fileOf("one.csv", "name\napple\npear\n"));
    expect(result.rowCount).toBe(3);
    expect(cellAt(result, 3, 1)?.v).toBe("pear");
  });

  it("infers cell types the same way the engine does", async () => {
    const result = await importCsv(
      fileOf("data.csv", "label,n,when\nx,1234,2026-08-06\n"),
    );
    expect(cellAt(result, 2, 2)?.v).toBe("1234");
    expect(cellAt(result, 2, 3)?.s?.nf).toBe("date");
  });
});

describe("parseCsvFile — sheet name", () => {
  // The name travels on the ImportedSheet; turning it into a tab (and
  // uniquing it) is createSpreadsheetDocumentFromImportedSheets' job, shared
  // with the XLSX and JSON paths.
  it("names the sheet from the file name", async () => {
    const result = await importCsv(fileOf("Q3 Budget.csv", "a,b\n1,2\n"));
    expect(result.name).toBe("Q3 Budget");
  });

  it("strips .csv and .tsv case-insensitively", async () => {
    const csv = await importCsv(fileOf("data.CSV", "a\n1\n"));
    const tsv = await importCsv(fileOf("data.TSV", "a\tb\n1\t2\n"));
    expect(csv.name).toBe("data");
    expect(tsv.name).toBe("data");
  });

  it("falls back to Imported Sheet when the file name has no stem", async () => {
    const result = await importCsv(fileOf(".csv", "a\n1\n"));
    expect(result.name).toBe("Imported Sheet");
  });
});

describe("parseCsvFile — encoding", () => {
  it("reads a UTF-8 file with multi-byte characters", async () => {
    const result = await importCsv(fileOf("k.csv", "이름,수량\n사과,3\n"));
    expect(cellAt(result, 1, 1)?.v).toBe("이름");
    expect(cellAt(result, 2, 1)?.v).toBe("사과");
  });

  it("reads a CP949 file, which UTF-8 decoding would mangle", async () => {
    // What Korean Excel writes by default. The probe has to catch this — with
    // `file.text()` (UTF-8 only) these cells arrive as replacement characters.
    const cp949 = new Uint8Array([
      0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xbc, 0xf6, 0xb7, 0xae, 0x0a, // 이름,수량\n
      0xbb, 0xe7, 0xb0, 0xfa, 0x2c, 0x33, 0x0a, // 사과,3\n
    ]);
    const result = await importCsv(fileOf("k.csv", cp949));
    expect(cellAt(result, 1, 1)?.v).toBe("이름");
    expect(cellAt(result, 2, 1)?.v).toBe("사과");
  });

  it("catches CP949 that only starts well past the first 64 KB", async () => {
    // Regression for a review finding: a head-only probe declares UTF-8 the
    // moment the first 64 KB happens to be plain ASCII, then papaparse decodes
    // the *whole* file as UTF-8 -- the CP949 bytes past the probe aren't
    // necessarily invalid UTF-8, just wrong, so they come back as silent
    // mojibake rather than an error. Sampling the middle and tail too is what
    // catches this.
    const filler = "row,filler data to push the file past 64 KB\n".repeat(6000);
    const cp949Tail = new Uint8Array([
      0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xbc, 0xf6, 0xb7, 0xae, 0x0a, // 이름,수량\n
      0xbb, 0xe7, 0xb0, 0xfa, 0x2c, 0x33, 0x0a, // 사과,3\n
    ]);
    const head = new TextEncoder().encode(`name,data\n${filler}`);
    const bytes = new Uint8Array(head.length + cp949Tail.length);
    bytes.set(head, 0);
    bytes.set(cp949Tail, head.length);
    expect(bytes.length).toBeGreaterThan(65_536 * 3); // clears all three probe windows

    const result = await importCsv(fileOf("k.csv", bytes));
    expect(cellAt(result, result.rowCount - 1, 1)?.v).toBe("이름");
    expect(cellAt(result, result.rowCount, 1)?.v).toBe("사과");
  });

  it("does not skip past a fourth continuation byte when a window cuts a character", async () => {
    // A window that starts mid-character is preceded by at most 3 continuation
    // bytes, because 4 bytes is the longest UTF-8 sequence. Skipping a 4th
    // steps over a byte that proves the window is not UTF-8 — and CP949 Hangul
    // supplies exactly that: "가가" is B0 A1 B0 A1, four bytes all in the
    // continuation range, and with ASCII behind it the window decodes cleanly.
    // The whole file then reads as UTF-8 and every Korean cell arrives as
    // replacement characters.
    //
    // Built so the middle window lands on that boundary exactly: the file is
    // 2 * HALF bytes, so `Math.floor(size / 2)` is HALF, and the Korean starts
    // there. HALF > 65,536 also keeps the head window pure ASCII, so the probe
    // reaches the middle sample at all.
    const HALF = 70_000;
    const line = "padding,row,to,reach,the,midpoint\n";
    const head = new TextEncoder().encode(
      line.repeat(Math.ceil(HALF / line.length)).slice(0, HALF - 1) + "\n",
    );
    // 가가,ok\n in CP949 — the first four bytes are the ones under test.
    const korean = new Uint8Array([
      0xb0, 0xa1, 0xb0, 0xa1, 0x2c, 0x6f, 0x6b, 0x0a,
    ]);
    const tail = new TextEncoder().encode(
      line.repeat(Math.ceil(HALF / line.length)).slice(0, HALF - korean.length),
    );
    const bytes = new Uint8Array(head.length + korean.length + tail.length);
    bytes.set(head, 0);
    bytes.set(korean, head.length);
    bytes.set(tail, head.length + korean.length);

    expect(head.length).toBe(HALF);
    expect(bytes.length).toBe(HALF * 2);
    expect(Math.floor(bytes.length / 2)).toBe(HALF); // the middle window's offset
    expect(bytes[HALF] & 0xc0).toBe(0x80); // and it opens on a continuation byte

    const result = await importCsv(fileOf("k.csv", bytes));
    // Row HALF's first cell: read back as CP949 it is 가가, as UTF-8 it is not.
    const korean_row = result.worksheet.rowOrder.findIndex((_, i) => {
      const cell = cellAt(result, i + 1, 1);
      return cell?.v === "가가";
    });
    expect(korean_row).toBeGreaterThanOrEqual(0);
  });

  it("does not misdetect a UTF-8 file whose probe window cuts a character", async () => {
    // The probe reads a fixed 64 KB prefix, so a multi-byte character will
    // eventually straddle that edge. `stream: true` is what keeps that an
    // incomplete tail rather than a decode error that would flip the file to
    // CP949 and corrupt every Korean cell in it.
    const filler = "가".repeat(30_000); // 3 bytes each -> crosses 64 KB
    const result = await importCsv(
      fileOf("k.csv", `header\n${filler}\n마지막\n`),
    );
    expect(cellAt(result, 3, 1)?.v).toBe("마지막");
  });

  it("strips a UTF-8 BOM instead of gluing it to the first cell", async () => {
    const result = await importCsv(fileOf("b.csv", "﻿name,qty\na,1\n"));
    expect(cellAt(result, 1, 1)?.v).toBe("name");
  });
});

describe("parseCsvFile — chunk boundaries", () => {
  it("does not corrupt a multi-byte character split across a chunk edge", async () => {
    // The decisive test for this design. papaparse slices a File by *bytes* and
    // decodes each slice with its own FileReader, so no decoder state carries
    // across the boundary — a 3-byte Korean character landing on the edge could
    // come back as replacement characters on both sides.
    //
    // Built so a character is guaranteed to straddle: the chunk size is a prime
    // that cannot align with the 3-byte characters filling the row.
    Papa.LocalChunkSize = 997;
    const rows = Array.from({ length: 40 }, (_, i) => `행${i},가나다라마바사`);
    const result = await importCsv(fileOf("k.csv", `${rows.join("\n")}\n`));

    for (let r = 1; r <= rows.length; r++) {
      expect(cellAt(result, r, 2)?.v).toBe("가나다라마바사");
    }
  });

  it("rejoins a row split across a chunk edge", async () => {
    // papaparse buffers a partial line across chunks; this pins that the row
    // still parses into the right number of cells.
    Papa.LocalChunkSize = 64;
    const rows = Array.from({ length: 20 }, (_, i) => `a${i},b${i},c${i}`);
    const result = await importCsv(fileOf("d.csv", `${rows.join("\n")}\n`));
    expect(cellAt(result, 20, 3)?.v).toBe("c19");
  });
});

describe("parseCsvFile — budget", () => {
  it("truncates a file past the cell budget and says so", async () => {
    const rows = Array.from({ length: MAX_IMPORT_CELLS / 2 + 100 }, (_, i) =>
      `${i},x`,
    );
    const result = await importCsv(fileOf("big.csv", `${rows.join("\n")}\n`));
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(MAX_IMPORT_CELLS / 2);
  });

  it("stops reading once the budget is full instead of parsing to the end", async () => {
    // What keeps import cost proportional to the budget rather than the file:
    // with a small chunk size, a file far past the budget must not be read
    // chunk by chunk to its end.
    Papa.LocalChunkSize = 4096;
    let chunks = 0;
    const original = Papa.LocalChunkSize;
    const rows = Array.from({ length: MAX_IMPORT_CELLS, }, (_, i) => `${i},x`);
    const text = `${rows.join("\n")}\n`;
    const file = fileOf("big.csv", text);
    // Count how many chunks the parser actually pulls.
    const spy = new Proxy(file, {
      get(target, prop, receiver) {
        if (prop === "slice") {
          return (...args: [number, number]) => {
            chunks += 1;
            return File.prototype.slice.apply(target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await importCsv(spy as File);
    const totalChunks = Math.ceil(text.length / original);
    expect(chunks).toBeLessThan(totalChunks);
  });
});

describe("parseCsvFile — malformed input", () => {
  it("rejects an unterminated quoted field", async () => {
    await expect(
      importCsv(fileOf("bad.csv", 'a,b\n"never closes,2\n')),
    ).rejects.toThrow(/unterminated quoted field/);
  });

  it("rejects a file that yields no row for several chunks", async () => {
    // The unbounded case: an opening quote that never closes means papaparse
    // emits no row at all, so neither the budget nor the abort ever fires and
    // its partial-line buffer grows for the whole file. (Small enough here to
    // resolve via the `MissingQuotes`-at-EOF path rather than the watchdog —
    // both are covered separately below.)
    Papa.LocalChunkSize = 512;
    const file = fileOf("bad.csv", `"${"x".repeat(20_000)}`);
    await expect(importCsv(file)).rejects.toThrow(
      /does not look like a table|unterminated quote/i,
    );
  });

  it("does NOT reject a legitimate closed field regardless of how many chunks it spans", async () => {
    // Regression for the bug a code review found: the watchdog used to count
    // consecutive rowless *chunks*, so shrinking the chunk size alone could
    // trip it on a field that never actually grows past a normal size — this
    // is the "legitimately huge closed field" case the design doc for this
    // watchdog explicitly says must not be rejected. A tiny chunk size forces
    // many chunk boundaries inside a field that is, in byte terms, nowhere
    // near the real threshold.
    Papa.LocalChunkSize = 50;
    const field = "y".repeat(5_000); // 100 chunks at this size, still tiny in bytes
    const file = fileOf("ok.csv", `a,b\n1,"${field}"\n2,done\n`);
    const result = await importCsv(file);
    expect(result.truncated).toBe(false);
  });

  it("aborts mid-file once the byte watchdog is exceeded, without reading to EOF", async () => {
    // Proves the watchdog actually bounds memory rather than only ever
    // resolving via `MissingQuotes` at the real end of file: lower the
    // threshold, then confirm the parser stops pulling further chunks once an
    // unterminated field has grown past it — well before the file (which
    // keeps going) is exhausted.
    __setMaxRowlessBytesForTest(1_000);
    Papa.LocalChunkSize = 200;
    const text = `"${"z".repeat(50_000)}`; // never closes, far larger than the file needs to be read
    let sliceCalls = 0;
    const file = new Proxy(fileOf("huge-bad.csv", text), {
      get(target, prop, receiver) {
        if (prop === "slice") {
          return (...args: [number, number]) => {
            sliceCalls += 1;
            return File.prototype.slice.apply(target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(importCsv(file as File)).rejects.toThrow(
      /does not look like a table/,
    );
    const totalChunksIfReadWhole = Math.ceil(text.length / 200);
    expect(sliceCalls).toBeLessThan(totalChunksIfReadWhole);
  });

  it("rejects an empty file", async () => {
    await expect(importCsv(fileOf("empty.csv", ""))).rejects.toThrow(
      /does not contain any data/,
    );
  });

  it("rejects a file of only empty fields", async () => {
    await expect(importCsv(fileOf("blank.csv", ",,\n,,\n"))).rejects.toThrow(
      /does not contain any data/,
    );
  });
});
