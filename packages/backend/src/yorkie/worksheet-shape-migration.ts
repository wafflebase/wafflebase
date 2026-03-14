import {
  cloneConditionalFormatRule,
  cloneRangeStylePatch,
  createSpreadsheetDocument,
  createWorksheet,
  parseRef,
  writeWorksheetCell,
  type Cell,
  type CellStyle,
  type ConditionalFormatRule,
  type MergeSpan,
  type PivotTableDefinition,
  type Range,
  type RangeStylePatch,
  type SpreadsheetDocument,
  type Sref,
  type TabMeta,
  type Worksheet,
  type WorksheetFilterState,
} from '@wafflebase/sheet';
import type { SheetChart } from './yorkie.types';

type LegacyWorksheet = {
  sheet?: Record<string, Cell>;
  rowHeights?: Record<string, number>;
  colWidths?: Record<string, number>;
  colStyles?: Record<string, CellStyle>;
  rowStyles?: Record<string, CellStyle>;
  sheetStyle?: CellStyle;
  rangeStyles?: RangeStylePatch[];
  conditionalFormats?: ConditionalFormatRule[];
  merges?: Record<Sref, MergeSpan>;
  filter?: WorksheetFilterState;
  hiddenRows?: number[];
  hiddenColumns?: number[];
  charts?: Record<string, SheetChart>;
  frozenRows?: number;
  frozenCols?: number;
  pivotTable?: PivotTableDefinition;
};

type LegacyTabbedDocument = {
  tabs: Record<string, TabMeta>;
  tabOrder: string[] | Record<string, unknown>;
  sheets: Record<string, Worksheet | LegacyWorksheet>;
};

export type WorksheetShapeMigrationKind =
  | 'current'
  | 'current-flat'
  | 'initialized-empty'
  | 'legacy-flat'
  | 'legacy-tabbed';

export type WorksheetShapeMigrationResult = {
  kind: WorksheetShapeMigrationKind;
  changed: boolean;
  document: SpreadsheetDocument;
  summary: {
    sheetCount: number;
    migratedSheetCount: number;
    cellCount: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneStyleRecord(
  record: Record<string, CellStyle> | undefined,
): Record<string, CellStyle> {
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, style]) => [key, { ...style }]),
  );
}

function cloneMergeRecord(
  merges: Record<Sref, MergeSpan> | undefined,
): Record<Sref, MergeSpan> {
  if (!merges) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(merges).map(([sref, span]) => [sref as Sref, { ...span }]),
  );
}

function cloneChartRecord(
  charts: Record<string, SheetChart> | undefined,
): Record<string, SheetChart> {
  if (!charts) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(charts).map(([id, chart]) => [
      id,
      {
        ...chart,
        seriesColumns: chart.seriesColumns ? [...chart.seriesColumns] : undefined,
      },
    ]),
  );
}

function cloneFilterState(
  filter: WorksheetFilterState | undefined,
): WorksheetFilterState | undefined {
  if (!filter) {
    return undefined;
  }

  return {
    startRow: filter.startRow,
    endRow: filter.endRow,
    startCol: filter.startCol,
    endCol: filter.endCol,
    columns: Object.fromEntries(
      Object.entries(filter.columns).map(([key, condition]) => [
        key,
        { ...condition, values: condition.values ? [...condition.values] : undefined },
      ]),
    ),
    hiddenRows: coerceIndexedArray<number>(filter.hiddenRows) ?? [],
  };
}

function cloneRangeStylePatches(
  patches: RangeStylePatch[] | Record<string, unknown> | undefined,
): RangeStylePatch[] | undefined {
  return coerceIndexedArray<RangeStylePatch>(patches)?.map((patch) =>
    cloneRangeStylePatch(patch),
  );
}

