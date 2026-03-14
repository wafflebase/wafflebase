import type {
  Cell,
  CellStyle,
  ConditionalFormatRule,
  FilterCondition,
  MergeSpan,
  PivotTableDefinition,
  Sref,
} from '../core/types';
import type { RangeStylePatch } from '../worksheet/range-styles';

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'scatter';

export type SheetChart = {
  id: string;
  type: ChartType;
  title?: string;
  sourceTabId: string;
  sourceRange: string;
  xAxisColumn?: string;
  seriesColumns?: string[];
  anchor: Sref;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  legendPosition?: 'top' | 'bottom' | 'right' | 'left' | 'none';
  showGridlines?: boolean;
  colorPalette?: string;
};

export type WorksheetFilterState = {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  columns: {
    [key: string]: FilterCondition;
  };
  hiddenRows: number[];
};

export type Worksheet = {
  cells: {
    [key: string]: Cell;
  };
  rowOrder: string[];
  colOrder: string[];
  nextRowId: number;
  nextColId: number;
  rowHeights: {
    [key: string]: number;
  };
  colWidths: {
    [key: string]: number;
  };
  colStyles: {
    [key: string]: CellStyle;
  };
  rowStyles: {
    [key: string]: CellStyle;
  };
  sheetStyle?: CellStyle;
  rangeStyles?: RangeStylePatch[];
  conditionalFormats?: ConditionalFormatRule[];
  merges?: {
    [key: Sref]: MergeSpan;
  };
  filter?: WorksheetFilterState;
  hiddenRows?: number[];
  hiddenColumns?: number[];
  charts?: {
    [id: string]: SheetChart;
  };
  frozenRows: number;
  frozenCols: number;
  pivotTable?: PivotTableDefinition;
};

export type TabType = 'sheet' | 'datasource';

export type SheetKind = 'normal' | 'pivot';

export type TabMeta = {
  id: string;
  name: string;
  type: TabType;
  kind?: SheetKind;
  datasourceId?: string;
  query?: string;
};

export type SpreadsheetDocument = {
  tabs: { [id: string]: TabMeta };
  tabOrder: string[];
  sheets: { [tabId: string]: Worksheet };
};

export const DEFAULT_TAB_ID = 'tab-1';
export const DEFAULT_TAB_NAME = 'Sheet1';

export function createWorksheet(
  overrides: Partial<Worksheet> = {},
): Worksheet {
  return {
    cells: {},
    rowOrder: [],
    colOrder: [],
    nextRowId: 1,
    nextColId: 1,
    rowHeights: {},
    colWidths: {},
    colStyles: {},
    rowStyles: {},
    conditionalFormats: [],
    merges: {},
    charts: {},
    frozenRows: 0,
    frozenCols: 0,
    ...overrides,
  };
}

export function createSpreadsheetDocument(options?: {
  tabId?: string;
  tabName?: string;
  worksheet?: Worksheet;
}): SpreadsheetDocument {
  const tabId = options?.tabId ?? DEFAULT_TAB_ID;
  const tabName = options?.tabName ?? DEFAULT_TAB_NAME;
  const worksheet = options?.worksheet ?? createWorksheet();

  return {
    tabs: {
      [tabId]: {
        id: tabId,
        name: tabName,
        type: 'sheet',
      },
    },
    tabOrder: [tabId],
    sheets: {
      [tabId]: worksheet,
    },
  };
}

export const initialSpreadsheetDocument = createSpreadsheetDocument();
