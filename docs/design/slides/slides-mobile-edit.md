---
title: slides-mobile-edit
target-version: 0.4.4
---

# Slides Mobile Light Edit (Phase B)

## Summary

Promote `MobileSlidesView` from read-only viewer to a touch-driven
light editor. The component already owns a `YorkieSlidesStore`
(needed for Present mode) but currently paints with `SlideRenderer`
only. Phase B replaces the render-only path with the full
`SlidesEditor` (the same one mounted on desktop) and adds three
mobile-specific UI affordances on top: a bottom-sheet text
formatting bar, a slide-ops floating action button (`+` / duplicate /
delete), and an undo/redo header pair.

Editing is enforced by what we mount, not by an editor flag. The
desktop `SlidesEditor` is reused intact — its programmatic surface
(`enterTextEditing`, `setSelection`, `getActiveTextEditor`,
`store.*`) is already what touch needs. No fork.

The companion read-only doc is
[`slides-mobile-view.md`](./slides-mobile-view.md); this doc extends
it for Phase B.

## Goals / Non-Goals

### Goals

- Tap an element on a mobile-mounted slide to select it. Drag to
  move. Drag a corner handle (enlarged for touch) to resize.
- Double-tap a text element to enter text edit; mobile virtual
  keyboard appears; `compositionstart`/`compositionend` produce the
  same Yorkie tree edits as desktop.
- Bottom-sheet shows bold / italic / underline / font-size / color
  while a text-box editor is active; controls call into
  `editor.getActiveTextEditor()`'s existing format API.
- Header gains undo / redo buttons wired to `store.undo()` /
  `store.redo()`. Always visible (not just during edit) — matches
  Google Slides mobile.
- Floating action button on the canvas: `+` adds a slide (default
  layout), long-press opens duplicate / delete / change-layout.
- All editing flows go through the existing `SlidesStore`, so
  multi-peer Yorkie sync, undo/redo, and persistence are inherited
  from desktop with zero new mutation surface.
- Read-only desktop fallback at ≥ 768px is unchanged (the
  `useIsMobile` branch in `slides-detail.tsx` still picks
  `MobileSlidesView` — only its internals change).

### Non-Goals

- Shape insert UI on mobile. Phase C. Adding shapes from a
  toolbar is dense and shape-picker isn't touch-friendly yet.
- Connectors (line / arrow / elbow). Phase C — endpoint snapping
  UX on touch is its own design problem.
- Theme / layout panel on mobile. Phase C.
- Notes editing on mobile. Notes panel stays unmounted; speaker
  notes are read-only viewable in a follow-up.
- Multi-select via lasso. Mobile uses tap-to-select (single) and
  long-press to add to selection if it falls out cleanly from the
  spike; otherwise single-only.
- Adjustment diamonds for parametric shapes. Hidden on mobile.
- Pinch-to-zoom of the slide canvas. Canvas already fits viewport
  width; deeper inspection deferred.
- Tablet-specific layout (≥ 768px). Tablets still get the desktop
  editor, same as Phase A.

## Proposal Details

### High-level architecture change

Today `MobileSlidesView` instantiates `YorkieSlidesStore` (for
Present) and a standalone `SlideRenderer` (for the canvas). Phase B
keeps the store, drops the renderer, and instead constructs the
desktop `SlidesEditor` against the same canvas + a new overlay div:

```text
                     before (Phase A)
  YorkieSlidesStore ──► (used only by Present)
       SlideRenderer ──► <canvas>   (read-only paint)

                     after (Phase B)
  YorkieSlidesStore ──► SlidesEditor ──► <canvas> + <overlay>
                                    └──► getActiveTextEditor() ──► <BottomSheet>
                                    └──► store.{addSlide, undo, ...}
```

The editor's public surface is the boundary. Mobile UI never
reaches into editor internals; mobile mutations go through the
store.

### Touch interaction strategy

Browsers synthesize a tap into `mousedown→mouseup→click`, so
single-event paths (select on tap, double-tap text-edit, blank-tap
clear) work for free. **But touch *drag* on iOS Safari does not
synthesize `mousemove` events** — only the down and up halves fire.
The editor uses `document.addEventListener('mousemove', ...)` after
a canvas mousedown to drive drag/resize/rotate/lasso/connector
flows; on iOS those move listeners never fire. Selection appears
on tap but the element won't follow the finger.

The fix is to migrate the editor's listeners from Mouse Events to
**Pointer Events** (Task 1a). `PointerEvent` inherits from
`MouseEvent` in TS, browsers synthesize pointer events from both
mouse and touch inputs, and the rename does not touch the state
machine, hit-test, drag-commit, or render pipeline. Desktop
behavior is unchanged; pen tablets and stylus input get supported
as a side-effect.

