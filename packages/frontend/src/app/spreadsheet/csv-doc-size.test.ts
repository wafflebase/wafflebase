import { Document } from "@yorkie-js/sdk";
import {
  createSpreadsheetDocument,
  createTableWriter,
  MAX_IMPORT_CELLS,
  type SpreadsheetDocument,
} from "@wafflebase/sheets";
import { describe, expect, it } from "vitest";

/**
 * Yorkie's per-document byte ceiling — the thing `MAX_IMPORT_CELLS` exists to
 * stay under.
 *
 * Not a guess: `yorkie project ls` against the server this app attaches to
 * reports `MaxSizePerDocument: 10485760`, which is the default `NewProjectInfo`
 * assigns (`yorkie/server/backend/database/project_info.go`) and which nothing
 * in this repo overrides. Go past it and `doc.update()` throws `document size
 * exceeds the limit` — an unrecoverable failure at persist time, long after the
 * user picked the file, which is exactly the experience the cap prevents.
 */
const MAX_SIZE_PER_DOCUMENT = 10_485_760;

/**
 * Total document bytes, matching what the server enforces: `DocSize.Total()`
 * sums live *and* garbage data plus metadata
 * (`yorkie/pkg/document/document.go`).
 */
function totalDocSize(doc: Document<SpreadsheetDocument>): number {
  const { live, gc } = doc.getDocSize();
  return live.data + live.meta + gc.data + gc.meta;
}

/**
 * Builds a table of the given shape and measures it as a Yorkie document the
 * way a real import persists — the same `tabs`/`tabOrder`/`sheets` overwrite
 * `applyImportedContent` performs.
 *
 * No server is needed: `getDocSize()` is maintained on the local CRDT root. The
 * *limit* is only known after attach, which is why enforcement is checked
 * separately against a live server.
 */
function measure(
  cols: number,
  rows: number,
  valueLength = 8,
): { bytes: number; cells: number } {
  const writer = createTableWriter();
  const row = Array.from({ length: cols }, (_, c) =>
    `v${c}`.padEnd(valueLength, "x"),
  );
  for (let r = 0; r < rows; r++) writer.push(row);
  const parsed = createSpreadsheetDocument({ worksheet: writer.finish().worksheet });

  const doc = new Document<SpreadsheetDocument>("measure-doc-size");
  doc.update((r) => {
    r.tabs = parsed.tabs;
    r.tabOrder = parsed.tabOrder;
    r.sheets = parsed.sheets;
  });
  return { bytes: totalDocSize(doc), cells: cols * rows };
}

// Bytes per cell is shape-dependent — a tall table pays for more row axis ids,
// a wide one for more column ids — so the cap must hold for the *worst* shape,
// not the average.
const SHAPES: Array<[cols: number, rows: number]> = [
  [3, 1_000],
  [10, 1_000],
  [50, 200],
  [200, 50],
];

