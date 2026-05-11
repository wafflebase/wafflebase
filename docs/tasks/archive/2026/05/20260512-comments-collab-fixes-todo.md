# Sheets Comments — Collaborative Robustness Fixes

## Summary

Two bugs surfaced while testing sheet cell comments under live Yorkie
collaboration:

- **A.** The Insert Comment popover closes mid-typing whenever a remote
  change arrives at the same document (even on unrelated cells).
- **B.** Comment timestamps render as `1970-01-XX` on remote peers while
  the local writer sees `just now`.

Both have clear root causes; this task captures the minimal fix path.

## Issue A — Popover force-closed on remote changes

### Root cause

`Spreadsheet.notifySelectionChange()` fires from `setOnRender(...)`
(`packages/sheets/src/view/spreadsheet.ts:94`), so it runs on every
render — including renders triggered by remote-change sync
(`sheet.render()` inside `runRemoteSync`,
`packages/frontend/src/app/spreadsheet/sheet-view.tsx:1028`).

The selection-change handler at `sheet-view.tsx:979-1010` treats every
notification as a real selection move. When the popover is open on a
cell without unresolved threads and the worksheet has any threads at
all (so `wsNow.comments` is truthy), the `else if (commentPopoverOpenRef.current)`
branch fires and force-closes the popover.

Naively comparing `{r, c}` won't work because remote row/column inserts
shift the local active cell via axis-ID migration
(`Sheet.resolveAnchorsToRefs`, `packages/sheets/src/model/worksheet/sheet.ts:4205`).
The active cell index changes even though the user is still on the same
logical cell.

### Fix

- Pin `popoverAnchorRef = useRef<{ rowId; colId } | null>` when the
  popover opens.
- In the selection handler, resolve the *current* active cell to
  `(rowId, colId)` via `wsNow.rowOrder` / `wsNow.colOrder`. Compare
  against the pinned anchor:
  - Same → no-op (keep popover, just update `activeCellForComment`
    so position re-anchors after structural shifts).
  - Different or unresolvable → close (clear pin too).
- Open paths (`openCommentComposerForActiveCell`, auto-open branch
  for cells with existing threads) populate the pin.
- A `useEffect` on `commentPopoverOpen` clears the pin when the popover
  closes from any path (Resolve, Escape, outside-click, tab change…).
- Remove the dead `if (!wsNow?.comments) { if (!commentPopoverOpenRef.current) ... }`
  block (`sheet-view.tsx:987-991`): the condition is inverted, and the
  new guard subsumes it.

## Issue B — Timestamps truncate to int32 on the wire

### Root cause

Yorkie 0.7.8 classifies any JS number with `value % 1 === 0` as
`PrimitiveType.Integer` (`yorkie-js-sdk.es.js:7185-7196`), and
`Primitive.toBytes()` for Integer (case 2) writes only the low 32 bits:

```js
[intVal & 255, intVal >> 8 & 255, intVal >> 16 & 255, intVal >> 24 & 255]
```

`Date.now()` (~1.78e12) is well above `INT32_MAX`. On the writer the
in-memory proxy returns the original number ("just now"), but the
serialized wire form holds only the low 32 bits, which a remote peer
deserializes (`valueFromBytes` case 2) into a small number like
`513_939_456`. `new Date(513_939_456)` ≈ **1970-01-06** — matches the
symptom exactly.

Affected writes (all `Date.now()` going into the Yorkie tree):

- `yorkie-store.ts:1238` createThread.now
- `yorkie-store.ts:1262` addReply.now
- `yorkie-store.ts:1273` applyEditComment
- `yorkie-store.ts:1289` applyResolveThread

### Fix

- At every write boundary in `yorkie-worksheet-comments.ts`, coerce
  millis to BigInt (`BigInt(ms) as unknown as number`) before assigning
  into the Yorkie tree. Yorkie maps `bigint` to `PrimitiveType.Long`
  (case 3 in toBytes/valueFromBytes), which round-trips a 64-bit value.
- At every read boundary (`copyThread` / `copyComment`), coerce back to
  `number` via `Number(raw)` so React consumers see plain numbers and
  the existing `Comment.createdAt: number` / `editedAt?: number` /
  `resolvedAt?: number` types stay correct.
- Update direct readers that bypass `copyThread` today:
  - `sheet-view.tsx:224` `activeCellThreads` useMemo →
    map through `copyThread`.
  - `document-detail.tsx:202` `allThreads` useMemo →
    map through `copyThread`.
- Backwards compatibility: existing threads in already-loaded docs were
  saved with truncated timestamps. They render as the same 1970 date
  (no regression — just no automatic repair). Accept this; not worth a
  migration for a not-yet-shipped feature.

## Tasks

- [x] Fix Issue B write side — bigint coercion in
      `applyAddThread`, `applyAddReply`, `applyEditComment`,
      `applyResolveThread`.
- [x] Fix Issue B read side — `Number(...)` coercion in `copyComment`
      / `copyThread` (via `fromYorkieMs`).
- [x] Wrap `activeCellThreads` in `sheet-view.tsx` and `allThreads` in
      `document-detail.tsx` through `copyThread`.
- [x] Fix Issue A — added `popoverAnchorRef`, rewrote selection handler
      guard to compare axis IDs, pin populated from both open paths,
      cleared via effect when popover closes.
- [x] Removed the dead `!wsNow?.comments` early-return block (absorbed
      into the unified guard).
- [x] Bumped tests: existing wire-shape tests now expect `bigint`,
      added a copyThread round-trip test for bigint → number.
- [x] `pnpm verify:fast` green.

## Verification

- Unit: existing comment store/thread tests stay green.
- Manual: two-tab live test — leave popover open on an empty cell in
  tab 1 while typing in tab 2; popover must stay open. Submit comment;
  remote peer must see relative time consistent with local.
- Structural: insert a row above the popover cell from the other tab;
  popover should follow the cell, not close.
