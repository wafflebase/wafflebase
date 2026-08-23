# Lessons — Notes per-line author gutter (issue #814)

## CodeMirror gutter order is facet order, not extension-array order alone

`gutter(config)` expands to `[gutters(), activeGutters.of(config)]`, and
`GutterView` renders `state.facet(activeGutters)` in facet order. Listing the
blame gutter **before** `basicSetup` (which contributes `lineNumbers()`) is
what puts it to the left of the line numbers.

## The gutter renders before the sync plugin has written to the store

`gutters()` contributes one shared `ViewPlugin`, and its position in the
plugin order is fixed by where it first appears — which, for a left-hand
gutter, is *before* `noteSync`. So during a local edit's `ViewUpdate` the
gutter paints while the CRDT still lacks the just-typed characters.

The fix is a second, late-registered view plugin that recomputes the labels
after `noteSync` has run and, when they differ from what was painted,
dispatches one empty annotated transaction that `lineMarkerChange` picks up.
It converges in two transactions and only runs while blame is enabled.

## Attributes, not a new root field

Adding a parallel blame structure to the note root would have been a schema
migration event (`notes.md` calls that out explicitly). Yorkie `Text` already
carries per-run attributes, they survive undo (reverse ops restore the nodes),
and a reader that ignores them still sees the identical string — so the
CodePair-compatible schema is preserved and pre-feature text is naturally
"unattributed" with no backfill.