describe("Yorkie document size vs the import cell budget", () => {
  it("reports bytes per cell across table shapes", () => {
    const report = SHAPES.map(([cols, rows]) => {
      const { bytes, cells } = measure(cols, rows);
      return { shape: `${cols}x${rows}`, cells, bytes, perCell: bytes / cells };
    });

    // Printed so the numbers behind MAX_IMPORT_CELLS are reproducible rather
    // than folklore in a comment.
    console.table(
      report.map((r) => ({
        shape: r.shape,
        cells: r.cells,
        bytes: r.bytes,
        "B/cell": r.perCell.toFixed(1),
      })),
    );

    for (const row of report) {
      expect(row.perCell).toBeGreaterThan(0);
    }
  });

  it("keeps a full cell budget of short values well under the cap", () => {
    // Makes MAX_IMPORT_CELLS a derived number: if the per-cell CRDT cost ever
    // grows past what the ceiling allows, this fails here rather than as
    // `document size exceeds the limit` in a user's browser.
    const worstPerCell = Math.max(
      ...SHAPES.map(([cols, rows]) => {
        const { bytes, cells } = measure(cols, rows);
        return bytes / cells;
      }),
    );

    const projected = worstPerCell * MAX_IMPORT_CELLS;
    console.log(
      `worst ${worstPerCell.toFixed(1)} B/cell x ${MAX_IMPORT_CELLS} cells = ` +
        `${Math.round(projected)} bytes of the ${MAX_SIZE_PER_DOCUMENT} cap ` +
        `(${((projected / MAX_SIZE_PER_DOCUMENT) * 100).toFixed(0)}%)`,
    );

    expect(projected).toBeLessThan(MAX_SIZE_PER_DOCUMENT / 2);
  });

  it("stops a text-heavy file on the byte budget, before the cap", () => {
    // The case a cell count alone cannot catch: a column of prose costs several
    // times what a short value does, so a file can exhaust the document long
    // before it exhausts MAX_IMPORT_CELLS. The writer's byte budget is what
    // truncates here — and the result must still fit.
    const writer = createTableWriter();
    const prose = "x".repeat(200);
    const row = [prose, prose, prose, prose, prose];
    // Far more rows than the byte budget can hold; push until it says stop.
    let pushed = 0;
    while (pushed < 20_000 && writer.push(row)) pushed += 1;
    const result = writer.finish();

    expect(result.truncated).toBe(true);
    // Truncated by bytes, not by cell count — it never got near 40,000 cells.
    expect(result.cellCount).toBeLessThan(MAX_IMPORT_CELLS);

    const parsed = createSpreadsheetDocument({ worksheet: result.worksheet });
    const doc = new Document<SpreadsheetDocument>("measure-text-heavy");
    doc.update((r) => {
      r.tabs = parsed.tabs;
      r.tabOrder = parsed.tabOrder;
      r.sheets = parsed.sheets;
    });
    const bytes = totalDocSize(doc);
    console.log(
      `text-heavy (200-char cells): ${result.rowCount} rows, ` +
        `${result.cellCount} cells, ${bytes} bytes ` +
        `(${((bytes / MAX_SIZE_PER_DOCUMENT) * 100).toFixed(0)}% of cap)`,
    );

    expect(bytes).toBeLessThan(MAX_SIZE_PER_DOCUMENT);
  });

  it("stops a date/currency-heavy file on the byte budget, before the cap", () => {
    // Regression for a code review finding: the byte estimator used to count
    // only `cell.v.length`, ignoring the `s` style object that a date,
    // percent, or currency cell gets from `applyInferredFormat` — so a column
    // of dates or prices (both common in real CSVs) was undercounted by
    // roughly 2x and could carry an import past the real Yorkie ceiling while
    // the budget still reported headroom. This table is entirely styled
    // cells, at the full column width the earlier plain-text test used.
    const writer = createTableWriter();
    const row = ["2026-08-06", "$1,234.00", "50%", "2026-01-15", "$99.99"];
    let pushed = 0;
    while (pushed < 40_000 && writer.push(row)) pushed += 1;
    const result = writer.finish();

    expect(result.truncated).toBe(true);
    expect(result.cellCount).toBeLessThan(MAX_IMPORT_CELLS);

    const parsed = createSpreadsheetDocument({ worksheet: result.worksheet });
    const doc = new Document<SpreadsheetDocument>("measure-styled-heavy");
    doc.update((r) => {
      r.tabs = parsed.tabs;
      r.tabOrder = parsed.tabOrder;
      r.sheets = parsed.sheets;
    });
    const bytes = totalDocSize(doc);
    console.log(
      `date/currency-heavy: ${result.rowCount} rows, ` +
        `${result.cellCount} cells, ${bytes} bytes ` +
        `(${((bytes / MAX_SIZE_PER_DOCUMENT) * 100).toFixed(0)}% of cap)`,
    );

    // The actual assertion this regression is about: real bytes must stay
    // under the real ceiling, not just under what the (previously wrong)
    // estimator predicted.
    expect(bytes).toBeLessThan(MAX_SIZE_PER_DOCUMENT);
  }, 15_000); // 40,000 pushes + a real Document build; flaked at the 5s default under full-suite parallel load
});
