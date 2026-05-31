# Slides: connector endpoints attached to grouped elements

Status: done

## Problem

In imported PPTX decks where a `<p:cxnSp>` connector targets a shape
nested inside a `<p:grpSp>` (e.g. a user-avatar pic inside a group),
the rendered arrow points to the **wrong** world position. Reproducer:
slide 24 of `Yorkie, 캐즘 뛰어넘기.pptx` — connectors 362/366 attach
to pic id=363 which lives inside group 371; both arrows land near the
slide's top-left corner instead of at the avatar.

## Root cause

1. PPTX importer correctly registers nested ids in `idMap` and emits
   `attached` endpoints pointing at the in-group element.
2. Group children are stored with **group-local** `frame` (via
   `worldToGroupLocal` in `import/pptx/shape.ts`). Renderer composes
   the parent group transform when *drawing* them, so visual position
   is correct.
3. The connector lookup map built by `slide-renderer.ts` (and
   `editor.ts`, `overlay.ts`, `store/memory.ts`) uses
   `flattenElements(slide.elements)` which preserves those local
   frames. `siteWorldPos()` then treats `el.frame.x/y` as world
   coordinates → endpoint snaps to the local offset interpreted as
   world, missing the group's translation/scale/rotation entirely.

## Fix

Option A (chosen): introduce `buildElementWorldLookup(elements)` in
`model/group.ts` that does a DFS while composing ancestor group
transforms via `groupToTransform` + `composeGroupMatrix`, and returns
each leaf with its frame transformed into world space via
`applyMatrix`. Replace the `new Map(flattenElements(...).map(...))`
construction at every connector-resolver callsite. For connector
elements inside groups we lift their `free` endpoints + `frame` to
world coords too (for parity, although our current group invariant
forbids connectors inside groups).

## Todo

- [x] Investigate root cause (slide 24 XML, importer, renderer paths)
- [x] Failing test in `test/view/canvas/connector-frame.test.ts`
- [x] Add `buildElementWorldLookup` in `model/group.ts`
- [x] Replace lookup construction at:
  - `view/canvas/slide-renderer.ts`
  - `view/editor/editor.ts` (two sites)
  - `view/editor/overlay.ts`
  - `store/memory.ts` (`elementsLookup`, `detachConnectorsTargeting`)
- [x] Update `docs/design/slides/slides-connectors.md`
- [x] `pnpm verify:fast`
- [x] Browser smoke on the affected deck (user confirmed)
- [x] Write lessons file, archive

## Files touched (planned)

- `packages/slides/src/model/group.ts`
- `packages/slides/src/view/canvas/slide-renderer.ts`
- `packages/slides/src/view/editor/editor.ts`
- `packages/slides/src/view/editor/overlay.ts`
- `packages/slides/src/store/memory.ts`
- `packages/slides/test/view/canvas/connector-frame.test.ts`
- `docs/design/slides/slides-connectors.md`
