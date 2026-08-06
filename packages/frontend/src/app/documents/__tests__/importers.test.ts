import { describe, it, expect, vi, afterEach } from "vitest";

// `vi.mock` replaces the module wholesale, so every export the importers reach
// has to be listed here — a missing one is `undefined` at call time, not a
// type error.
vi.mock("@wafflebase/sheets", () => ({
  importXlsxWorkbook: vi.fn(async () => [{ name: "S1", worksheet: {} }]),
  importCsv: vi.fn(() => ({
    worksheet: { cells: {} },
    rowCount: 1,
    truncated: false,
  })),
  importTable: vi.fn(() => ({
    worksheet: { cells: {} },
    rowCount: 1,
    truncated: false,
  })),
  createSpreadsheetDocument: vi.fn(() => ({
    tabs: { "tab-1": { id: "tab-1", name: "Sheet1", type: "sheet" } },
    tabOrder: ["tab-1"],
    sheets: { "tab-1": { cells: {} } },
  })),
}));

import { importCsv, importTable } from "@wafflebase/sheets";
import { importXlsx } from "@/app/spreadsheet/xlsx-actions";
import {
  importCsvFile,
  importSheetViaBackend,
} from "@/app/spreadsheet/csv-actions";

describe("importXlsx (File-taking core)", () => {
  it("parses a File into a SpreadsheetDocument without a picker", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "Budget.xlsx");
    const { document, fileName } = await importXlsx(file);
    expect(fileName).toBe("Budget.xlsx");
    expect(document.tabOrder.length).toBe(1);
  });
});

describe("importCsvFile", () => {
  it("builds a one-tab document and keeps the file name", async () => {
    const file = new File(["a,b\n1,2"], "sales.csv");
    const { document, fileName } = await importCsvFile(file);
    expect(fileName).toBe("sales.csv");
    expect(document.tabOrder.length).toBe(1);
  });

  // The delimiter is stated, not guessed: one comma inside a tab-separated
  // field is enough to outscore the tabs and collapse the row into one cell.
  it("states the tab delimiter for .tsv instead of guessing", async () => {
    const content = "name\tvalue\nacme, inc\t1";

    await importCsvFile(new File([content], "sales.tsv"));

    expect(importCsv).toHaveBeenLastCalledWith(content, { delimiter: "\t" });
  });

  // The cap lives in the engine, so a browser-parsed file can be truncated
  // too. The queue warns off these two fields for both paths.
  it("passes the engine's row count and truncation flag through", async () => {
    vi.mocked(importCsv).mockReturnValueOnce({
      worksheet: { cells: {} },
      rowCount: 5,
      truncated: true,
    } as unknown as ReturnType<typeof importCsv>);

    const { rowCount, truncated } = await importCsvFile(
      new File(["a,b\n1,2"], "sales.csv"),
    );

    expect(rowCount).toBe(5);
    expect(truncated).toBe(true);
  });
});

describe("importSheetViaBackend", () => {
  function mockPreview(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("builds a one-tab document from a column/row preview", async () => {
    // `columns` are the reader's placeholders — a key order, not text. The
    // header is row 0 of `rows`, in the file's own words.
    mockPreview({
      columns: [{ name: "column0" }, { name: "column1" }],
      rows: [
        { column0: "name", column1: "qty" },
        { column0: "apple", column1: "3" },
      ],
      rowCount: 2,
      truncated: false,
      hasHeader: true,
    });

    const result = await importSheetViaBackend("ws1", "blob-1");

    expect(result.document.tabOrder.length).toBe(1);
    // The engine's count, not the preview's — the mocked engine reports 1
    // where the preview said 2, and 1 is what actually landed.
    expect(result.rowCount).toBe(1);
    expect(result.truncated).toBe(false);
    // Passed through untouched — nothing is prepended — and `hasHeader` only
    // tells the importer to bold the row that is already first.
    expect(importTable).toHaveBeenLastCalledWith(
      [
        ["name", "qty"],
        ["apple", "3"],
      ],
      { hasHeader: true },
    );
  });

  // A headerless file differs only in the verdict: the rows are the same shape
  // either way, and `hasHeader: false` keeps the user's opening record plain.
  it("omits the column names when the file had no header", async () => {
    mockPreview({
      columns: [{ name: "column0" }, { name: "column1" }],
      rows: [{ column0: "apple", column1: "3" }],
      rowCount: 1,
      truncated: false,
      hasHeader: false,
    });

    await importSheetViaBackend("ws1", "blob-1");

    expect(importTable).toHaveBeenLastCalledWith([["apple", "3"]], {
      hasHeader: false,
    });
  });

  // Either side may cut: the server bounds what crosses the wire, the engine
  // bounds what a Yorkie document can hold.
  it("reports truncation when only the server cut the file", async () => {
    mockPreview({
      columns: [{ name: "a" }],
      rows: [{ a: "1" }],
      rowCount: 1,
      truncated: true,
      hasHeader: true,
    });

    const result = await importSheetViaBackend("ws1", "blob-1");

    expect(result.truncated).toBe(true);
  });

  it("pins column order by name, not by row-object key order", async () => {
    mockPreview({
      columns: [{ name: "column0" }, { name: "column1" }],
      // Key order here is the reverse of `columns`; the response is JSON, so
      // nothing guarantees the two agree.
      rows: [{ column1: "3", column0: "apple" }],
      rowCount: 1,
      truncated: false,
      hasHeader: false,
    });

    await importSheetViaBackend("ws1", "blob-1");

    expect(importTable).toHaveBeenLastCalledWith([["apple", "3"]], {
      hasHeader: false,
    });
  });
});
