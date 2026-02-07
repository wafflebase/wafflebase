import { Cell, Sref } from "@wafflebase/sheet";

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
};

export const initialWorksheet: Worksheet = {
  sheet: {},
  rowHeights: {},
  colWidths: {},
};