function cloneConditionalFormats(
  rules: ConditionalFormatRule[] | Record<string, unknown> | undefined,
): ConditionalFormatRule[] | undefined {
  return coerceIndexedArray<ConditionalFormatRule>(rules)?.map((rule) =>
    cloneConditionalFormatRule(rule),
  );
}

function cloneCell(cell: Cell): Cell {
  return {
    v: cell.v,
    f: cell.f,
    s: cell.s ? { ...cell.s } : undefined,
  };
}

function maxIndexFromKeys(record: Record<string, unknown> | undefined): number {
  if (!record) {
    return 0;
  }

  let max = 0;
  for (const key of Object.keys(record)) {
    const index = Number(key);
    if (Number.isInteger(index) && index > max) {
      max = index;
    }
  }

  return max;
}

function coerceIndexedArray<T>(value: unknown): T[] | undefined {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const indexedEntries = Object.entries(value)
    .filter(([key]) => /^\d+$/.test(key))
    .sort((left, right) => Number(left[0]) - Number(right[0]));

  if (indexedEntries.length === 0) {
    return undefined;
  }

  return indexedEntries.map(([, item]) => item as T);
}

function maxIndexFromList(values: number[] | Record<string, unknown> | undefined): number {
  const items = coerceIndexedArray<number>(values);
  if (!items || items.length === 0) {
    return 0;
  }
  return Math.max(0, ...items);
}

function maxIndexFromRange(range: Range | undefined, axis: 'row' | 'column'): number {
  if (!range) {
    return 0;
  }

  return axis === 'row'
    ? Math.max(range[0].r, range[1].r)
    : Math.max(range[0].c, range[1].c);
}

function maxIndexFromRanges<T>(
  values: T[] | Record<string, unknown> | undefined,
  getRange: (value: T) => Range,
  axis: 'row' | 'column',
): number {
  const items = coerceIndexedArray<T>(values);
  if (!items || items.length === 0) {
    return 0;
  }

  return items.reduce((max, value) => {
    return Math.max(max, maxIndexFromRange(getRange(value), axis));
  }, 0);
}

function maxIndexFromMerges(
  merges: Record<Sref, MergeSpan> | undefined,
  axis: 'row' | 'column',
): number {
  if (!merges) {
    return 0;
  }

  let max = 0;
  for (const [sref, span] of Object.entries(merges)) {
    const ref = parseRef(sref);
    const extent =
      axis === 'row' ? ref.r + span.rs - 1 : ref.c + span.cs - 1;
    max = Math.max(max, extent);
  }

  return max;
}

function maxIndexFromCharts(
  charts: Record<string, SheetChart> | undefined,
  axis: 'row' | 'column',
): number {
  if (!charts) {
    return 0;
  }

  let max = 0;
  for (const chart of Object.values(charts)) {
    const ref = parseRef(chart.anchor);
    max = Math.max(max, axis === 'row' ? ref.r : ref.c);
  }

  return max;
}

function maxIndexFromSheetCells(
  sheet: Record<string, Cell> | undefined,
  axis: 'row' | 'column',
): number {
  if (!sheet) {
    return 0;
  }

  let max = 0;
  for (const sref of Object.keys(sheet)) {
    const ref = parseRef(sref);
    max = Math.max(max, axis === 'row' ? ref.r : ref.c);
  }

  return max;
}

function buildAxisOrder(prefix: 'r' | 'c', length: number): string[] {
  return Array.from({ length }, (_, index) => `${prefix}${index + 1}`);
}

function isCurrentWorksheetShape(value: unknown): value is Worksheet {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRecord(value.cells) &&
    Array.isArray(value.rowOrder) &&
    Array.isArray(value.colOrder) &&
    typeof value.nextRowId === 'number' &&
    typeof value.nextColId === 'number'
  );
}

