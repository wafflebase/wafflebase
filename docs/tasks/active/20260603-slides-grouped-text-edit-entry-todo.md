# Slides: text-edit + adjustment-drag entry on grouped elements

**Owner:** @hackerwins
**Date:** 2026-06-03

## Why

On slide 22 of
`http://localhost:5173/shared/a9ccf804-5ed0-4661-baeb-ca4361acc8dc`
("타겟 사용자 찾기"), double-clicking the right-column text
"웹/모바일에서 도구 형 서비스를 개발하는 개발자" never enters text-edit mode.
The same gesture works on the title at the top of the same slide.

The textbox (`id 63bb8301`) is nested inside a group (`id 86919428`)
that also contains the dark background rect and the "설명" label.
`Selection.doubleClick` correctly drills into the group and selects
the leaf textbox, but the subsequent `Editor.enterEditMode` bails out
silently:

```ts
// editor.ts:2172
const element = slide.elements.find((e) => e.id === elementId);
if (!element || (element.type !== 'text' && element.type !== 'shape')) {
  return;
}
```

`Array.prototype.find` doesn't descend into `group.data.children`, so
any text/shape nested in a group is invisible to this path. Runtime
verification on the live page:

| Call | Result |
|---|---|
| `editor.enterTextEditing('7cb15d29')` (slide-root title) | `isTextEditing: true` ✓ |
| `editor.enterTextEditing('63bb8301')` (grouped textbox) | `isTextEditing: false` ✗ |

Same class of bug exists at the render-skip path (`editor.ts:893–907`):
it uses a flat `.map().filter()` to hide the editing element from the
slide canvas, so even if `enterEditMode` were patched in isolation
the editing element would keep painting underneath the overlay
(visible ghost copy).

## Scope

- `enterEditMode` must locate elements anywhere in the slide's element
  tree, not just at the top level.
- The text-box editor mounts to the overlay DOM in **world** coords
  (`frame.x * scale`, `frame.y * scale`, CSS rotate around centre).
  For grouped elements the stored `frame` is **group-local**, so the
  mount path must compose the ancestor group transforms before
  passing the frame to `mountTextBox`. There is already a canonical
  helper for this: `buildElementWorldLookup` in `model/group.ts`.
- The render-skip path must walk the element tree recursively so the
  editing element is masked regardless of how deeply it is nested.
- Store mutations (`withTextElement`, `withShapeText`,
  `updateElementFrame`) already use `findElementPath` and handle
  grouped elements; no store-side changes needed.

During implementation a second instance of the same anti-pattern
turned up on slide 31: the shape "Dogfooding" (a `pentagonArrow`
nested in a group) has an adjustment diamond, but dragging it did
nothing. `Editor.startAdjustmentDrag` opened with the same flat
`Array.prototype.find` and the same group-local-frame math. Folded
into this PR rather than chased into a follow-up — the fix is the
exact same shape and the diff sits in the same handful of lines.

## Plan

- [x] Branch off `main`, write this todo.
- [x] `enterEditMode`: replace the flat `find` with a path-based
      lookup (`findElement` recursive helper already lives at
      `editor.ts:3795`). Build the world frame via
      `buildElementWorldLookup` and pass that world-frame element to
      `buildEditTarget`. Keep `enterFrameH` reading the **local**
      element height since `store.updateElementFrame` writes back in
      local space.
- [x] Render-skip path (`editor.ts:893–907`): replace the flat map
      with a recursive walker (`maskEditingElement`) that rebuilds
      the element tree, preserving group nesting. Shape-text strip
      behaviour and text-element omission stay identical.
- [x] `startAdjustmentDrag` (`editor.ts:3278`): swap the flat
      `find` for `buildElementWorldLookup` so the start element
      resolves anywhere in the slide tree AND its frame is already
      composed through the ancestor group transforms — exactly what
      `adjustmentWorldToLocal` needs since the pointer it converts
      is in world coords.
- [x] `paintLiveAdjustments` (`editor.ts:3358`): replace the flat
      map with `replaceShapeAdjustments` (recursive) and resolve
      the live overlay element via `buildElementWorldLookup` so the
      yellow diamond and outline track grouped shapes during drag.
- [x] Vitest: `test/view/editor/grouped-text-edit-entry.test.ts` —
      asserts that `enterTextEditing(id)` on a grouped text element
      enters edit mode AND that the frame the mount path passes
      equals `buildElementWorldLookup(...).get(id).frame`.
      (Adjustment-drag end-to-end isn't testable in jsdom because
      handle hit-testing reads `overlay.getBoundingClientRect` which
      jsdom reports as zero; manual smoke covers it.)
- [x] Manual smoke: slide 22 of the shared deck, double-click
      "웹/모바일..." → text-edit enters and the in-place editor lines
      up with the dark rect. Then Escape to exit. Title editing on
      the same slide still works.
- [x] Manual smoke: slide 31 of the same deck, drill into the
      Dogfooding group, drag the yellow diamond on the pentagon
      arrow → store's `data.adjustments` reflects the new value
      (verified live; undid the test mutation via `store.undo()`).
- [x] `pnpm verify:fast` green.

## Out of scope (deliberate)

- Groups with `rotation !== 0` or non-uniform scale. The world-frame
  path supports them mathematically (composeAncestorTransform tracks
  rotation; applyGroupTransform scales w/h), but autofit-grow at
  commit writes the editor's reported content height directly into
  `frame.h` via `store.updateElementFrame`. That value is in the
  editor's logical coords (= world h for scale-1 groups). For scaled
  groups the height would need to be divided by the cumulative
  scaleY before being stored. The slide-22 deck (and every group on
  it) has rotation 0 and refSize === frame, so the scope-1 case
  covers the reported bug. Scaled-group autofit becomes a follow-up
  if a real deck triggers it.
- Docs/sheets: this is a slides-only path; no other package surfaces
  the same `slide.elements.find` pattern.

## Review

Two view-layer code paths assumed `slide.elements` is flat:

- `enterEditMode` and the editing-element render mask (text-edit
  entry on grouped text/shape).
- `startAdjustmentDrag` and `paintLiveAdjustments` (adjustment
  diamond drag on grouped shapes).

Both got the same shape of fix: resolve the element via the
recursive helper, and use `buildElementWorldLookup` whenever the
downstream code expects world coords (overlay mount, world↔local
adjustment conversion). The store-side mutation APIs
(`requireElement`, `updateElementData`, `updateElementFrame`,
`withTextElement`, `withShapeText`) already walk the tree via
`findElementPath`, so the writes work transparently.

Live verification on the shared deck:

- Slide 22 "웹/모바일…" double-click → edit mode entered, in-place
  editor's dashed outline aligns with the dark rect; canvas no
  longer double-paints the underlying text.
- Slide 31 Dogfooding pentagon arrow adjustment drag → adjustments
  went 50000 → 19376 in the store after a 100-px horizontal drag
  through the in-flight live preview.

## Lessons

See [20260603-slides-grouped-text-edit-entry-lessons.md](./20260603-slides-grouped-text-edit-entry-lessons.md).
