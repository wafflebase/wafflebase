import type { Sref } from "@wafflebase/sheets";

export type User = {
  id: number;
  authProvider: string;
  username: string;
  email: string;
  photo: string;
};

export type UserPresence = {
  activeCell?: Sref;
  activeTabId?: string;
} & User;

export type DocsPresence = {
  username: string;
  email: string;
  photo: string;
  activeCursorPos?: {
    blockId: string;
    offset: number;
  };
  activeSelection?: {
    anchor: { blockId: string; offset: number };
    focus: { blockId: string; offset: number };
    tableCellRange?: {
      blockId: string;
      start: { rowIndex: number; colIndex: number };
      end: { rowIndex: number; colIndex: number };
    };
  };
};