| Concern | Handling |
|---|---|
| Touch drag fires no move events (iOS Safari) | **Pointer Events migration in Task 1a** — `mouse*` listeners become `pointer*` across `editor.ts`, `thumbnail-panel.ts`, `context-menu.ts`, `layout-picker.ts`. Solved at the source. |
| iOS swipe-back at screen edge during drag | Cannot be intercepted — documented limitation. FAB and slide-strip navigation are the in-app workaround for users near the edge. |
| Browser pinch-zoom vs element drag | `touch-action: none` on the canvas-host suppresses both pinch and pan. Slide swipe-nav is gone in edit mode (FAB + strip replace it). |
| Resize handle hit area | The editor renders handles at 8px on desktop. A mobile mode bumps the *hit* radius to 22px (≈ 44px diameter) without changing the visual handle size — done by extending `hit-test.ts`'s `handleHitTest` with a `tolerance` parameter, default 0. |
| Double-tap zoom (iOS) | `touch-action: manipulation` on the canvas-host disables the 300ms double-tap zoom delay; the editor's double-click → text-edit fires immediately. (Subsumed by `touch-action: none` when we also need to block pinch.) |
| Long-press system callout (iOS) | The callout is NOT a `contextmenu` event — `oncontextmenu` is a no-op against it. The kill is CSS: `-webkit-touch-callout: none` + `user-select: none` on the canvas-host. (Right-click `oncontextmenu` is still suppressed for desktop edit mode.) |

The spike (Task 0, done) validated this list. Findings live in
[lessons](../../tasks/active/20260517-slides-mobile-edit-lessons.md):
selection / double-tap-text / blank-tap-clear work out of the box;
drag and long-press-callout were both blocked by the items above.
Gate decision: option (B), proceed with the Pointer Events migration
as Task 1a prerequisite.

### Bottom-sheet text formatting

A new component `MobileTextFormatSheet` mounts at the bottom of the
mobile shell, slide-up animated when `editor.isTextEditing()` is
true. It binds to `editor.getActiveTextEditor()`:

```tsx
const active = editor.getActiveTextEditor();
if (!active) return null;
return (
  <div className="bottom-sheet">
    <Toggle label="B" active={active.isBold()} onClick={() => active.toggleBold()} />
    <Toggle label="I" active={active.isItalic()} onClick={() => active.toggleItalic()} />
    <Toggle label="U" active={active.isUnderline()} onClick={() => active.toggleUnderline()} />
    <FontSizeStepper value={active.getFontSize()} onChange={active.setFontSize} />
    <ColorSwatch value={active.getColor()} onChange={active.setColor} />
  </div>
);
```

The `SlidesTextBoxEditor` interface already exposes these calls on
desktop (used by `toolbar/text-edit-section.tsx`); mobile binds
the same API. If any field is missing on the type, it gets added
in the same PR.

Sheet height ~64px. The canvas-host shrinks while the sheet is
visible, the editor's `setHostSize` re-derives scale, and the
selected text element stays in view via a scroll-into-view call.

### Slide ops FAB

