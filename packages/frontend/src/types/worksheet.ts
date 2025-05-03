import { Cell, Sref } from "@wafflebase/sheet";

export type Worksheet = {
  sheet: {
    [key: Sref]: Cell;
  };
};

export const initialWorksheet: Worksheet = {
  sheet: {},
};
