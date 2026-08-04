import {
  createSpreadsheetDocument,
  importCsv,
  importTable,
  type SpreadsheetDocument,
} from "@wafflebase/sheets";
import { previewFileImport, type FileImportPreview } from "@/api/files";

/**
 * Parse an already-selected `.csv` / `.tsv` `File` into a one-tab spreadsheet
 * document. Used directly by the upload queue, mirroring `importXlsx`. Both
 * extensions take this path — `importCsv` detects the delimiter.
 */
export async function importCsvFile(file: File): Promise<{
  document: SpreadsheetDocument;
  fileName: string;
  rowCount: number;
  truncated: boolean;
}> {
  // `.tsv` says what the delimiter is, so say it rather than letting papaparse
  // score candidates: one comma inside a tab-separated field is enough to
  // outscore the tabs and collapse the row into a single cell, silently. `.csv`
  // promises nothing (semicolon exports are common), so it keeps guessing.
  const delimiter = /\.tsv$/i.test(file.name) ? '\t' : undefined;
  // `File.text()` decodes as UTF-8 and strips a BOM; other encodings (CP949)
  // are a known limitation, see the PR body.
  const { worksheet, rowCount, truncated } = importCsv(await file.text(), {
    delimiter,
  });
  return {
    document: createSpreadsheetDocument({ worksheet }),
    fileName: file.name,
    rowCount,
    truncated,
  };
}

/**
 * Flatten the preview into the row-major table `importTable` wants: values
 * pulled in column order, since row objects are keyed by name and nothing
 * guarantees their key order matches `columns`.
 *
 * Nothing is prepended. The backend reads with `header = false`, so a header
 * arrives as row 0 of `rows` in the file's own words — `preview.columns` are
 * always placeholders (`column0`, …) and are a key order, not text. Writing
 * them in was how the sheet ended up with DuckDB's de-duplicated names
 * (`a`, `a_1`), its filler for an empty header cell (`column1`), and a header
 * repeated twice when the file began with a blank line.
 */
function toRows(preview: FileImportPreview): unknown[][] {
  const names = preview.columns.map((column) => column.name);
  return preview.rows.map((row) => names.map((name) => row[name]));
}

/**
 * Build a one-tab spreadsheet document from a file the backend parsed. The
 * caller uploads the blob and persists its id first (see `upload-queue`), so a
 * retry re-previews the same blob instead of uploading a second copy.
 *
 * Not CSV-specific: the backend response is format-agnostic, so #554/#555 reuse
 * this unchanged once their `read_*` call is wired. It lives here because the
 * only extensions that reach this path today are `.csv` and `.tsv`; moving it
 * somewhere neutral is the job of whoever adds the second one.
 */
export async function importSheetViaBackend(
  workspaceId: string,
  fileId: string,
): Promise<{
  document: SpreadsheetDocument;
  rowCount: number;
  truncated: boolean;
}> {
  const preview = await previewFileImport(workspaceId, fileId);
  // `hasHeader` now decides one thing only: whether row 0 gets the header
  // style. Where that row's text comes from is no longer a question — it is
  // the file's first line either way.
  const { worksheet, rowCount, truncated } = importTable(toRows(preview), {
    hasHeader: preview.hasHeader,
  });
  return {
    document: createSpreadsheetDocument({ worksheet }),
    // What actually landed in the sheet, which is the engine's count — the
    // server may have sent fewer rows than the file had, and the engine may
    // then have kept fewer still.
    rowCount,
    // Either side may have cut: the server bounds what crosses the wire, the
    // engine bounds what a Yorkie document can hold.
    truncated: preview.truncated || truncated,
  };
}
