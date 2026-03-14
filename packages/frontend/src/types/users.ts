import type { Sref } from "@wafflebase/sheet";

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
