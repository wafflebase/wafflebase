import type { SpreadsheetDocument, Worksheet } from "../../types/worksheet";

const LEGACY_MIGRATION_TAB_ID = "tab-1";
const LEGACY_MIGRATION_TAB_NAME = "Sheet1";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Returns true when the root matches the legacy flat worksheet shape.
 */
export function shouldMigrateLegacyDocument(root: UnknownRecord): boolean {
  return !("tabs" in root) && "sheet" in root;
}

/**
 * Converts a legacy flat worksheet root into SpreadsheetDocument.
 */
export function buildLegacySpreadsheetDocument(
  root: UnknownRecord,
): SpreadsheetDocument | null {
  if (!shouldMigrateLegacyDocument(root)) {
    return null;
  }

  const sheet = asRecord(root.sheet);
  if (!sheet) {
    return null;
  }

  const rowHeights = asRecord(root.rowHeights) ?? {};
  const colWidths = asRecord(root.colWidths) ?? {};
  const colStyles = asRecord(root.colStyles) ?? {};
  const rowStyles = asRecord(root.rowStyles) ?? {};
  const merges = asRecord(root.merges) ?? {};

  const worksheet: Worksheet = {
    sheet: sheet as Worksheet["sheet"],
    rowHeights: rowHeights as Worksheet["rowHeights"],
    colWidths: colWidths as Worksheet["colWidths"],
    colStyles: colStyles as Worksheet["colStyles"],
    rowStyles: rowStyles as Worksheet["rowStyles"],
    sheetStyle: root.sheetStyle as Worksheet["sheetStyle"],
    conditionalFormats: [],
    merges: merges as NonNullable<Worksheet["merges"]>,
    charts: {},
    frozenRows: asNumber(root.frozenRows, 0),
    frozenCols: asNumber(root.frozenCols, 0),
  };

  return {
    tabs: {
      [LEGACY_MIGRATION_TAB_ID]: {
        id: LEGACY_MIGRATION_TAB_ID,
        name: LEGACY_MIGRATION_TAB_NAME,
        type: "sheet",
      },
    },
    tabOrder: [LEGACY_MIGRATION_TAB_ID],
    sheets: {
      [LEGACY_MIGRATION_TAB_ID]: worksheet,
    },
  };
}
