import { Cell, CellStyle, Sref } from "@wafflebase/sheet";

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
  frozenRows: number;
  frozenCols: number;
};

export const initialWorksheet: Worksheet = {
  sheet: {},
  rowHeights: {},
  colWidths: {},
  colStyles: {},
  rowStyles: {},
  frozenRows: 0,
  frozenCols: 0,
};
