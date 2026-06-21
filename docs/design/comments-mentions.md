---
title: comments-mentions
target-version: 0.5.0
---

<!-- Append document link in design README.md (Common section) after creating. -->

# Comment Mentions

## Summary

Add Google-Docs-style `@user` mentions to comments. While typing a comment
or reply, a user types `@`, picks a workspace member from an autocomplete
dropdown, and the mention renders as a blue chip in the posted comment.

This is a **mention-only** scope: input, storage, and rendering. It does
**not** add a notification system (in-app or email). Notifications remain a
separate follow-up (`docs-comments-followup` roadmap, Step 4) and are listed
under Non-Goals.

The work lands entirely in the **shared frontend comments module**
(`packages/frontend/src/components/comments/`), so both live consumers
(sheets cells, docs ranges) get mentions in the same change; slides inherits
them for free when slides comments land. No CRDT schema change and no
domain-package (`@wafflebase/sheets`/`docs`) type change: a mention is
encoded inline in the existing plain-string `Comment.body`.

## Goals / Non-Goals

### Goals

- Typing `@` in the comment composer (new thread or reply) opens a member
  autocomplete; selecting a member inserts a mention.
- A posted comment renders mentions as blue, non-editable chips with a hover
  tooltip (username). Click is a no-op for now. (Photo-in-tooltip is
  deferred: the token carries only username + userId, and chips must render
  parse-only for anonymous viewers without a member fetch.)
- Mentions are stored stably (embedded `userId`) so a later username change
  or duplicate username never breaks rendering.
- Zero change to `Comment`/`Thread` types, CRDT schema, or any store; the
  feature is additive in the shared frontend module only.
- Mentionable set = current workspace members, sourced from the existing
  `GET /workspaces/:id` response (no new backend).

### Non-Goals

- **Notifications** (in-app feed, unread badge, email) — separate follow-up.
- Mentioning users who are not workspace members (e.g. by email).
- Rich `contentEditable` input with in-textarea chips — we keep the plain
  `<textarea>` and tokenize on submit (see Risks).
- Mention-driven access grants ("mention to share").
- Slides comments themselves (mention support is inherited once they exist).

## Proposal Details

### Data model — unchanged

`Comment.body` stays a plain `string` (owned by `@wafflebase/sheets`). A
mention is encoded inline as a token:

```
@[username](userId)
```

Example stored body:

```
Hi @[김철수](u_42), can you review this?
```

Because the `userId` is embedded, rendering never has to guess which member
a display name refers to. `Thread`/`Comment` types, the Yorkie schema, and
every `CommentStore` implementation are untouched — the token is opaque
text to them. This keeps the change from rippling into the `@wafflebase/*`
packages.

Token grammar (kept deliberately small):

- `username` segment: any run of characters except `]`.
- `userId` segment: any run of characters except `)`.
- A literal `@[` in normal prose is preserved verbatim: the parser only
  treats `@[...](...)` as a mention when **both** brackets close in order;
  otherwise the text is emitted as-is. (Serialization never produces a
  username/userId containing `]`/`)` because those are stripped/escaped at
  serialize time — see `serializeMention`.)

### New shared helper — `components/comments/mentions.ts`

Pure, DOM-free functions (unit-testable, node-safe):

```ts
type MentionRef = { userId: string; username: string };
type BodySegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; userId: string; username: string };

// "Hi @[김철수](u_42)!" -> [text "Hi ", mention, text "!"]
function parseMentionBody(body: string): BodySegment[];

// { userId:'u_42', username:'김철수' } -> "@[김철수](u_42)"
// strips ']' from username and ')' from userId to keep the grammar safe.
function serializeMention(ref: MentionRef): string;

// "Hi @[김철수](u_42)" -> "Hi @김철수" (for truncated previews)
function mentionBodyToPlainText(body: string): string;

// extract userIds referenced in a body (for future notification work)
function extractMentionedUserIds(body: string): string[];
```

`extractMentionedUserIds` is included now because it is trivial and is the
single integration point a future notification feature needs — but nothing
in this PR consumes it beyond a unit test, so it carries no runtime weight.

### Member source — `useWorkspaceMembers(workspaceId)`

A small frontend hook that reads the existing `GET /workspaces/:id`
response (`workspace.members[].user`) and returns
`{ userId, username, photo }[]`. `findOne` already includes
`members: { include: { user: true } }`, so **no new backend endpoint**.

Each consumer's comment controller already knows its `workspaceId`
(documents are workspace-scoped); it passes the member list (or the hook
result) down to `CommentComposer` as a prop. The shared module never
fetches on its own — it stays presentation-only and testable.

### Input — `MentionTextarea` inside `CommentComposer`

`CommentComposer` keeps its `<textarea>`. Mention behavior is layered via a
small `MentionTextarea` wrapper / hook:

- **Trigger**: detect an `@` immediately preceded by start-of-text or
  whitespace, followed by the in-progress query (`@ki`). Show a dropdown
  anchored under the caret listing members whose username matches the query
  (case-insensitive prefix/substring).
- **Dropdown**: reuses `AuthorAvatar` for each row. Keyboard: ↑/↓ move,
  Enter/Tab select, Esc closes. These keys are intercepted **only while the
  dropdown is open**, so the composer's existing Cmd/Ctrl+Enter submit and
  Escape-cancel are unaffected when it's closed.
- **Selection (approach B — tokenize on submit)**: selecting a member
  replaces the in-progress `@ki` with a clean `@username ` in the textarea
  and records the chosen mention in a view-local **mention map**
  (`{ matchedText, userId, username }`). On submit, the composer walks the
  mention map and rewrites each still-present `@username` occurrence into a
  `@[username](userId)` token before calling `onSubmit(body)`. If the user
  manually edited a mention's text so it no longer matches, that mention is
  silently dropped to plain text (graceful — never emits a broken token).
- **IME safety**: while an IME composition is active
  (`compositionstart`/`compositionend`), the `@`-trigger and key handling
  are suppressed so Korean/CJK composition isn't hijacked. (Reflects the
  docs IME known-issue lessons.)

`CommentComposer`'s `onSubmit(body: string)` signature is unchanged — the
body it passes up already contains tokens, so every store and consumer works
without modification.

### Render — `CommentBody` inside `CommentThreadCard`

The thread card currently prints `comment.body` as plain text. Replace that
with a shared `CommentBody` component:

- Runs `parseMentionBody(body)`.
- Renders `text` segments verbatim (preserving whitespace/newlines as today).
- Renders `mention` segments as a styled chip: blue text, subtle background,
  `@username`, native `title` tooltip showing the username. Click is a no-op
  (cursor default), leaving room for a profile/jump action when
  notifications land. Photo-in-tooltip is deferred (parse-only render needs
  no member list, so chips show for anonymous viewers too).
- Truncated previews that cannot host chips (side-panel snippet,
  `OrphanedCard`) use `mentionBodyToPlainText(body)` (mentions → `@username`)
  so the raw `@[…](…)` token never leaks.
- Used by both sheets and docs thread cards (single component).

### Wiring summary

```
GET /workspaces/:id ──┐
                      ├─ useWorkspaceMembers(workspaceId) ─┐
consumer controller ──┘                                    │ members[]
                                                           ▼
CommentComposer ── MentionTextarea(@ dropdown) ── onSubmit("…@[u](id)…")
                                                           │
                                                           ▼
                                              CommentStore (unchanged)
                                                           │
                                                           ▼
CommentThreadCard ── CommentBody ── parseMentionBody ── blue chips
```

### Testing

- `mentions.test.ts` — parse/serialize round-trip; escape edge cases
  (`@[` in prose, `]`/`)` inside names, adjacent mentions, mention at
  string start/end, empty body); `extractMentionedUserIds`.
- Composer interaction test — `@` opens dropdown, filter, keyboard select,
  submit produces a tokenized body, manual edit drops to plain text. Use
  `.test.ts` + `IS_REACT_ACT_ENVIRONMENT` (jsdom react-dom is available;
  `.tsx` render tests are flaky per project memory).
- `CommentBody` render test — chips rendered, plain text preserved.
- `pnpm verify:fast` green.

## Risks and Mitigation

- **Approach B mapping drift.** Tokenizing on submit (clean textarea, no
  in-line chip) means a user can edit a mention's text after selecting it.
  *Mitigation:* mentions whose text no longer matches the recorded map entry
  are dropped to plain text rather than emitting a malformed token — a
  graceful, well-defined fallback. The alternative (approach A, insert the
  raw token immediately) was rejected for showing `@[name](id)` noise in the
  input.
- **Token collision with user prose.** Someone could literally type
  `@[x](y)`. *Mitigation:* this renders as a chip only if `y` parses as a
  segment; worst case it renders as a chip with an arbitrary id and no
  tooltip match — cosmetically odd, never a crash or data corruption. Real
  mentions always carry a valid workspace `userId`.
- **IME hijack.** Composition events gate the trigger (see Input). Covered
  by the lessons from prior docs IME work; manual smoke in `pnpm dev` with
  Korean input before merge.
- **Stale member list.** The dropdown shows members as of the last
  `GET /workspaces/:id`. A just-added member may be briefly unmentionable;
  acceptable for v1 and self-heals on refetch.
- **Anonymous/share-link viewers.** Such sessions may lack a workspace
  member list; the dropdown is simply empty (no mentions offered). Rendering
  of existing mention chips still works (parse-only, no member fetch needed).
