import { ChatUserSummary, UserKind } from './chat.types';

/** The `User` columns every chat summary of a person or bot is built from. */
export const USER_SUMMARY_SELECT = {
  id: true,
  username: true,
  photo: true,
  kind: true,
} as const;

/** A row read with `USER_SUMMARY_SELECT`. */
export interface UserSummaryRow {
  id: number;
  username: string;
  photo: string | null;
  kind: string;
}

/**
 * The summary a chat DTO carries. `kind` is a free-form column in the
 * database; anything but `bot` reads as a person, so an unexpected value
 * never dresses somebody up as a bot.
 */
export function toUserSummary(row: UserSummaryRow): ChatUserSummary {
  const kind: UserKind = row.kind === 'bot' ? 'bot' : 'person';
  return { id: row.id, username: row.username, photo: row.photo, kind };
}