function isLegacyWorksheetShape(value: unknown): value is LegacyWorksheet {
  if (!isRecord(value)) {
    return false;
  }

  return (
    'sheet' in value ||
    'rowHeights' in value ||
    'colWidths' in value ||
    'colStyles' in value ||
    'rowStyles' in value ||
    'sheetStyle' in value ||
    'rangeStyles' in value ||
    'conditionalFormats' in value ||
    'merges' in value ||
    'filter' in value ||
    'hiddenRows' in value ||
    'hiddenColumns' in value ||
    'charts' in value ||
    'frozenRows' in value ||
    'frozenCols' in value ||
    'pivotTable' in value
  );
}

function isTabbedDocumentShape(value: unknown): value is LegacyTabbedDocument {
  return (
    isRecord(value) &&
    isRecord(value.tabs) &&
    (Array.isArray(value.tabOrder) || isRecord(value.tabOrder)) &&
    isRecord(value.sheets)
  );
}

function isEmptyRoot(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function summarizeWorksheetCells(worksheet: Worksheet): number {
  return Object.keys(worksheet.cells).length;
}

function normalizeTabOrder(
  tabOrderValue: LegacyTabbedDocument['tabOrder'],
  tabs: Record<string, TabMeta>,
): { tabOrder: string[]; changed: boolean } {
  const fallbackOrder = Object.keys(tabs);
  const indexedOrder = coerceIndexedArray<string>(tabOrderValue);

  if (!indexedOrder) {
    return {
      tabOrder: fallbackOrder,
      changed: fallbackOrder.length > 0,
    };
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tabId of indexedOrder) {
    if (
      typeof tabId === 'string' &&
      tabId in tabs &&
      !seen.has(tabId)
    ) {
      seen.add(tabId);
      normalized.push(tabId);
    }
  }

  for (const tabId of fallbackOrder) {
    if (!seen.has(tabId)) {
      normalized.push(tabId);
    }
  }

  const changed =
    normalized.length !== indexedOrder.length ||
    normalized.some((tabId, index) => tabId !== indexedOrder[index]);

  return { tabOrder: normalized, changed };
}

function migrateLegacyWorksheet(legacy: LegacyWorksheet): Worksheet {
  const maxRow = Math.max(
    maxIndexFromSheetCells(legacy.sheet, 'row'),
    maxIndexFromKeys(legacy.rowHeights),
    maxIndexFromKeys(legacy.rowStyles),
    maxIndexFromList(legacy.hiddenRows),
    legacy.frozenRows ?? 0,
    legacy.filter?.endRow ?? 0,
    maxIndexFromList(legacy.filter?.hiddenRows),
    maxIndexFromMerges(legacy.merges, 'row'),
    maxIndexFromRanges(legacy.rangeStyles, (patch) => patch.range, 'row'),
    maxIndexFromRanges(
      legacy.conditionalFormats,
      (rule) => rule.range,
      'row',
    ),
    maxIndexFromCharts(legacy.charts, 'row'),
  );
  const maxCol = Math.max(
    maxIndexFromSheetCells(legacy.sheet, 'column'),
    maxIndexFromKeys(legacy.colWidths),
    maxIndexFromKeys(legacy.colStyles),
    maxIndexFromList(legacy.hiddenColumns),
    legacy.frozenCols ?? 0,
    legacy.filter?.endCol ?? 0,
    maxIndexFromMerges(legacy.merges, 'column'),
    maxIndexFromRanges(legacy.rangeStyles, (patch) => patch.range, 'column'),
    maxIndexFromRanges(
      legacy.conditionalFormats,
      (rule) => rule.range,
      'column',
    ),
    maxIndexFromCharts(legacy.charts, 'column'),
  );

  const worksheet = createWorksheet({
    cells: {},
    rowOrder: buildAxisOrder('r', maxRow),
    colOrder: buildAxisOrder('c', maxCol),
    nextRowId: maxRow + 1,
    nextColId: maxCol + 1,
    rowHeights: legacy.rowHeights ? { ...legacy.rowHeights } : {},
    colWidths: legacy.colWidths ? { ...legacy.colWidths } : {},
    rowStyles: cloneStyleRecord(legacy.rowStyles),
    colStyles: cloneStyleRecord(legacy.colStyles),
    sheetStyle: legacy.sheetStyle ? { ...legacy.sheetStyle } : undefined,
    rangeStyles: cloneRangeStylePatches(legacy.rangeStyles),
    conditionalFormats: cloneConditionalFormats(legacy.conditionalFormats),
    merges: cloneMergeRecord(legacy.merges),
    filter: cloneFilterState(legacy.filter),
    hiddenRows: coerceIndexedArray<number>(legacy.hiddenRows),
    hiddenColumns: coerceIndexedArray<number>(legacy.hiddenColumns),
    charts: cloneChartRecord(legacy.charts),
    frozenRows: legacy.frozenRows ?? 0,
    frozenCols: legacy.frozenCols ?? 0,
    pivotTable: legacy.pivotTable ? clone(legacy.pivotTable) : undefined,
  });

  for (const [sref, cell] of Object.entries(legacy.sheet ?? {})) {
    writeWorksheetCell(worksheet, parseRef(sref), cloneCell(cell));
  }

  return worksheet;
}

function migrateLegacyTabbedDocument(
  legacy: LegacyTabbedDocument,
): WorksheetShapeMigrationResult {
  const tabs = clone(legacy.tabs);
  const { tabOrder, changed: tabOrderChanged } = normalizeTabOrder(
    legacy.tabOrder,
    tabs,
  );
  const sheets: Record<string, Worksheet> = {};
  let migratedSheetCount = 0;
  let cellCount = 0;

  for (const [tabId, sheet] of Object.entries(legacy.sheets)) {
    if (isCurrentWorksheetShape(sheet)) {
      sheets[tabId] = clone(sheet);
    } else if (isLegacyWorksheetShape(sheet)) {
      sheets[tabId] = migrateLegacyWorksheet(sheet);
      migratedSheetCount += 1;
    } else {
      throw new Error(`Unsupported worksheet shape for tab ${tabId}`);
    }

    cellCount += summarizeWorksheetCells(sheets[tabId]);
  }

  return {
    kind:
      migratedSheetCount === 0 && !tabOrderChanged
        ? 'current'
        : 'legacy-tabbed',
    changed: migratedSheetCount > 0 || tabOrderChanged,
    document: {
      tabs,
      tabOrder,
      sheets,
    },
    summary: {
      sheetCount: Object.keys(sheets).length,
      migratedSheetCount,
      cellCount,
    },
  };
}

export function migrateYorkieWorksheetShape(
  root: unknown,
): WorksheetShapeMigrationResult {
  if (isEmptyRoot(root)) {
    const document = createSpreadsheetDocument();
    return {
      kind: 'initialized-empty',
      changed: true,
      summary: {
        sheetCount: 1,
        migratedSheetCount: 1,
        cellCount: 0,
      },
      document,
    };
  }

  if (isTabbedDocumentShape(root)) {
    return migrateLegacyTabbedDocument(root);
  }

  if (isCurrentWorksheetShape(root)) {
    const worksheet = clone(root);
    const document = createSpreadsheetDocument({ worksheet });
    return {
      kind: 'current-flat',
      changed: true,
      summary: {
        sheetCount: 1,
        migratedSheetCount: 1,
        cellCount: summarizeWorksheetCells(worksheet),
      },
      document,
    };
  }

  if (isLegacyWorksheetShape(root)) {
    const worksheet = migrateLegacyWorksheet(root);
    const document = createSpreadsheetDocument({ worksheet });
    return {
      kind: 'legacy-flat',
      changed: true,
      summary: {
        sheetCount: 1,
        migratedSheetCount: 1,
        cellCount: summarizeWorksheetCells(worksheet),
      },
      document,
    };
  }

  throw new Error('Unsupported Yorkie spreadsheet document shape');
}
