import { createTableWriter, type ImportedTable } from "@wafflebase/sheets";
import Papa from "papaparse";

/**
 * How much of the file the encoding probe reads.
 *
 * 64 KB is far more than needed: CP949 byte sequences are almost never valid
 * UTF-8, so a single Korean character is enough to decide. Reading a fixed
 * prefix rather than the whole file is the point — this is the one place the
 * import touches raw bytes, and it must not scale with file size.
 */
const ENCODING_PROBE_BYTES = 65_536;

/**
 * How many bytes may be read without producing a single row before the file is
 * rejected as malformed.
 *
 * This is the one input that can otherwise consume unbounded memory. papaparse
 * only emits a row when it finds a row boundary, so a file with an unterminated
 * quote never emits one: `step` never fires, the cell budget never fills, the
 * abort never triggers, and papaparse's internal partial-line buffer grows for
 * the length of the file.
 *
 * A *byte* threshold, not a raw chunk count — an earlier version compared
 * consecutive rowless `chunk` callbacks against a fixed count (3), so a smaller
 * `Papa.LocalChunkSize` tripped it on a field that never actually grew past a
 * normal size. Measured consequence: a legitimately closed 35 MB quoted field
 * spans exactly 3 default 10 MB chunks and was rejected — the exact
 * "legitimately huge closed field" case this exists to let through.
 *
 * Bytes read is estimated as `rowless chunk count × Papa.LocalChunkSize`
 * (below), not read from papaparse's own `results.meta.cursor` — that only
 * tracks progress through *parsed rows* and stays at 0 for as long as no row
 * has been found, verified empirically rather than assumed. The chunk-size
 * estimate is an upper bound (the final chunk may read less), so it can only
 * trigger sooner than the true byte count, never later.
 *
 * 200 MB is generous on purpose: comfortably above any plausible single-cell
 * blob (a log dump or an HTML fragment in one cell), while still bounding a
 * genuinely pathological file (an unterminated quote) to a known, finite
 * amount of buffered memory instead of reading it to the end.
 *
 * Module-private, not a mutable export: an ES module's named export is a
 * read-only binding to importers, so — unlike `Papa.LocalChunkSize`, a plain
 * object property — it cannot be reassigned from a test. `__setMaxRowlessBytesForTest`
 * is the escape hatch tests use to exercise this path without a 200 MB fixture.
 */
let maxRowlessBytes = 200_000_000;

/** Test-only override for {@link maxRowlessBytes}. */
export function __setMaxRowlessBytesForTest(bytes: number): void {
  maxRowlessBytes = bytes;
}


/**
 * Reads one fixed-size window and reports whether it decodes as valid UTF-8.
 *
 * UTF-8 is its own detector: its multi-byte sequences are tightly constrained,
 * so a CP949/EUC-KR window — what Korean Excel writes by default — almost
 * always fails to decode. That makes a `fatal: true` probe a reliable
 * discriminator without shipping a charset-detection library.
 *
 * `stream: true` matters for the *trailing* edge: it tells the decoder that a
 * multi-byte character cut in half at the window's end is an incomplete tail
 * to buffer, not an error. The *leading* edge needs separate handling for any
 * window that doesn't start at byte 0 — its first byte can land mid-character,
 * which looks exactly like an invalid leading byte. `offset > 0` skips up to 3
 * leading continuation bytes (`10xxxxxx`, the most a UTF-8 character can be
 * misaligned by) before decoding, so a real UTF-8 file sampled off-boundary
 * doesn't falsely fail.
 */
async function sampleIsUtf8(
  file: File,
  offset: number,
  length: number,
): Promise<{ valid: boolean; bytes: Uint8Array }> {
  const bytes = new Uint8Array(
    await file.slice(offset, offset + length).arrayBuffer(),
  );
  let start = 0;
  if (offset > 0) {
    // At most 3: a 4-byte character is the longest UTF-8 sequence, so a window
    // cut inside one begins with at most its 3 trailing continuation bytes.
    // Skipping a 4th would step over a byte that *proves* the window is not
    // UTF-8, and CP949 Hangul supplies those in pairs — "가가" is B0 A1 B0 A1,
    // four bytes all in the continuation range. Followed by ASCII it would
    // decode cleanly, carry the file to UTF-8, and turn every Korean cell into
    // replacement characters.
    while (start < bytes.length && start < 3 && (bytes[start] & 0xc0) === 0x80) {
      start++;
    }
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start), {
      stream: true,
    });
    return { valid: true, bytes };
  } catch {
    return { valid: false, bytes };
  }
}

