# Lessons — Sheets Comments Collab Fixes (Issue A + Issue B)

## Yorkie 0.7 picks `Integer` (32-bit) for any integer JS number

`Primitive.getPrimitiveType` (yorkie-js-sdk 0.7.8) does:

```js
case 'number':
  if (this.isInteger(value)) return 2; // Integer (32-bit)
  else                       return 4; // Double
```

…and `isInteger` is *literally* `num % 1 === 0`. There is **no range
check**. `Date.now()` (~1.78e12) is an integer, so it's classified as
Integer and `toBytes()` keeps only the low 32 bits.

The writer never sees this because its in-memory proxy returns the
original `this.value` field — the truncation only manifests on remote
peers after wire round-trip.

**Lesson**: Any timestamp-shaped numeric value going into a Yorkie
field must be `bigint`, `Date`, or split into low/high pairs. Treat
"large integer + JS number" as the same hazard as "large integer +
JSON number" — both are silently lossy without explicit type
discipline.

**Detection**: If a local writer sees a correct value but a remote
peer sees a tiny one (especially something dated 1970-01-XX), suspect
int32 truncation before assuming a logic bug. Compute
`Date.now() & 0xFFFFFFFF` to confirm.

## `notifySelectionChange` fires on every render

`Spreadsheet.initialize` wires
`this.worksheet.setOnRender(() => this.notifySelectionChange())`
(`packages/sheets/src/view/spreadsheet.ts:94`). So selection-change
listeners run on *every* repaint, including remote-sync repaints,
even when the active cell hasn't moved. Any handler that takes
side-effecting action on "selection changed" (closing a popover,
clearing a draft, jumping the viewport…) must filter for *real*
selection changes itself.

**Lesson**: Treat `onSelectionChange` as "selection-or-render". The
handler is responsible for distinguishing the two. The robust filter
is per-listener: snapshot whatever state the handler cares about
(active cell axis IDs, range bounds…) at the time the action arms,
and only re-fire when that snapshot diverges.

## `{r, c}` is not a stable cell identifier under remote structural edits

`Sheet.resolveAnchorsToRefs()` migrates the active cell to a new
`{r, c}` whenever a remote row/column insert or delete shifts axis IDs
(`packages/sheets/src/model/worksheet/sheet.ts:4205`). So a user can
"still be on the same logical cell" while `getActiveCell()` returns
different integers.

**Lesson**: For anything that should track a *logical cell* across
collaboration (popover anchors, hover targets, lock indicators…),
pin `(rowId, colId)` and re-resolve each tick rather than caching the
numeric coordinates. The axis-ID-selection design exists precisely so
features can be stable across remote structural edits.

## In-memory Yorkie proxies bypass serialization

Local development never reproduced Issue B because the writer reads
its own `Primitive.value` directly — no `toBytes`/`valueFromBytes`
round-trip. The bug needs **at least two peers** (or one peer plus
a detach/re-attach) to surface.

**Lesson**: When a feature touches CRDT-stored primitives, the
acceptance criterion must include a remote-peer check, not just
single-tab smoke. Add it to the "Test plan" section of the PR by
default for collaborative features.

## Read-side coercion at the boundary, not the consumer

The fix for Issue B converts `bigint → number` inside `copyThread` /
`copyComment` rather than at each React render site. Pushing the
coercion to the data boundary means all current consumers
(`activeCellThreads`, `allThreads`, the side panel, the popover…)
stay simple, and future consumers won't accidentally hit
`Number - bigint` runtime errors.

**Lesson**: When fixing a wire-format type mismatch, place the
coercion at the **single boundary** that's already responsible for
detaching the value from the CRDT proxy. Don't sprinkle
`typeof x === 'bigint' ? Number(x) : x` at the call sites.

## Inverted-condition dead code is a smell of past iteration

`sheet-view.tsx:987-991` had:

```js
if (!wsNow?.comments) {
  if (!commentPopoverOpenRef.current) {
    setCommentPopoverOpen(false);
  }
  return;
}
```

— close the popover *only* if it was already closed. The logic does
nothing useful. Almost certainly a refactor flipped the condition by
one negation at some point and nobody noticed because the popover
state happens to settle correctly on most paths.

**Lesson**: When auditing a buggy handler, scan for dead branches
(`!flag → set flag = false`, `!x ? null : null`, etc.). They usually
mean a previous fix was applied to the wrong half of a condition,
and they're often near the actual bug.
