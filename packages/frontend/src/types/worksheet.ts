import { Cell, CellStyle, MergeSpan, Sref } from "@wafflebase/sheet";

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
  merges?: {
    [key: Sref]: MergeSpan;
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
      merges: {},
      frozenRows: 0,
      frozenCols: 0,
    },
  },
};
