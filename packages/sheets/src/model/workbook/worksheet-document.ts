import type {
  Cell,
  CellStyle,
  ConditionalFormatRule,
  DataValidationRule,
  FilterCondition,
  MergeSpan,
  PivotTableDefinition,
  Sref,
} from '../core/types';
import type { RangeStylePatch } from '../worksheet/range-styles';
import type { Thread } from '../../comment/types';

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

export type SheetImage = {
  id: string;
  src: string;
  anchor: Sref;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  alt?: string;
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
  dataValidations?: DataValidationRule[];
  merges?: {
    [key: Sref]: MergeSpan;
  };
  filter?: WorksheetFilterState;
  hiddenRows?: number[];
  hiddenColumns?: number[];
  charts?: {
    [id: string]: SheetChart;
  };
  images?: {
    [id: string]: SheetImage;
  };
  comments?: {
    [threadId: string]: Thread;
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

export function createWorksheet(overrides: Partial<Worksheet> = {}): Worksheet {
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
    dataValidations: [],
    merges: {},
    charts: {},
    images: {},
    // Seed `comments` at creation for the same reason as the other map
    // containers: Yorkie resolves concurrent assignment of the same object
    // key by LWW. If the map were instead created lazily on first comment
    // (`if (!ws.comments) ws.comments = {}`), two users adding the first
    // comment concurrently would each create a fresh map and one — with its
    // thread — would be dropped wholesale. A shared container means
    // concurrent inserts only set distinct keys, which merge.
    comments: {},
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

export function initialSpreadsheetDocument(): SpreadsheetDocument {
  return createSpreadsheetDocument();
}
