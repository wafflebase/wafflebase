# Comment Mentions — Todo

Implements `@user` mentions in comments (mention-only; notifications
deferred). Design: `docs/design/comments-mentions.md`. Continuation of the
`docs-comments-followup` roadmap Step 4 (the `+ notifications` half stays
deferred).

Scope decisions (locked in brainstorming):

- Mention-only: input + storage + render. No notification infra.
- Storage: inline `@[username](userId)` token in the existing plain-string
  `Comment.body`. No CRDT/type change.
- Tokenize on submit (approach B) + view-local mention map; manual edit of a
  mention drops it to plain text gracefully.
- Mentionable set = workspace members via existing `GET /workspaces/:id`
  (no new backend).
- Chip click = no-op for now; hover tooltip shows username + photo.
- Lands in the shared module → sheets + docs both get it; slides inherits.

## Tasks

### 1. Pure helpers — `components/comments/mentions.ts` ✅
- [x] `parseMentionBody(body): BodySegment[]` (text / mention segments).
- [x] `serializeMention({userId, username})` → `@[username](userId)`;
  strip `]` from username and `)` from userId.
- [x] `extractMentionedUserIds(body): string[]` (future notification hook).
- [x] `mentions.test.ts` — round-trip, `@[` in prose, names with `]`/`)`,
  adjacent mentions, start/end, empty body. 14 tests pass.

### 2. Member source — `useWorkspaceMembers(workspaceId)`
- [ ] Hook reading `GET /workspaces/:id` → `{userId, username, photo}[]`.
  Confirm where the existing workspace fetch lives; reuse it (don't add a
  duplicate request) if one already caches the workspace.
- [ ] Thread the member list from each consumer controller (docs + sheets)
  into `CommentComposer` as a prop. Anonymous/share-link → empty list.

### 3. Input — `MentionTextarea` in `CommentComposer`
- [ ] `@`-trigger detection (start-of-text or whitespace before `@`).
- [ ] Member dropdown anchored at caret; reuse `AuthorAvatar`; username
  case-insensitive match.
- [ ] Keyboard ↑/↓/Enter/Tab/Esc intercepted **only when open**; existing
  Cmd/Ctrl+Enter submit + Esc-cancel preserved when closed.
- [ ] Mention map records `{matchedText, userId, username}` on select;
  textarea shows clean `@username `.
- [ ] On submit, rewrite still-matching `@username` → token; drop edited
  ones to plain text.
- [ ] IME: suppress trigger/keys during composition
  (`compositionstart`/`compositionend`).

### 4. Render — `CommentBody` in `CommentThreadCard` ✅
- [x] Replace plain-text body output with `CommentBody`.
- [x] Text segments verbatim (whitespace/newlines preserved).
- [x] Mention chip: blue, `title` tooltip (username), click no-op. Photo
  enrichment deferred (token carries username+userId only; parse-only
  render works for anonymous viewers).
- [x] Used by both sheets + docs thread cards (shared component).
- [x] Side-panel snippet + OrphanedCard preview use `mentionBodyToPlainText`
  so the raw token never leaks into truncated previews.

### 5. Tests + verification
- [ ] Composer interaction test (`.test.ts` + `IS_REACT_ACT_ENVIRONMENT`):
  `@` opens dropdown, filter, keyboard select, tokenized submit, edit→drop.
- [ ] `CommentBody` render test (chips + plain text).
- [ ] `pnpm verify:fast` green.
- [ ] Manual smoke in `pnpm dev`: mention in docs + sheets comment, Korean
  IME path, chip render + tooltip.

### 6. Wrap-up
- [ ] Self code-review over full branch diff (`/code-review`); apply
  blocking findings.
- [ ] Capture lessons in `20260621-comments-mentions-lessons.md`.
- [ ] `pnpm tasks:archive && pnpm tasks:index`; PR (Summary + Test plan).

## Out of scope (tracked elsewhere)
- Notifications (in-app + email) — `docs-comments-followup` Step 4 remainder.
- Slides comments (mentions inherited once they exist).
- Mentioning non-members / mention-to-share.