/**
 * Picks the character encoding for the whole file from three fixed-size
 * windows — head, middle, tail — rather than the head alone.
 *
 * A head-only probe is blind to a file that is plain ASCII for its first 64 KB
 * and only turns non-ASCII later (a long English preamble before a Korean data
 * section, for instance): the probe says UTF-8, papaparse decodes the entire
 * file as UTF-8, and every non-ASCII cell past the probe silently comes back
 * as mojibake. Sampling three spread-out windows instead of one catches that
 * shape without scanning the whole file — cost stays three fixed 64 KB reads
 * regardless of file size, so it doesn't reintroduce the "cost scales with
 * file size" problem streaming was built to avoid.
 *
 * This is still a heuristic, not a guarantee: a file whose non-ASCII bytes
 * fall entirely between the three sampled windows can still be misdetected.
 * Full-file encoding detection is the tracked open question (see the CP949
 * discussion in the plan doc) — this closes the specific gap the review
 * found, not that larger question.
 *
 * A `.tsv` never reads the returned string — its delimiter is fixed — so that
 * last decode is wasted work for it. Measured at 0.01–0.42 ms and kept
 * deliberately: returning the raw bytes instead would make every caller pair
 * them with the right encoding, trading that saving for an invariant this
 * function currently cannot get wrong. The *probing* is not waste for `.tsv`
 * either way — the delimiter and the encoding are independent axes, and a
 * CP949 `.tsv` is as ordinary as a CP949 `.csv`.
 */
async function readHead(
  file: File,
): Promise<{ encoding: string; head: string }> {
  const head = await sampleIsUtf8(file, 0, ENCODING_PROBE_BYTES);
  let utf8 = head.valid;
  if (utf8 && file.size > ENCODING_PROBE_BYTES * 2) {
    utf8 = (
      await sampleIsUtf8(
        file,
        Math.floor(file.size / 2),
        ENCODING_PROBE_BYTES,
      )
    ).valid;
  }
  if (utf8 && file.size > ENCODING_PROBE_BYTES * 3) {
    utf8 = (
      await sampleIsUtf8(
        file,
        file.size - ENCODING_PROBE_BYTES,
        ENCODING_PROBE_BYTES,
      )
    ).valid;
  }
  const encoding = utf8 ? "utf-8" : "euc-kr";
  return { encoding, head: new TextDecoder(encoding).decode(head.bytes) };
}

/** Delimiters worth considering, most common first. */
const DELIMITER_CANDIDATES = [",", ";", "\t", "|"] as const;

/**
 * Picks the delimiter by counting candidates in the first line.
 *
 * papaparse can guess on its own, but its heuristic scores delimiters by how
 * *consistent* a field count they produce — and a trailing newline (which
 * essentially every CSV has) appends a one-field empty row that makes the real
 * delimiter look inconsistent while the wrong one looks perfect. Measured: a
 * semicolon file parses into two columns without a trailing newline and
 * collapses into one column with it, at any row count. Semicolon exports are
 * what Excel writes in most of Europe, so that is a silent single-column import
 * of an ordinary file.
 *
 * `skipEmptyLines` would fix the guess, but it also drops blank rows *inside*
 * the table and shifts every row below them up — trading a visible failure for
 * an invisible one. Counting the header line instead is both narrower and
 * deterministic.
 *
 * Returns `undefined` when nothing appears (a single-column file), which leaves
 * papaparse to its default — there is no delimiter to get wrong.
 */
