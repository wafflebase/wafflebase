# Lessons — Docs: Clear formatting must keep hyperlinks

Issue: #1051

## What made the bug survive

Nothing pinned the behaviour down. `editor-clear-formatting.test.ts` had two
cases (attributes cleared, heading preserved) and no link case, and the design
note only committed to preserving *block* styles. So `href: undefined` sat in
`CLEAR_INLINE_STYLE` as an unexamined line rather than a decision.

## Two lists is one too many

`TextEditor.clearFormatting()` had its own copy of the key list. It had already
drifted — no `fontSize`, `fontFamily`, `color` or `backgroundColor` — so
Cmd+\ cleared strictly less than the toolbar button did, silently. Fixing the
`href` question in one place would have left the other wrong. Collapsing the
shortcut onto `CLEAR_INLINE_STYLE` is what makes the fix hold: the constant's
comment is now the only place the question is answered.

## Sharing the *list* is not sharing the *rule*

Collapsing both entry points onto `CLEAR_INLINE_STYLE` shared the key list but
not what each does with it at a collapsed caret. `TextEditor.clearFormatting`
stages the constant as-is; `EditorAPI.clearInlineFormatting` goes through
`applyStyleImpl`, which stages `{ ...caretInlineStyle(), ...style }` — so
removing `href` from the constant left the toolbar *re-arming* a link at its
trailing edge, a worse failure than the one it fixed for the shortcut. Review
caught it because the second half was patched and the first was not. The
trailing-edge test is now one exported `isAtLinkTrailingEdge` in
`model/caret-style.ts`, beside the caret walk whose result makes it necessary.

## The renderer already knew

A link's blue and underline are derived from the presence of `href` in
`renderRun`, not stored on the run. That is why the fix needed no renderer
change and why clear formatting can still strip an author's custom colour off a
link — the run just falls back to the default link paint.
