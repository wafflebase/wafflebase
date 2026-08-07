# Miro import — resolve parent-relative item positions

## Problem

A Miro board imported into a `"board"` document renders with almost every
shape piled into a small region at the left of the canvas, while the frames
sit spread out far to the right.

Measured on the real document (`board-c75b99ca-b99d-4bbb-b9d4-223767712a95`,
share token `0b44360c-…`), 5458 elements — shape 2720 / text 1896 /
connector 842:

| group | count | x range | y range |
| ----- | ----- | ------- | ------- |
| clustered | 4423 | −147 … 4,636 | −105 … 6,690 |
| rest (frames) | 193 | 5,709 … 46,263 | −23,469 … 6,309 |

96% of the non-connector elements land inside one ~4,000 × 6,700 box next to
the world origin; the x histogram puts 3,770 of them in `[0, 2000)` alone.

## Root cause

Miro's `GET /boards/{id}/items` expresses an item's `position` against the
**parent frame's top-left** (`position.relativeTo === "parent_top_left"`)
whenever the item has a `parent`; only parentless items are
`canvas_center`-absolute.

The backend forwards both fields — `MiroPosition.relativeTo`
(`packages/backend/src/miro/miro.types.ts:6`) and
`MiroItem.parent` (`:28`) — but the mapper never reads them:

- `packages/board/src/import/miro/types.ts` — `MiroItemLike.position` declares
  only `{ x, y }`, and there is no `parent` field at all.
- `packages/board/src/import/miro/geometry.ts:14` — `miroFrame()` treats every
  position as absolute ("Coordinates map 1:1").

So every framed item's frame-local coordinate is written as a world
coordinate, collapsing all of them onto the origin.

## Plan

- [ ] Failing test: an item with a `parent` frame maps to the frame's absolute
      position plus its relative offset.
- [ ] Failing test: `relativeTo: "canvas_center"` stays absolute even when a
      `parent` is present.
- [ ] Failing test: an item whose parent is missing from the payload keeps its
      raw position and is reported as an approximation.
- [ ] `geometry.ts` — `MiroPositionLike.relativeTo`, `MiroParentLike`, and a
      `resolveMiroFrames(items)` that resolves the whole payload once, with a
      cycle guard, returning the frames plus the unresolved-parent ids.
- [ ] `types.ts` — declare `parent` and `position.relativeTo` on
      `MiroItemLike`.
- [ ] `map-items.ts` — build the frame map from `resolveMiroFrames`; count a
      mappable item with an unresolvable parent under
      `approximated['parent-position']`.
- [ ] `miro-import-summary.ts` — wording for the new approximation kind.
- [ ] Update `docs/design/board/board-miro-import.md` with the coordinate rule.
- [ ] `pnpm verify:fast`.

## Notes / limits

- A rotated parent would also rotate its children's offsets. Miro frames are
  not rotatable, so the offset is applied as a pure translation.
- The already-imported document has the wrong coordinates baked into the CRDT.
  Re-import after this lands; no migration is planned.

## Review

(filled in after implementation)
