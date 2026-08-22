# Extend Selection endpoints with lineAffinity (#66)

Follow-up to PR #65, which introduced cursor `lineAffinity` to disambiguate
caret placement at visual wrap boundaries. Selection endpoints are still
plain `{ blockId, offset }`, so `selection.ts` resolves every boundary
offset with `findPageForPosition`'s default backward affinity. When an
anchor or focus lands exactly on a wrap-boundary offset, the highlight
starts at the previous line's end instead of the clicked line's start.

## Acceptance criteria

- [ ] The selection endpoint type carries `lineAffinity` alongside
      `blockId` and `offset`.
- [ ] `setRange` / `getNormalizedRange` preserve the affinity on both
      endpoints (including the reversed anchor/focus case).
- [ ] `selection.ts` passes the endpoint affinity through to
      `findPageForPosition` when computing selection boundaries.
- [ ] Endpoints without an affinity keep today's behavior (backward).

## Plan

1. `packages/docs/src/model/types.ts` — add optional
   `lineAffinity?: 'forward' | 'backward'` to `DocPosition`. That *is* the
   selection endpoint type (`DocRange.anchor` / `.focus`), so this is the
   smallest change that satisfies the request; it stays advisory metadata
   that model operations ignore.
2. `packages/docs/src/view/selection.ts`
   - `positionToPagePixel` takes a `lineAffinity` argument and forwards it
     to `findPageForPosition`.
   - `buildRects` derives a start/end affinity from the endpoints and uses
     it for the endpoint blocks only (interior blocks start at offset 0 /
     end at the block length, where affinity is meaningless).
   - the multi-line branch's second `findPageForPosition` pair gets the
     same affinity, so the first/last line rects agree with the pixels.
   - the cell-internal branch feeds the endpoint affinity into
     `resolvePositionPixel` and `lineIdxForOffset` (which already
     hard-coded forward/backward).
3. `packages/docs/src/view/text-editor.ts` — populate the affinity on
   selection endpoints produced from a pixel hit: single click, shift+click,
   and the drag focus (`updateDragSelection`, body and header/footer).
4. `packages/frontend/src/app/docs/yorkie-doc-store.ts` — carry the
   endpoint affinity into `AnchoredDocPosition` (the field already exists
   for the caret) and back out of `resolveAnchoredDocPosition`, so peer
   selections and undo/redo restore keep it.
5. Test: `packages/docs/test/view/selection-line-affinity.test.ts` — a
   wrapped two-line block where the boundary offset with `forward`
   affinity paints from the second line's start, while the same offset
   without affinity keeps the backward (first line) result.
6. Note the endpoint affinity in
   `docs/design/docs/docs-local-caret-anchoring.md`.

## Out of scope

- Word / paragraph selection (double, triple click) affinity heuristics.
- Changing the default affinity for endpoints that do not carry one.