Floating action button bottom-right, ~56×56, primary-color circle
with a `+` glyph. Tap = `store.addSlide(currentLayoutId)`. Long-press
opens a vertical menu (Radix `Popover` or a hand-rolled list — see
existing `context-menu.md` for the project's pattern):

- Duplicate slide → `store.duplicateSlide(currentSlideId)`
- Delete slide → `store.removeSlide(currentSlideId)` + advance to
  next-or-prev
- Change layout → opens a sheet of layout thumbnails; tap picks one
  → `store.applyLayout(currentSlideId, layoutId)`

The "change layout" sheet reuses the layout thumbnail rendering
from `view/canvas/layout-preview.ts`. Picker UI is mobile-native
(2-column grid of cards).

### Undo / redo

Header gains two icon buttons next to the title:

```text
[‹]  [↶] [↷]  {title…}                  [▶]
```

Wired to `store.undo()` / `store.redo()`. Buttons disabled when the
respective stack is empty; subscribed to a `store.onHistoryChange`
hook. If that hook doesn't exist yet on `YorkieSlidesStore`, it gets
added in the same PR — the desktop toolbar will benefit too.

### Read-only fallback

Adding edit removes read-only. For shared-link viewers (see
`sharing.md`) and any future "viewer" role we still need the
Phase-A behavior. Path: a `mode: 'edit' | 'view'` prop on
`MobileSlidesView`. `view` keeps the Phase-A `SlideRenderer` path;
`edit` is the new default. The `slides-detail.tsx` branch passes
`view` when the user lacks edit permission. This is the only place
that decides.

### File change summary

| File | Change |
|---|---|
| `packages/slides/src/view/editor/editor.ts` | **Task 1a:** migrate `mouse*` event listeners to `pointer*` (~35 listener strings). Mechanical rename, no state-machine change. |
| `packages/slides/src/view/editor/thumbnail-panel.ts` | **Task 1a:** Pointer Events migration (slide-strip drag-to-reorder). |
| `packages/slides/src/view/editor/context-menu.ts` | **Task 1a:** Pointer Events migration (pair-internal listeners only; `contextmenu` event itself unchanged). |
| `packages/slides/src/view/editor/layout-picker.ts` | **Task 1a:** Pointer Events migration (panel hover/click). |
| `packages/slides/src/view/editor/hit-test.ts` | Add `tolerance` parameter to `handleHitTest` for touch-sized hit areas. |
| `packages/slides/src/view/editor/text-box-editor.ts` | Expose missing format getters/setters on `SlidesTextBoxEditor` if any are mouse-toolbar-only. |
| `packages/slides/src/store/store.ts` | Add `onHistoryChange(cb): () => void` to `SlidesStore`. |
| `packages/slides/src/store/memory.ts` | Implement `onHistoryChange` for `MemSlidesStore`. |
| `packages/frontend/src/app/slides/yorkie-slides-store.ts` | Implement `onHistoryChange` for `YorkieSlidesStore`. |
| `packages/frontend/src/app/slides/mobile-slides-view.tsx` | Branch on `mode` prop; `edit` mounts `SlidesEditor` instead of `SlideRenderer`. Wires bottom-sheet, FAB, undo/redo. |
| `packages/frontend/src/app/slides/mobile-text-format-sheet.tsx` (new) | The bottom-sheet component. |
| `packages/frontend/src/app/slides/mobile-slide-ops-fab.tsx` (new) | The FAB + long-press menu. |
| `packages/frontend/src/app/slides/slides-detail.tsx` | Pass `mode` prop to `MobileSlidesView` based on user permission (default `edit`). |

No backend, model, or Yorkie schema changes. The editor's mutation
surface is unchanged.

### Spike — Task 0 outcome (done)

The spike ran on the iPhone 16 Pro simulator. `SlidesEditor` mounted
cleanly on the mobile shell; tap-select, double-tap-text-edit, and
blank-tap-clear all worked via iOS's tap-event synthesis. **Drag**
and **long-press callout** were blocked — see `### Touch interaction
strategy` above and the lessons file for the full matrix.

Gate decision: option (B). Task 1 split into 1a (Pointer Events
migration in the slides package) + 1b (the original mobile-mount
work, plus the long-press CSS suppression). Strict gate's 5-change
limit was breached by the ~38 listener-string rename, but the gate's
intent ("invasive — touches state machine") was not — the rename is
mechanical and desktop is unchanged. Pen tablet / stylus support
arrives as a side benefit.

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Pointer Events migration regresses a desktop interaction the spike didn't exercise (drag-out-of-canvas, right-click drag, alt-drag, etc.). | PR 1a is mechanical (event-type rename only). Desktop smoke covers drag, resize, rotate, drag-out-of-canvas, right-click context menu, thumbnail drag-reorder, layout picker. Pen tablet is bonus coverage — not a regression vector since Mouse Events fired for pen too. |
| Mobile IME `compositionstart`/`end` ordering differs from desktop; existing `text-box-editor.ts` IME paths may misbehave. | Tested in spike on real iOS and Android. Patches go in `text-box-editor.ts` since desktop also benefits from correctness. |
| Adding `mode: 'edit' \| 'view'` to `MobileSlidesView` mid-flight while a permission system is being designed elsewhere. | The prop has only two values and a `'edit'` default; downstream permission wiring can land independently. |
| Bottom-sheet covers the selected text-box when it sits near slide bottom. | Editor's `setHostSize` already supports dynamic host size; mobile shell shrinks the canvas-host while the sheet is open and scrolls the selection into view. |
| Undo/redo button state needs a `store.onHistoryChange` hook we don't have yet. | One method to add; mirrors the existing `onSelectionChange` pattern in `SlidesEditor`. Desktop toolbar benefits too. |
| Spike found > 5 internal editor changes (Pointer Events) — strict gate breach. | Resolved at gate time: option (B). The "5 changes" rule was a heuristic against a state-machine rewrite; the Pointer Events rename is mechanical, no state change, and desktop gets pen tablet support as a bonus. Option (A) (mobile-only editor over `SlidesStore`) is still the fallback if Task 1a smoke surprises us. |
