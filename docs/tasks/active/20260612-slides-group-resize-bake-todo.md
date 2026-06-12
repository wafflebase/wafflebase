# Slides: Bake Group Resize Into Children

**Goal:** Stop distorting glyphs (and other rendered content) when a
group is resized non-uniformly. Bake the resize delta into each
child's frame at commit time, so the canvas render-scale stays 1.

**Why:** Today the renderer multiplies child draws by
`(frame.w / refSize.w, frame.h / refSize.h)`. For a non-uniform group
resize this distorts text glyphs and any other content drawn at a
fixed font / line size. Google Slides and PowerPoint do not distort
in this case — they bake the resize into children. `ungroup` already
has the bake math (`applyGroupTransform`); this task wires the same
bake into the group resize commit.

## Approach

1. Pure helper `bakeGroupScale(group: GroupElement)` in
   `packages/slides/src/model/group.ts`. Returns the next
   `{ children, refSize }` such that:
   - `sx = frame.w / oldRefSize.w`, `sy = frame.h / oldRefSize.h`.
   - For each child: `frame.x *= sx`, `frame.y *= sy`,
     `frame.w *= sx`, `frame.h *= sy`. Rotation preserved.
   - For connector children: free endpoints `x *= sx, y *= sy`;
     attached endpoints unchanged.
   - New `refSize = { w: group.frame.w, h: group.frame.h }`.
   - No-op (return identity) when both scale factors are 1.

2. Store method `bakeGroupResize(slideId, groupId)` on the `Store`
   interface, implemented in `MemSlidesStore` and
   `YorkieSlidesStore`. Reads the group, calls the pure helper,
   writes the new children array + refSize back atomically.

3. Editor wiring: in `SlidesEditorImpl.startResize`'s `onUp`, when
   the resized element is a group, call
   `this.options.store.bakeGroupResize(slide.id, elementId)` AFTER
   `updateElementFrame`, inside the same `store.batch`. So the
   gesture is still one undo unit and the resize + bake commit
   together.

## Steps

- [ ] **Step 1:** Add pure helper `bakeGroupScale` to
  `packages/slides/src/model/group.ts` with co-located unit tests in
  `packages/slides/test/model/group.test.ts` (or create the file
  if missing). Cases:
  - Identity (sx = sy = 1) returns input.
  - Uniform 2x: child frames double in all dims.
  - Non-uniform (sx=2, sy=1): widths double, heights unchanged.
  - Rotated child: rotation preserved, dims still scale.
  - Connector with free + attached endpoints: free scales, attached unchanged.

- [ ] **Step 2:** Add `bakeGroupResize(slideId, groupId)` to the
  `Store` interface in `packages/slides/src/store/store.ts`.

- [ ] **Step 3:** Implement `bakeGroupResize` in
  `packages/slides/src/store/memory.ts` using the pure helper. No-op
  when group has no children or scale factors are 1.

- [ ] **Step 4:** Implement `bakeGroupResize` in
  `packages/frontend/src/app/slides/yorkie-slides-store.ts` (the
  collaborative impl) using the same pure helper.

- [ ] **Step 5:** Wire into `SlidesEditorImpl.startResize`'s `onUp`
  in `packages/slides/src/view/editor/editor.ts`. Single-element
  group branch only (multi-resize Task 5 already bakes multi-select
  via per-child frame updates and so does not need this hook).

- [ ] **Step 6:** Integration test in `packages/slides/test/view/editor/editor.test.ts`:
  - Seed a group with one text child + one rect child.
  - Resize the group non-uniformly.
  - After commit: `group.data.refSize` matches `group.frame.{w,h}`;
    children's frames are scaled accordingly; child element's
    rotation preserved.

- [ ] **Step 7:** Run `pnpm verify:fast`. Confirm green.

- [ ] **Step 8:** Commit with subject under 70 chars; body explains
  the bake rationale + the GS/PPT parity reference. Open PR.
