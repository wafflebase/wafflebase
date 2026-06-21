# Comment Mentions — Lessons

## Inline token in the existing string body avoids a CRDT/type ripple

Storing each mention as `@[username](userId)` inside the existing plain
`Comment.body` string meant **zero** change to `Comment`/`Thread` (owned by
`@wafflebase/sheets`), the Yorkie schema, and every `CommentStore`. The token
is opaque text to all of them. Embedding `userId` (not just `@username`) keeps
rendering stable across username changes/duplicates without a lookup.

**Apply:** When adding rich content to a CRDT-backed plain-text field, prefer
an inline, self-describing token over a parallel structured field or a body
type change — it keeps the change in the presentation layer.

## Frontend tests live in `tests/`, not next to source

The frontend vitest `include` is `["tests/**/*.test.ts", "tests/**/*.test.tsx"]`
(`vite.config.ts`). A `*.test.ts` placed next to source under `src/` is
silently **not run**. Mirror the source path under `tests/` and import via
`../../../src/...` with explicit `.ts` extensions (matching the package's
import style). A stray `src/.../theme-fonts.test.ts` exists but is dead.

## React onChange in jsdom needs the prototype value setter

Simulating typing with `textarea.value = "x"; dispatch('input')` does **not**
fire React's synthetic `onChange`: React patches the element's own `value`
setter to track changes, so the assignment updates the tracker and the event
is deduped away. Use the prototype setter to bypass the instance patch:

```ts
const set = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype, "value",
)!.set!;
set.call(ta, value); ta.dispatchEvent(new Event("input", { bubbles: true }));
```

(The repo's `font-size-picker.test.ts` happened to pass with plain assignment
for an `<input>`, but it's unreliable — the prototype-setter form is correct.)

## Tokenize-on-submit needs the inverse path for edit entry (review catch)

The blocking bug the self-review found: tokenize-on-submit (approach B) only
handled *new* text. Editing an existing comment fed the stored tokenized body
straight into the textarea, so the user saw raw `@[kim](u1)` and — because the
edit composer's mention map started empty — `applySelectedMentions` dropped
every mention on save. Fix: de-tokenize `initialBody` for display
(`mentionBodyToPlainText`) **and** seed the mention map from its tokens
(`parseMentionBody`), then always replay the map on submit (lossless even when
the member list never loaded).

**Apply:** Any "serialize on submit" input has a symmetric "deserialize +
seed on entry" obligation. Build and test the round-trip (entry → unchanged
save) as one unit, not just the forward direction.

## Match boundary regex to the actual identifier charset

Usernames are GitHub logins (`profile.username`), i.e. ASCII `[A-Za-z0-9-]`.
That makes `@kim(?![A-Za-z0-9-])` exactly right: a following space, comma, or
CJK particle ends the mention; only another login char (`@kimchi`) blocks it.
The review's "CJK username eats the next word" concern doesn't apply because
display names aren't the username. The leading trigger boundary was widened to
`[^A-Za-z0-9-]` so `안녕@kim` (no space, common in CJK input) opens the
dropdown while `email@host` stays excluded.

**Apply:** Before picking `\w`/`\s`/custom classes for an identifier boundary,
pin down the identifier's real charset at its source. Don't infer it from
illustrative test fixtures (ours used `김철수` as a *display* example).

## Share the query cache key, don't invent a parallel one

`useWorkspaceMembers` first used `["workspace", id, "members"]` — a second
cache entry for the same `fetchWorkspace(id)` the app already caches under
`["workspaces", id]`. Reusing the canonical key shares the fetch and
invalidations. Grep existing `queryKey`s before adding a query for an endpoint
that's already fetched elsewhere.
