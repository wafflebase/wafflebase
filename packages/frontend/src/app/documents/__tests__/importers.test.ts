import { describe, it, expect, vi } from "vitest";

vi.mock("@wafflebase/sheets", () => ({
  importXlsxWorkbook: vi.fn(async () => [{ name: "S1", worksheet: {} }]),
  // `xlsx-actions` reaches `getUniqueTabName` via the `tab-name` re-export,
  // which now resolves through this module, so the mock must provide it.
  getUniqueTabName: (
    _tabs: Record<string, unknown>,
    preferred: string,
    fallback: string,
  ) => preferred || fallback,
}));

import { importXlsx } from "@/app/spreadsheet/xlsx-actions";

describe("importXlsx (File-taking core)", () => {
  it("parses a File into a SpreadsheetDocument without a picker", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "Budget.xlsx");
    const { document, fileName } = await importXlsx(file);
    expect(fileName).toBe("Budget.xlsx");
    expect(document.tabOrder.length).toBe(1);
  });
});
