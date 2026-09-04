/**
 * Mention encoding for comment bodies.
 *
 * A mention is stored inline in the plain-string `Comment.body` as a token:
 *
 *     @[username](userId)
 *
 * Embedding the `userId` keeps rendering stable across username changes and
 * duplicates. The token is opaque text to every `CommentStore`, so this feature
 * needs no data-model change.
 *
 * The grammar lives here, next to the `Comment` it is written into, because it
 * has **two** readers now: the editor, which renders chips and flattens bodies
 * for previews, and the backend's `/api/v1` comment routes, which read the same
 * tokens to decide who a comment notifies. Two copies of this regex would drift
 * into two different answers about who gets told.
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

/**
 * Flatten a body to readable plain text, rendering each mention as
 * `@username`. For truncated previews (side-panel snippet, notification
 * preview) where chips cannot be shown but the raw token must not leak.
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
 * Single integration point the notification planner consumes.
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
