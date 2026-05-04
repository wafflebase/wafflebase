# Lessons — Cmd+Arrow Axis Extension Regression

## Pattern: don't conflate "where the cursor is" with "where data lives"

The original `923c5073` fix correctly extended axis order for *range*
selection (column E with only A-B data). It overshot by also seeding
`maxRow`/`maxCol` from `activeCell.r/c`. activeCell can sit on any cell —
including the dimension boundary — without there being any data to anchor.
Anchors should follow the data, not the cursor.

## Pattern: dual-format presence already handles the empty case

`overlay.ts` had `presence.selection` (anchor) AND `presence.activeCell`
(legacy Sref) since the original axis-ID rollout, with explicit fallback in
both branches. That fallback existed for cross-version migration but also
covers the "no anchor available" case for free. Worth noticing existing
fallbacks before designing new null-handling.

## Pattern: O(N) Yorkie pushes inside a single `doc.update`

`while (rowOrder.length < N) rowOrder.push(...)` inside `doc.update` looks
like one operation but generates N CRDT changes. Watch for unbounded
extension loops on collaborative arrays. If extension is unavoidable,
either cap the growth, or treat the array as sparse with lazy creation.

## Confirmation: `ensureAxisOrder(0, 0)` is a no-op

The `while (length < 0)` loop never runs. So callers can always invoke
`ensureAxisOrder` without a guard — clearer than computing whether
extension is needed in the caller.
