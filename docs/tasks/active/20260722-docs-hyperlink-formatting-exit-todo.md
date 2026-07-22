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
- [x] Checked non-regressions: bold/italic pending at the same caret is
  preserved (merge, not overwrite); `insertLink`'s direct-write path
  (doesn't use `pending`, no conflict); auto-link-before-cursor via space
  already exits the link naturally as-is (trailing space breaks
  adjacency) — unaffected; mid-link Enter/Space (splitting or spacing
  inside link text) untouched since the caret isn't at a trailing edge;
  Hangul/IME composition doesn't route space/Enter through this path.
- [x] Tests: new `test/view/link-trailing-edge.test.ts`, driving the real
  `editor.js` `initialize()` + jsdom textarea (same harness as
  `pending-style-editor.test.ts` / `ime-composition-editor.test.ts`):
  space right after `insertLink` doesn't extend the link; text typed
  after that space stays plain; Enter right after `insertLink` starts a
  plain new paragraph; space in the *middle* of link text still stays
  part of the link (non-regression for the trailing-edge-only guard).
- [x] `@wafflebase/docs` typecheck clean; full test suite green (81
  files, 1104 passed, 1 skipped — up from 80/1100 with the 4 new tests).
- [x] `@wafflebase/slides` typecheck + tests green — `text-box-editor.ts`
  wraps the same `TextEditor` class for slide text boxes, so this fix
  (and its test coverage) applies there too.

## Follow-up (out of scope for this branch)

- Typing a normal (non-space) character immediately after a link with no
  separator has the same underlying inheritance behavior and was not
  changed — only Enter and Space were reported and fixed, matching
  Google Docs' narrower "space/paragraph break exits the link" behavior.