function sniffDelimiter(head: string): string | undefined {
  const line = head.split(/\r?\n/).find((candidate) => candidate.trim() !== "");
  if (!line) return undefined;

  let best: string | undefined;
  let bestCount = 0;
  for (const candidate of DELIMITER_CANDIDATES) {
    // Counted outside quotes only: a comma inside `"Smith, John"` is data, and
    // letting it vote is how a semicolon file loses to a comma that only ever
    // appears within a field.
    let count = 0;
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parses a `.csv` / `.tsv` `File` into one `ImportedSheet`.
 *
 * Returns the sheet rather than a `SpreadsheetDocument` so the shared
 * `createSpreadsheetDocumentFromImportedSheets` builds the document, the same
 * way the XLSX and JSON paths do — tab naming and its fallback then live in
 * one place instead of once per format.
 *
 * ## Why the `File` is handed over whole
 *
 * papaparse reads a `File` in chunks (`Blob.slice` + `FileReader.readAsText`),
 * so nothing here ever materializes the file as a string. That matters because
 * the obvious alternatives do not scale: `file.text()` — and equally
 * `arrayBuffer()` + `TextDecoder` — build one string of the whole file, which
 * costs several times the file size in heap and hits V8's hard limit of
 * 2^29-24 characters. Streaming makes the cost depend on how much is *imported*
 * rather than on how big the file is.
 *
 * Combined with the writer's budget, that bounds the work: `push` returning
 * `false` aborts the parse, so a 5 GB file and a 5 MB one both stop after the
 * budget is full and neither is read to the end.
 */
export async function parseCsvFile(
  file: File,
  sheetName: string,
): Promise<ImportedTable> {
  const { encoding, head } = await readHead(file);
  // `.tsv` states its delimiter in its name, so take it at its word. `.csv`
  // promises nothing — comma, semicolon and tab exports all carry that
  // extension — so its delimiter is sniffed from the first line.
  const delimiter = /\.tsv$/i.test(file.name) ? "\t" : sniffDelimiter(head);
  const writer = createTableWriter({ sheetName });

  return new Promise<ImportedTable>((resolve, reject) => {
    // `results.meta.cursor` cannot be used for this: it tracks progress through
    // *parsed rows*, and while no row has ever been found it stays at 0 —
    // verified empirically, not assumed. `Papa.LocalChunkSize` times the
    // consecutive rowless chunk count is what's actually available, and is an
    // upper bound on bytes read (the final chunk may be smaller), which only
    // ever makes this trigger sooner, never later.
    const chunkSize = Papa.LocalChunkSize || ENCODING_PROBE_BYTES;
    let rowlessBytes = 0;
    let sawRowThisChunk = false;
    // `parser.abort()` invokes `complete` synchronously, so a failure path that
    // aborted and *then* rejected would have `complete` resolve first and the
    // rejection silently lost — the caller would receive a half-built document
    // instead of the error. Recording the failure keeps `complete` quiet.
    let failure: Error | undefined;

    const fail = (error: Error, parser: Papa.Parser): void => {
      failure = error;
      parser.abort();
      reject(error);
    };

    Papa.parse<string[]>(file, {
      // `delimiter: undefined` is not the same as omitting the key: papaparse
      // treats an explicit undefined as "not given" and guesses, which is what
      // `.csv` wants.
      delimiter,
      encoding,
      step: (results, parser) => {
        // An unterminated quote makes papaparse swallow the rest of the file
        // into one field, which would otherwise look like a successful import
        // of a single enormous value. Its siblings are noise and recover fine:
        // `InvalidQuotes` fires on a stray quote inside a quoted field (`5" x
        // 7"`), and `UndetectableDelimiter` fires for every single-column file.
        if (results.errors.some((error) => error.code === "MissingQuotes")) {
          fail(new Error("This file has an unterminated quoted field."), parser);
          return;
        }
        sawRowThisChunk = true;
        // The budget is full: stop reading rather than parsing the rest of a
        // file whose remainder cannot be imported anyway.
        if (!writer.push(results.data)) parser.abort();
      },
      // Fires once per chunk regardless of how many rows it produced, which is
      // what makes it the right place to notice that none were produced at all.
      chunk: (_results, parser) => {
        if (sawRowThisChunk) {
          rowlessBytes = 0;
          sawRowThisChunk = false;
          return;
        }
        sawRowThisChunk = false;
        rowlessBytes += chunkSize;
        if (rowlessBytes > maxRowlessBytes) {
          fail(
            new Error(
              "This file does not look like a table — no row could be read. " +
                "Check for an unterminated quote.",
            ),
            parser,
          );
        }
      },
      // `parser.abort()` calls `complete` itself, so a budget stop and a normal
      // end of file converge here instead of needing two resolution paths. A
      // reject above already settled the promise; resolving after that is a
      // no-op.
      complete: () => {
        // Reached both by a normal end of file and by the `abort()` inside
        // `fail`; only the former should build a sheet.
        if (failure) return;
        try {
          resolve(writer.finish());
        } catch (error) {
          reject(error as Error);
        }
      },
      error: reject,
    });
  });
}
