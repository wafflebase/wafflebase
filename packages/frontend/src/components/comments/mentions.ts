/**
 * Mention encoding for comment bodies.
 *
 * A mention is stored inline in the plain-string `Comment.body` as a token:
 *
 *     @[username](userId)
 *
 * Embedding the `userId` keeps rendering stable across username changes and
 * duplicates. The token is opaque text to every `CommentStore` and to the
 * `@wafflebase/*` packages, so this feature needs no data-model change.
 *
 * Design: docs/design/comments-mentions.md
 */

export type MentionRef = { userId: string; username: string };

export type BodySegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; userId: string; username: string };

// `username` is any run of characters except `]`; `userId` any run except `)`.
// A literal `@[…](…)` only matches when both brackets close in order, so
// stray `@[` or `@[name]` text is preserved verbatim by `parseMentionBody`.
const MENTION_RE = /@\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * Encode a mention as `@[username](userId)`. The username's `]` and the
 * userId's `)` are stripped so the produced token can never be ambiguous to
 * the parser.
 */
export function serializeMention({ userId, username }: MentionRef): string {
  const safeUsername = username.replace(/\]/g, '');
  const safeUserId = userId.replace(/\)/g, '');
  return `@[${safeUsername}](${safeUserId})`;
}

/**
 * Split a body into ordered text and mention segments. Adjacent mentions
 * produce no empty text segment between them, and an empty body yields `[]`.
 */
export function parseMentionBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let lastIndex = 0;
  // Fresh lastIndex per call: MENTION_RE is a shared global-flagged regex.
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: body.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'mention', username: match[1], userId: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    segments.push({ type: 'text', value: body.slice(lastIndex) });
  }
  return segments;
}

// A mention query continues until whitespace; the char before `@` must be
// start-of-text or whitespace so `email@host` never triggers the dropdown.
const MENTION_QUERY_RE = /(?:^|\s)@(\S*)$/;

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
  return value.replace(REGEX_SPECIALS, '\\$&');
}

/**
 * Convert the plain `@username` text of *selected* mentions into
 * `@[username](userId)` tokens (approach B — tokenize on submit). Longer
 * usernames are processed first so a shorter one can't match inside a longer
 * one, and a trailing-boundary lookahead means an edited mention
 * (`@kim` → `@kimX`) is left as plain text rather than emitting a broken
 * token. GitHub usernames are unique, so keying by username is unambiguous.
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
      'g',
    );
    result = result.replace(re, serializeMention(ref));
  }
  return result;
}

/**
 * Flatten a body to readable plain text, rendering each mention as
 * `@username`. For truncated previews (side-panel snippet) where chips
 * cannot be shown but the raw token must not leak.
 */
export function mentionBodyToPlainText(body: string): string {
  return parseMentionBody(body)
    .map((segment) =>
      segment.type === 'text' ? segment.value : `@${segment.username}`,
    )
    .join('');
}

/**
 * The userIds mentioned in a body, in first-seen order and de-duplicated.
 * Single integration point a future notification feature consumes.
 */
export function extractMentionedUserIds(body: string): string[] {
  const ids: string[] = [];
  for (const segment of parseMentionBody(body)) {
    if (segment.type === 'mention' && !ids.includes(segment.userId)) {
      ids.push(segment.userId);
    }
  }
  return ids;
}
