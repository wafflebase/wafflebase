---
title: slides-textbox-autogrow
target-version: 0.5.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Slides Text Box — Insert-to-Edit, Drag Sizing, Auto-Grow

## Summary

Three coordinated improvements to the Slides text-box authoring flow,
bringing it in line with Google Slides:

1. **Insert-to-edit** — inserting a text box drops the caret straight
   inside it (text-editing focus), instead of leaving an empty selected
   box that needs a double-click to type into.
2. **Drag sizing** — a text box can be drawn by dragging a rectangle
   (width + position), like shapes already can, instead of always being a
   single-click fixed-size box.
3. **Auto-grow** — the box height tracks its content (grow *and* shrink,
   minimum one line), updated live while typing.

Today (`editor.ts:startInsert`) the `text` branch single-click inserts a
fixed `TEXT_DEFAULT_W × TEXT_DEFAULT_H` box, selects it, and stops. Edit
mode is only reachable via `onDoubleClick`. Height is fixed: the docs
text engine lays text out by width only and never reports content height
back to the host, so a box never resizes to its content.

## Goals / Non-Goals

### Goals

- Inserting a text box immediately enters edit mode with a blinking
  caret (`enterEditMode` + `focus()`), matching Google Slides / PowerPoint.
- Text supports drag-to-size (width + position from the drag rect; a
  sub-threshold drag falls back to the default width), reusing the
  existing shape drag-preview flow.
- Text-box height fits its content (grow + shrink, min one line),
  reflected live during editing and persisted to the element frame.
- Shapes are unaffected — they still insert selected (no auto edit-mode).

### Non-Goals

