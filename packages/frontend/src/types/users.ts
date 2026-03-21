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
