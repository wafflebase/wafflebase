# Docs Local Caret Anchoring Lessons

## Lessons

- Yorkie's `pathToIndex` plus `indexRangeToPosRange` can anchor collapsed
  caret positions across body, header, footer, and table-cell text because all
  regions share the same `root.content` Tree.
- `pendingCursorPos` should remain separate from local caret anchors for now:
  it is undo/redo presence history, while the anchor is the canonical remote
  change cursor state.
- Yorkie's `CRDTTreePos` is `(parentID, leftSiblingID)`, which already gives
  the design's required "left affinity for remote inserts at the same
  boundary" behavior. A normalization wrapper is unnecessary as long as
  `tree.indexRangeToPosRange([n, n])` is used for the anchor.
- `splitBlock` and `mergeBlock` currently use `delete + insert` against the
  Yorkie Tree. Anchors that target deleted text cannot follow these
  operations through CRDT semantics, so the fallback ladder takes over.
  Switching to native `splitLevel=2` would preserve the logical offset but
  requires also addressing the previously documented undo/redo regression.
- The IME composition start position lives in `packages/docs`'s `TextEditor`.
  Bridging it through the collaboration layer needed three small hooks:
  `onCompositionStart`/`onCompositionEnd` callbacks for capture/clear, and
  `updateCompositionStartPosition` for replay after a remote-resolved anchor.
- Capturing the region's top-level block index in the anchor lets the
  fallback ladder pick "end of the previous region block" / "start of the
  next region block" deterministically when the anchored block is gone.
- The frontend integration test script currently depends on `tsx`, which is
  not available in this workspace even through `npx -y`; unit coverage and
  TypeScript checks still validate the new anchor helpers locally.
