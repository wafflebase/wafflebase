import { Sref } from "@wafflebase/sheet";

export type User = {
  authProvider: string;
  username: string;
  email: string;
  photo: string;
};

export type UserPresence = {
  activeCell: Sref;
} & User;
