# Docs — Exit hyperlink formatting on Enter / Space

## Context

After inserting or pasting a hyperlink in Wafflebase Docs, the link
formatting stayed active when the user pressed Enter or Space right after
it: the new paragraph (Enter) or the text typed after the space kept
inheriting `href` and silently joined the same link.

Root cause: `href` is just an `InlineStyle` field on a text run, and both
insertion paths blindly inherit the style of whatever run touches the
caret — `applyInsertText` and `applySplitBlock` /
`getSplitPointStyle` (`packages/docs/src/store/block-helpers.ts`) have no
concept of a link "boundary" to stop at. `editor.ts`'s `insertLink` writes
`href` directly and leaves the cursor flush against the link's last
character, which is exactly the state that triggers the bug on the very
next keystroke.

Compared against Notes (`packages/notes`), which represents links as
literal markdown text (`[text](url)`) in one plain CodeMirror `Text` CRDT
— there's no equivalent bug there because there's no persistent
"formatting mode" to exit; once the closing `)` is typed it's just
characters. Nothing to port from Notes; the fix has to live in Docs'
rich-text mark-inheritance layer.

Fix reuses the existing pending-style controller
(`packages/docs/src/view/pending-style.ts`, see
[docs-pending-inline-style.md](../../design/docs/docs-pending-inline-style.md))
rather than adding new state: when the caret sits at the trailing edge of
a link, arm `pending` with `href: undefined` merged onto the caret's
current visual style (preserving bold/italic/etc.), so the next typed
character — first char of a new paragraph on Enter, or a typed space —
gets the override via `consumeForInsert` instead of inheriting the link.

## Work

- [x] `isAtLinkTrailingEdge(pos)` — true only when the caret is exactly at
  the end of an `href` run, not merely inside one; also checks the next
  run doesn't continue the same `href` (guards a link split across
  differently-styled sub-runs, e.g. a bold prefix of the same URL).
- [x] `exitLinkIfAtTrailingEdge(pos)` — merges caret style + any active
  pending, overrides `href: undefined`, arms `pending.set(...)`. No-ops
  when not at a trailing edge.
- [x] Wire into `handleEnter` (both the table-cell split branch and the
  normal paragraph-split branch, after the existing
  `tryAutoLinkBeforeCursor` call so a URL auto-linked by this same Enter
  press is also exited).
- [x] Wire into `handleInput`'s space branch, before `docInsertText`, so
  the typed space itself does not join the link.
- [x] Wire into `insertPlainText` (the plain-text paste path), before the
  first line's insert — same root cause: pasting text right after a
  link's trailing edge (e.g. right after `insertLink`) went through the
  same style-inheriting `docInsertText` and silently extended the link.
  Found by an independent review pass (see below); the rich-paste path
  (`insertBlocks`, HTML/`WAFFLEDOCS_MIME`/markdown-table paste) is
  unaffected since it splices the clipboard payload's own explicit
  per-inline styles rather than inheriting the destination caret's run.
- [x] Checked non-regressions: bold/italic pending at the same caret is
  preserved (merge, not overwrite); `insertLink`'s direct-write path
  (doesn't use `pending`, no conflict); auto-link-before-cursor via space
  already exits the link naturally as-is (trailing space breaks
  adjacency) — unaffected; mid-link Enter/Space (splitting or spacing
  inside link text) untouched since the caret isn't at a trailing edge;
  Hangul/IME composition doesn't route space/Enter through this path.
- [x] Tests: `test/view/link-trailing-edge.test.ts`, driving the real
  `editor.js` `initialize()` + jsdom textarea (same harness as
  `pending-style-editor.test.ts` / `ime-composition-editor.test.ts`):
  - space right after `insertLink` doesn't extend the link
  - text typed after that space stays plain
  - Enter right after `insertLink` starts a plain new paragraph
  - space in the *middle* of link text still stays part of the link
    (non-regression for the trailing-edge-only guard)
  - space at the internal boundary between two runs of the *same* link
    (e.g. a bold prefix) still stays part of the link — exercises the
    `next.style.href === inline.style.href` guard in
    `isAtLinkTrailingEdge`
  - a pending style armed at the same caret (toolbar bold toggle) is
    preserved through the link-exit merge, not clobbered by it
  - pasting plain text right after `insertLink` doesn't extend the link
    (regression coverage for the `insertPlainText` fix above)
- [x] `@wafflebase/docs` typecheck clean; full test suite green (81
  files, 1107 passed, 1 skipped — up from 80/1100 baseline).
- [x] `@wafflebase/slides` typecheck + tests green — but this fix does
  **not** apply to Slides text boxes. `text-box-editor.ts` wraps the same
  `TextEditor` class, but never calls `setPendingStyle`, so `pending`
  stays `null` there (`text-editor.ts`'s own field doc already says so:
  "null in standalone contexts (slides text boxes) where pending
  behavior is not wired"). `exitLinkIfAtTrailingEdge`'s
  `this.pending?.set(...)` is therefore a silent no-op in Slides —
  Enter/Space/paste can still inherit `href` there. Caught by CodeRabbit
  on PR #520; corrected here rather than claiming coverage that doesn't
  exist. Slides parity is a reasonable follow-up but out of scope for
  this fix (see below) — bolting it on here would mean either quietly
  turning on the *whole* pending-style toolbar-toggle feature for Slides
  text boxes with no dedicated test of that surface, or a parallel
  non-pending reimplementation, both larger than this bug fix warrants.

## Self-review

Dispatched an independent review agent over the branch diff (the
`/code-review` skill isn't directly invocable by the assistant in this
session). Findings:
- **Fixed**: paste right after a link's trailing edge bypassed the fix
  (see `insertPlainText` bullet above).
- **Non-blocking, pre-existing, orthogonal**: `insertLink`'s
  collapsed-caret branch (`editor.ts`) moves the cursor directly without
  going through the `pending`-aware `docInsertText`/arrow-key clear
  paths; a stale `pending` anchor from immediately before a keyboard-
  triggered Ctrl+K could persist until the next Enter/Space, at which
  point this fix's own `pending.set(..., pos)` rebinds it correctly
  anyway. Not touched — out of scope for this bug.
- **Nit, not applied**: `exitLinkIfAtTrailingEdge` reads
  `this.cursor.position` via `getStyleAtCursor()` rather than the `pos`
  parameter it's given; harmless at all 3 call sites today (nothing
  mutates the cursor in between) but is a latent trap for a future call
  site. Left as-is since fixing it means changing `getStyleAtCursor`'s
  shared signature for no current bug.

## Follow-up (out of scope for this branch)

- Typing a normal (non-space) character immediately after a link with no
  separator has the same underlying inheritance behavior and was not
  changed — only Enter and Space (and, after review, paste) were fixed,
  matching Google Docs' narrower "space/paragraph break/paste exits the
  link" behavior.
- Slides text boxes don't get this fix (see the corrected bullet above)
  since `text-box-editor.ts` never wires a `pending` controller into its
  `TextEditor` instances. Giving Slides the same link-exit behavior
  needs its own deliberate design pass (construct + wire a
  `PendingStyle`, decide whether to also enable the toolbar
  collapsed-caret pending-toggle feature that would come along with it,
  and test both surfaces in Slides) rather than a side effect of this
  Docs-scoped fix.
