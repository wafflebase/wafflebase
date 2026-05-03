# Cmd+Arrow Axis Extension Regression Fix

## Problem

`Cmd+Down` / `Cmd+Right` on a sparse worksheet jumps `activeCell` to the
dimension boundary (row 1,000,000 / col 18,278). `Sheet.syncSelectionToPresence`
then calls `store.ensureAxisOrder(activeCell.r, activeCell.c)`, which in
`YorkieStore` does a `while (rowOrder.length < minRows) push(...)` loop —
generating ~1M (or ~18K) Yorkie array push operations as a single CRDT
transaction. The browser freezes for seconds.

Regression introduced by `923c5073` ("Ensure axis orders cover selection
range"). The original bug was about *range* selection (column E with only A-B
data → null colId → select-all). The fix unnecessarily seeded
`maxRow`/`maxCol` from `activeCell.r/c`, which now blows up for distant
single-cell positions.

## Plan

- [x] Add Vitest regression: Cmd+Down on empty sheet must not extend `rowOrder`.
- [x] Change `Sheet.syncSelectionToPresence`: initialize `maxRow=0, maxCol=0`;
      only ranges contribute. activeCell never drives axis-order extension.
- [x] Change `Store.updateSelection` signature to
      `(activeCell: CellAnchor | null, ranges: RangeAnchor[], activeCellRef: Ref)`
      so legacy Sref can be emitted independent of anchor availability.
- [x] Update `YorkieStore.updateSelection`: emit `selection` only when anchor
      is non-null; always emit legacy `activeCell` Sref derived from
      `activeCellRef`.
- [x] Update `MemStore` and `ReadOnlyStore` no-op signatures.
- [x] Drop the `if (!this.activeCellAnchor) return;` early-return; presence
      still updates (legacy Sref) even when anchor is null.
- [x] Add positive test: `selectColumn(5)` on empty sheet still extends colOrder.
- [x] Update `docs/design/sheets/axis-id-selection.md` with new signature and
      regression-mitigation note.
- [x] Run `pnpm verify:fast`; all green.
- [ ] Manual smoke: open empty sheet, press Cmd+Down then Cmd+Right; no freeze,
      cursor jumps instantly. (User to verify)

## Review

- `packages/sheets/src/model/worksheet/sheet.ts:2635-2671` — only ranges
  contribute to `ensureAxisOrder` arguments. Anchor null is allowed.
- `packages/frontend/src/app/spreadsheet/yorkie-store.ts:609-623` —
  `updateSelection` accepts `activeCell: CellAnchor | null` and an
  `activeCellRef: Ref`. Always emits legacy `activeCell` Sref.
- Peer cursor rendering already had dual-format fallback in
  `packages/sheets/src/view/overlay.ts:259-261` and `669-672`, so cells beyond
  axis-ID coverage still render via legacy Sref.

## Out of scope

- Lazy/sparse axis ID storage (bigger redesign — defer).
- Capping `dimension.rows`/`columns` to occupied area.

## Risks

- Empty distant cells lose anchor-based cross-edit tracking → acceptable
  (no data there to track). Dual-format peer rendering already falls back
  to legacy Sref (`overlay.ts:259-261`, `669-672`).
- Self-cursor: covered by legacy Sref emission and Sheet engine using `Ref`
  internally.
