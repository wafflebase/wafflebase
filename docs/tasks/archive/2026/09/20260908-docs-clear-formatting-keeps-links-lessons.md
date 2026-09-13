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

## Guard the *seed*, not the entry point (round-5 review)

The follow-up round said the same thing one level deeper: patching
`clearInlineFormatting` shared the rule with nobody. `applyStyleImpl`'s
collapsed branch stages `{ ...caretInlineStyle(), ...style }` for **every**
toolbar write, so Bold, the colour pickers and `stepSelectionFontSize` all
re-armed the link at a trailing edge through the identical path — click the
caret at a link's end, click Bold, type, and the hyperlink swallowed the new
text. Two tests now cover that (a toggle and a font-size step), and the rule
moved onto the seed itself (`pendingStyleFor`), so the entry point carries no
special case at all. General shape: when a fix is a *condition on a value*,
put it where the value is produced. Every place that consumes it is a place
the fix can be forgotten.

## Removing a key from a shared constant removes a capability

Dropping `href` from `CLEAR_INLINE_STYLE` also dropped the only escape from an
old model wart: `normalizeInlines` keeps the first run's style when a
paragraph's whole text goes, so deleting a link's text leaves an empty inline
still carrying `href`. Nothing displays it and `removeLink` cannot reach it
(`findLinkRunAt` refuses a zero-length run), but the caret walk reports it —
so after this change Clear formatting *seeded* the residue's href and the next
typed character became a hyperlink no command could remove. `isAtLinkTrailingEdge`
now counts an empty-text href run (a caret can never be *inside* a zero-length
run, so there is no "still in the link" case to protect), which also stops
plain typing from resurrecting the link. Eliminating the residue at its source
(dropping `href` in `normalizeInlines`' all-empty fallback, beside the `image`
it already drops) is the real root-cause fix and stays **out of scope**: it is
a model-wide change on every block mutation path, and this PR only has to not
regress what it took away.

## A toolbar button is a different gesture than a popover

The new Slides Remove-link button forwarded to a `removeLink` written for the
docs link popover, which only ever opens on a caret. The gesture a toolbar
button invites is "drag over the linked text, then click" — and after that
drag the caret sits at the selection's focus, past the link whenever the
selection reaches beyond it, so the click was a silent no-op on the one
surface with no other way to drop a link. `TextBoxEditorAPI.removeLink` now
lets a selection win over the caret. Reusing an API on a new surface means
re-deriving which *input* it reads, not just checking that it exists.

## What round 5 reported that needed no code

- The slides text-box `clearInlineFormatting` was said to lack the
  trailing-edge override the docs paths got. It genuinely needs none: its
  `applyStyleImpl` returns early without a selection, so there is no
  caret-derived seed to re-arm a link from. The gap was coverage, which
  `text-box-clear-formatting.test.ts` now closes (the clear keeps the href and
  leaves the Space/Enter exit working).
- The new `showRemoveLink` button had no test at all. It does now, including
  that the *slides* text-edit section passes the flag — an optional JSX prop
  that is never passed fails silently, with no type error to catch it.

## The renderer already knew

A link's blue and underline are derived from the presence of `href` in
`renderRun`, not stored on the run. That is why the fix needed no renderer
change and why clear formatting can still strip an author's custom colour off a
link — the run just falls back to the default link paint.
