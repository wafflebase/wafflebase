/**
 * Mention encoding for comment bodies — the editor's view of it.
 *
 * The token grammar (`@[username](userId)`) itself lives in
 * `@wafflebase/sheets`' `comment/mentions.ts`, beside the `Comment` it is
 * written into, because the backend's `/api/v1` comment routes read the same
 * tokens to decide who a comment notifies. This module re-exports it unchanged
 * and adds the two helpers only a composer needs.
 *
 * Design: docs/design/comments-mentions.md
 */

import { serializeMention } from "@wafflebase/sheets";

export type { BodySegment, MentionRef } from "@wafflebase/sheets";
export {
  serializeMention,
  parseMentionBody,
  mentionBodyToPlainText,
  extractMentionedUserIds,
} from "@wafflebase/sheets";

import type { MentionRef } from "@wafflebase/sheets";

// A mention query runs after an `@` whose preceding char is start-of-text or
// anything that is not a username character (`[A-Za-z0-9-]`). That excludes
// `email@host` (preceded by a letter) while still triggering after CJK text
// typed with no space (`안녕@kim`). The query itself excludes whitespace and
// `@`, so the `$`-anchored match always picks the last in-progress mention.
const MENTION_QUERY_RE = /(?:^|[^A-Za-z0-9-])@([^\s@]*)$/;

/**
 * Inspect the text up to `caret` and return the in-progress mention query
 * (the run after an `@` at a word boundary), or `null` when the caret is not
 * inside one. `start` is the index of the `@`.
 */
export function detectMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = MENTION_QUERY_RE.exec(before);
  if (!match) return null;
  const query = match[1];
  return { query, start: caret - query.length - 1 };
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
function escapeRegExp(value: string): string {
  return value.replace(REGEX_SPECIALS, "\\$&");
}

/**
 * Convert the plain `@username` text of *selected* mentions into
 * `@[username](userId)` tokens (approach B — tokenize on submit). Longer
 * usernames are processed first so a shorter one can't match inside a longer
 * one, and a trailing-boundary lookahead means an edited mention
 * (`@kim` → `@kimX`) is left as plain text rather than emitting a broken
 * token. Usernames are GitHub logins (`[A-Za-z0-9-]`, unique), so keying by
 * username is unambiguous and the boundary class matches the login charset —
 * a following non-login char (space, punctuation, CJK particle) ends the
 * mention cleanly.
 */
export function applySelectedMentions(
  body: string,
  mentions: ReadonlyArray<MentionRef>,
): string {
  const byUsername = new Map<string, MentionRef>();
  for (const m of mentions) byUsername.set(m.username, m);
  const ordered = [...byUsername.values()].sort(
    (a, b) => b.username.length - a.username.length,
  );
  let result = body;
  for (const ref of ordered) {
    const re = new RegExp(
      `@${escapeRegExp(ref.username)}(?![A-Za-z0-9-])`,
      "g",
    );
    result = result.replace(re, serializeMention(ref));
  }
  return result;
}
