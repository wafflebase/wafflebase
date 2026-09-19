# Lessons — anchoring the active find match (PR #1084)

## What the review panel got right

**Re-searching fixes one staleness and introduces another.** The PR's insight
is correct: replacing at offsets captured by an earlier `search()` writes over
whatever has since slid into that slot (#1083). But `search()` re-binds the
active match by *ordinal* index, and an ordinal is only stable under the edit
`search()` was written for — a replace, which shrinks the match set from a
known position. Under an arbitrary intervening edit it is not stable at all:
insert one more occurrence ahead of the active match and index N names the new
one. So the fix would have moved the failure from "rewrites the wrong text" to
"rewrites the right *kind* of text in the wrong place" — quieter, and harder to
notice.

The lesson generalizes: **a fix that re-derives state must re-derive the
selection too.** Anything downstream still holding an index into the old
derivation is now holding a dangling reference.

`refresh()` re-anchors by position (nearest match in the same block, ties to
the later one, ordinal as the fallback when that block has no match left).
`test/view/find-replace.test.ts` pins it with the case that distinguishes the
two: `dog cat dog`, active on the second, `dog ` inserted at the head. Ordinal
replaces the *inserted* occurrence; position replaces the one the user is
looking at. That test fails on the PR as submitted.

**Guards duplicated across a boundary go stale on the far side.** The find bar
re-checked `state.activeIndex < 0` / `state.matches.length === 0` before
delegating to `FindReplaceState`, which now checks the same thing against a
*fresher* document. The outer copy could only ever be wrong, and when it fired
it also skipped `syncHighlights()`, so the stale counter that caused the refusal
stayed on screen to justify itself. Deleted; `readOnly` stays, because it is the
one condition the component alone knows.

## Findings rebutted

**"`search()` can throw uncaught out of the replace click handler."**
It cannot. `Doc.searchText` (`packages/docs/src/model/document.ts:906-912`)
wraps `new RegExp(...)` in its own `try`/`catch` and returns `[]` on a bad
pattern. The find bar's `try`/`catch` around `runSearch` sets
`state.matches = []` — exactly what the throwing path would have produced
anyway. The new call sites need no guard, and the existing one is belt-and-
braces rather than load-bearing.

**"Replace All now rewrites matches the user was never shown."**
That is what Replace All means. Its scope is the document, not the last render
— the alternative is to write a subset and leave occurrences behind, which is
the more surprising outcome and the one users report as a bug. The real
complaint underneath is that the *counter* is stale, which is true and is the
relocated finding below.

**"The extra regex scan amplifies the ReDoS surface in `Doc.searchText`."**
The surface is real and pre-existing (user-authored regex, no timeout, main
thread) but the amplification is not meaningful: one extra scan per *click*,
against a pattern the same user already typed into the same input and which is
already re-scanned on every keystroke. A pathological pattern hangs the tab at
search time, long before anyone reaches the Replace button. Bounding it belongs
with `searchText`, not here.

## Known limitation carried forward

Highlights, the match counter and next/previous still read whatever the last
`search()` left behind; only the two write paths refresh. The panel relocated
this as pre-existing, and the PR author noted it as follow-up. Closing it means re-running the search
whenever the document changes, and there is no one hook for that: remote edits
reach `store.onRemoteChange`, which is a single-assignment property
`docs-view.tsx:418` already owns, and local typing reaches none of it. That is
a bigger change than a #1083 fix should carry.