- Width auto-fit (Google Slides "shrink text on overflow" / "resize
  shape to fit text" width modes). Width stays user-controlled.
- A per-element "do not autofit / shrink text to fit" autofit mode
  selector. Auto-grow is the single behavior for text boxes here.
- Shape text auto-grow (text inside non-text shapes).
- Mobile-specific tuning beyond what the shared editor already provides.

## Proposal Details

### Behavior

| Action | Result |
| --- | --- |
| Toolbar text → click (no drag) | Default-width box at the click point, height = one line, **edit mode + focus**. |
| Toolbar text → drag | Box at the drawn width + position, height = content (one line when empty), **edit mode + focus**. |
| Typing wraps past current height | Box grows downward live. |
| Deleting content | Box shrinks back to content height (min one line). |

Reconciliation note: because height always follows content (Google
Slides behavior), the drawn rectangle's **height is not retained** — the
drag contributes width and top-left position only, and the box snaps to
content height on creation. Shapes keep honoring the full drawn rect.

### Auto-grow: live height via a docs callback

The docs text engine already computes `layout.totalHeight` in
`computeLayout` on every `recomputeLayout()`; it is currently consumed
only internally in `packages/docs/src/view/text-box-editor.ts`. Text
layout is width-driven and
never clips by height, so height is purely the canvas/container size.
Live growth therefore needs two new seams in the docs text-box editor:

```ts
// packages/docs/src/view/text-box-editor.ts — TextBoxEditorOptions
/** Fired when the laid-out content height changes (logical px). */
onContentHeightChange?: (contentHeight: number) => void;

// TextBoxEditorAPI
/** Resize the editing surface's logical content height + repaint. */
setContentHeight(contentHeight: number): void;
```

- `contentHeight` becomes a mutable `let` in `initializeTextBox`.
  `setContentHeight` updates it, rebuilds the shim paginated layout
  (`buildShimPaginatedLayout`), and `requestRender()`s.
- `renderNow` compares `layout.totalHeight` against the last reported
  value and calls `onContentHeightChange(totalHeight)` only on change
  (same de-dupe pattern as `onCursorMove`).
- No loop: `onContentHeightChange` → host resizes canvas + calls
  `setContentHeight` → which re-renders but does not change
  `totalHeight` (height is not a layout input), so it does not re-fire.

### Slides wrapper (`packages/slides/src/view/editor/text-box-editor.ts`)

`mountSlidesTextBox` gains an `onContentHeightChange` option that it
forwards to `initializeTextBox`. When the docs editor reports a new
content height, the wrapper:

1. Resizes its `container` and `canvas` (CSS + bitmap, honoring `dpr`)
   to the new `height * scale`.
2. Calls `api.setContentHeight(newLogicalHeight)` so the docs editor's
   pointer math and shim page height stay consistent.
3. Surfaces the new logical height to the slides editor via the
   `onContentHeightChange` callback so the editor can persist it.

The wrapper exposes the host-facing callback through
`SlidesTextBoxEditor`.

### Slides editor (`packages/slides/src/view/editor/editor.ts`)

- `startInsert` `text` branch: replace the single-click insert with a
  drag-to-size flow mirroring the shape branch (live ghost preview via
  `forceRender(slide, doc, [ghost])`, `buildInsertElement('text', …)`
  for click-vs-drag). On `pointerup`, add the element, select it, disarm
  insert mode, then call `enterEditMode(slide.id, id)`.
- `enterEditMode`: pass an `onContentHeightChange` into `mountTextBox`.
  Height fit is `frame.h = max(MIN_TEXT_H, contentHeight)`
  (`MIN_TEXT_H` = one line). On change, persist via
  `store.updateElementFrame(slideId, elementId, { h })`. Frame writes go
  through a `batch` consistent with the rest of the editor.
- The committed slide canvas already renders text by width via
  `packages/slides/src/view/canvas/text-renderer.ts`; with the frame
height now matching content, no
  extra clipping work is needed.

### `buildInsertElement` (`packages/slides/src/view/editor/interactions/insert.ts`)

The `text` kind currently early-returns a fixed-size frame. Change it to
participate in the same click-vs-drag rect logic as shapes: drag rect
when the pointer moved past `CLICK_THRESHOLD_PX_SQ`, else
`TEXT_DEFAULT_W` width at `start`. Height at insert time can stay
`TEXT_DEFAULT_H`; `enterEditMode`'s first `onContentHeightChange` snaps
it to content (one line) immediately.

### Files

- `packages/docs/src/view/text-box-editor.ts` — `onContentHeightChange`
  option, `setContentHeight()` API, fire-on-change in `renderNow`.
- `packages/docs/src/index.ts` — confirm `TextBoxEditorAPI` re-export
  covers the new method (interface change only, no new export needed).
- `packages/slides/src/view/editor/text-box-editor.ts` — forward
  callback, resize container/canvas, delegate `setContentHeight`.
- `packages/slides/src/view/editor/interactions/insert.ts` — text
  click-vs-drag sizing.
- `packages/slides/src/view/editor/editor.ts` — text drag insert +
  `enterEditMode` on insert; persist height on grow.

### Testing

- `buildInsertElement` unit: text drag → drawn-width rect; sub-threshold
  → default width.
- docs `text-box-editor` unit: `onContentHeightChange` fires when a line
  is added/removed; `setContentHeight` rebuilds the shim layout.
- slides editor: inserting a text box sets `editingElementId` and calls
  `focus()`; an auto-grow height change calls `updateElementFrame`.

## Risks and Mitigation

- **Resize/recompute feedback loop.** Mitigated by firing
  `onContentHeightChange` only on `totalHeight` change and by
  `setContentHeight` not feeding back into `totalHeight`.
- **Collaboration churn.** Live `updateElementFrame` on every keystroke
  could spam CRDT ops. Mitigated by only persisting when the rounded
  height actually changes; intermediate visual growth is local
  container/canvas resizing, not a store write.
- **Editing overlay vs committed canvas mismatch.** The editing canvas
  and the committed `text-renderer` both lay out by width via the same
  `computeLayout`, so a fitted height stays pixel-consistent on commit.
- **Scope creep into width autofit / autofit modes.** Explicitly a
  non-goal; height-only fit keeps the change bounded.
