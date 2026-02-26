import {
  Cell,
  CellStyle,
  ConditionalFormatRule,
  FilterCondition,
  MergeSpan,
  RangeStylePatch,
  Sref,
} from "@wafflebase/sheet";

export type ChartType = "bar" | "line";

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
};

export type ImageFit = "cover" | "contain";

export type SheetImage = {
  id: string;
  title?: string;
  alt?: string;
  key: string;
  contentType: string;
  anchor: Sref;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  fit: ImageFit;
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
  charts?: {
    [id: string]: SheetChart;
  };
  images?: {
    [id: string]: SheetImage;
  };
  frozenRows: number;
  frozenCols: number;
};

export type TabType = "sheet" | "datasource";

export type TabMeta = {
  id: string;
  name: string;
  type: TabType;
  datasourceId?: string;
  query?: string;
};

export type SpreadsheetDocument = {
  tabs: { [id: string]: TabMeta };
  tabOrder: string[];
  sheets: { [tabId: string]: Worksheet };
};

const DEFAULT_TAB_ID = "tab-1";

export const initialSpreadsheetDocument: SpreadsheetDocument = {
  tabs: {
    [DEFAULT_TAB_ID]: {
      id: DEFAULT_TAB_ID,
      name: "Sheet1",
      type: "sheet",
    },
  },
  tabOrder: [DEFAULT_TAB_ID],
  sheets: {
    [DEFAULT_TAB_ID]: {
      sheet: {},
      rowHeights: {},
      colWidths: {},
      colStyles: {},
      rowStyles: {},
      conditionalFormats: [],
      merges: {},
      charts: {},
      images: {},
      frozenRows: 0,
      frozenCols: 0,
    },
  },
};
