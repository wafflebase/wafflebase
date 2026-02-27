import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacySpreadsheetDocument,
  shouldMigrateLegacyDocument,
} from "./migration.ts";

type UnknownRecord = Record<string, unknown>;

function buildLegacyRoot(overrides: UnknownRecord = {}): UnknownRecord {
  return {
    sheet: {
      A1: { v: "Name" },
      B2: { v: "42" },
    },
    rowHeights: { "1": 32 },
    colWidths: { "2": 160 },
    colStyles: { "2": { b: true } },
    rowStyles: { "1": { i: true } },
    sheetStyle: { tc: "#000000" },
    merges: { A1: { rs: 2, cs: 2 } },
    frozenRows: 2,
    frozenCols: 1,
    ...overrides,
  };
}

test("shouldMigrateLegacyDocument detects legacy flat roots", () => {
  assert.equal(shouldMigrateLegacyDocument(buildLegacyRoot()), true);
  assert.equal(shouldMigrateLegacyDocument({ tabs: {}, sheet: {} }), false);
  assert.equal(shouldMigrateLegacyDocument({ rowHeights: {} }), false);
});

test("buildLegacySpreadsheetDocument preserves legacy worksheet data", () => {
  const migrated = buildLegacySpreadsheetDocument(buildLegacyRoot());
  assert.ok(migrated);
  assert.equal(migrated.tabOrder[0], "tab-1");
  assert.deepEqual(migrated.tabs["tab-1"], {
    id: "tab-1",
    name: "Sheet1",
    type: "sheet",
  });

  const worksheet = migrated.sheets["tab-1"];
  assert.equal(worksheet.sheet.A1?.v, "Name");
  assert.equal(worksheet.rowHeights["1"], 32);
  assert.equal(worksheet.colWidths["2"], 160);
  assert.deepEqual(worksheet.merges, { A1: { rs: 2, cs: 2 } });
  assert.equal(worksheet.frozenRows, 2);
  assert.equal(worksheet.frozenCols, 1);
});

test("buildLegacySpreadsheetDocument applies defaults for missing fields", () => {
  const migrated = buildLegacySpreadsheetDocument(
    buildLegacyRoot({
      rowHeights: undefined,
      colWidths: undefined,
      colStyles: undefined,
      rowStyles: undefined,
      merges: undefined,
      frozenRows: undefined,
      frozenCols: undefined,
    }),
  );
  assert.ok(migrated);

  const worksheet = migrated.sheets["tab-1"];
  assert.deepEqual(worksheet.rowHeights, {});
  assert.deepEqual(worksheet.colWidths, {});
  assert.deepEqual(worksheet.colStyles, {});
  assert.deepEqual(worksheet.rowStyles, {});
  assert.deepEqual(worksheet.merges, {});
  assert.equal(worksheet.frozenRows, 0);
  assert.equal(worksheet.frozenCols, 0);
  assert.deepEqual(worksheet.conditionalFormats, []);
  assert.deepEqual(worksheet.charts, {});
});

test("buildLegacySpreadsheetDocument returns null for non-legacy roots", () => {
  assert.equal(buildLegacySpreadsheetDocument({ tabs: {}, tabOrder: [] }), null);
  assert.equal(buildLegacySpreadsheetDocument({ sheet: null }), null);
});
