# Slides Group / Ungroup — Lessons

Companion to [20260517-slides-group-todo.md](./20260517-slides-group-todo.md).
Capture anything surprising while implementing the design.

## Lessons captured

- **Keep inverse-matrix math in one canonical place.** `model/group.ts`
  owns `applyGroupTransform` / `normalizeToGroupLocal`; `import/pptx/group.ts`
  owns the quadratic-solver variant for non-uniform-scale PPTX matrices.
  Both call the same low-level `applyMatrix`. When a third call site appears
  (e.g. hit-test, PDF export), import from `model/group.ts` — do not
  re-derive the inverse inline or the signs will drift between files.

- **Name collision: `applyGroupTransform` in two modules.** `model/group.ts`
  and `import/pptx/group.ts` each export a function named
  `applyGroupTransform` with different signatures (one takes a
  `GroupElement`, the other a `GroupTransform`). This was resolved by
  exporting the lower-level matrix version from `pptx/group.ts` as
  `applyGroupTransformMatrix`. Future contributors: when adding a third
  module that needs group math, alias at the import site to make the
  provenance explicit.

- **Connector partitioning must thread ancestor transforms for free endpoints.**
  A connector with two coordinate endpoints (no element refs) stores those
  coordinates in the connector's own local space. When partitioning during
  `group()`, free endpoints must be converted to group-local space via
  `normalizeToGroupLocal` — failing to do so leaves them in the parent
  (slide-root) space and the connector renders incorrectly after grouping.
  The element-ref case is simpler: ids are stable and the renderer resolves
  them at paint time inside the correct local space.

- **PPTX `<p:grpSp>` direction convention: forward for compose, inverse for normalize.**
  The importer's old "flatten" path called `applyGroupTransform` (forward
  compose, world → leaf) to emit world-frame elements. The new
  "preserve-group" path calls `normalizeToGroupLocal` (inverse) to convert
  those same world frames back to group-local. This is the cleanest pattern
  for PPTX round-trip fidelity: run the flatten path to get a reference
  world frame, then invert to land in local space. The property test in
  `import/pptx/group.test.ts` enforces sub-pixel agreement (≤ 0.5 px)
  between both code paths per fixture leaf.

- **`selectAt` became dead code after the Task 9 rewire.** The
  click-handler in `editor.ts` was refactored to dispatch all hit results
  through `SelectionController.click()`, which made the standalone
  `selectAt` helper in `view/editor/interactions/select.ts` unreachable.
  It was not deleted in the same PR to keep the diff reviewable; a
  follow-up cleanup is tracked in `slides-group.md § Known Limitations`.
