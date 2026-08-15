import { beforeEach, describe, it, expect, vi } from "vitest";

const sheetsMocks = vi.hoisted(() => ({
  importXlsxWorkbook: vi.fn(async () => [
    {
      name: "S1",
      worksheet: {},
      cellCount: 0,
      rowCount: 0,
      columnCount: 0,
    },
  ]),
  importJsonText: vi.fn((_text: string, options: { sheetName: string }) => ({
    name: options.sheetName,
    worksheet: {},
    cellCount: 1,
    rowCount: 2,
    columnCount: 1,
  })),
  // Distinctive values, so asserting them proves `importSheetFile` carries the
  // budget result through rather than defaulting it. Real parsing is covered
  // where the parser lives, in `csv-actions.test.ts`.
  createTableWriter: vi.fn((options?: { sheetName?: string }) => ({
    push: () => true,
    finish: () => ({
      name: options?.sheetName ?? "",
      worksheet: {},
      cellCount: 14,
      rowCount: 7,
      columnCount: 2,
      truncated: true,
    }),
  })),
}));

vi.mock("@wafflebase/sheets", () => ({
  importXlsxWorkbook: sheetsMocks.importXlsxWorkbook,
  importJsonText: sheetsMocks.importJsonText,
  createTableWriter: sheetsMocks.createTableWriter,
  // `xlsx-actions` reaches `getUniqueTabName` via the `tab-name` re-export,
  // which now resolves through this module, so the mock must provide it.
  getUniqueTabName: (
    _tabs: Record<string, unknown>,
    preferred: string,
    fallback: string,
  ) => preferred || fallback,
}));

import { importXlsx } from "@/app/spreadsheet/xlsx-actions";
import { importSheetFile } from "@/app/spreadsheet/sheet-import-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importXlsx (File-taking core)", () => {
  it("parses a File into a SpreadsheetDocument without a picker", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "Budget.xlsx");
    const { document, fileName } = await importXlsx(file);
    expect(fileName).toBe("Budget.xlsx");
    expect(document.tabOrder.length).toBe(1);
  });
});

describe("importSheetFile", () => {
  it("keeps XLSX routed through the existing workbook importer", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "Budget.xlsx");

    const { document } = await importSheetFile(file);

    expect(sheetsMocks.importXlsxWorkbook).toHaveBeenCalledOnce();
    expect(document.tabs["tab-1"].name).toBe("S1");
  });

  it("imports JSON with a file-name tab and automatic format detection", async () => {
    const file = new File(['{"name":"Alice"}'], "people.JSON", {
      type: "application/json",
    });

    const { document, fileName } = await importSheetFile(file);

    expect(fileName).toBe("people.JSON");
    expect(sheetsMocks.importJsonText).toHaveBeenCalledWith(
      '{"name":"Alice"}',
      { sheetName: "people", mode: "auto" },
    );
    expect(document.tabs["tab-1"].name).toBe("people");
  });

  it("uses line-delimited parsing for JSONL and NDJSON files", async () => {
    await importSheetFile(new File(['{"id":1}'], "events.jsonl"));
    await importSheetFile(new File(['{"id":2}'], "events.ndjson"));

    expect(sheetsMocks.importJsonText).toHaveBeenNthCalledWith(
      1,
      '{"id":1}',
      { sheetName: "events", mode: "ndjson" },
    );
    expect(sheetsMocks.importJsonText).toHaveBeenNthCalledWith(
      2,
      '{"id":2}',
      { sheetName: "events", mode: "ndjson" },
    );
  });

  it("streams CSV and TSV through the table writer, carrying the budget result", async () => {
    const { document, fileName, truncated, rowCount } = await importSheetFile(
      new File(["name,qty\napple,3\n"], "produce.CSV"),
    );

    expect(fileName).toBe("produce.CSV");
    expect(sheetsMocks.createTableWriter).toHaveBeenCalledWith({
      sheetName: "produce",
    });
    expect(document.tabs["tab-1"].name).toBe("produce");
    // The queue's truncation warning reads off these two; nothing else in the
    // sheet path reports them, so they have to survive this hop.
    expect(truncated).toBe(true);
    expect(rowCount).toBe(7);

    const tsv = await importSheetFile(new File(["a\tb\n1\t2\n"], "grid.tsv"));
    expect(tsv.document.tabs["tab-1"].name).toBe("grid");
  });

  it("rejects unsupported sheet formats", async () => {
    await expect(
      importSheetFile(new File(["a,b"], "legacy.xls")),
    ).rejects.toThrow(/Unsupported sheet import format/);
  });
});
