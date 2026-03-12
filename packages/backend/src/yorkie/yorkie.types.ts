/**
 * Backend-local copies of the spreadsheet document types.
 * Duplicated from packages/frontend/src/types/worksheet.ts to avoid
 * a cross-package dependency on the frontend.
 */
import type {
  Cell,
  CellStyle,
  ConditionalFormatRule,
  FilterCondition,
  MergeSpan,
  PivotTableDefinition,
  RangeStylePatch,
  Sref,
} from '@wafflebase/sheet';

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
  sheet: {
    [key: Sref]: Cell;
  };
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
