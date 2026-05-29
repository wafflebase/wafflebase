---
title: slides-mobile
target-version: 0.4.4
---

# Slides Mobile

## Summary

A touch-driven mobile experience for the slides package, mounted whenever
the viewport is narrower than 768px. `SlidesView` branches on the existing
`useIsMobile()` hook and delegates to `MobileSlidesView`, which exposes
two modes:

- **`mode: 'view'` (read-only, Phase A — v0.4.3).** Paints with a
  standalone `SlideRenderer` and surfaces swipe navigation plus a
  Present-mode entry. Read-only is enforced by *not mounting* the
  editor — no mutation pathway exists.
- **`mode: 'edit'` (light editing, Phase B — v0.4.4, default).** Replaces
  the renderer with the full desktop `SlidesEditor` and adds three
  mobile-specific UI affordances on top: a bottom-sheet text formatting
  bar, a slide-ops floating action button (`+` / duplicate / delete /
  change layout), and an undo/redo header pair.

`mode` is decided by the outer route (`slides-detail.tsx`): viewers
without edit permission get `'view'`; everyone else gets `'edit'`. Phase
A and Phase B share the same Yorkie attachment and the same shell
chrome (header, canvas-host, footer); only the rendering surface
swaps.

Editing — when enabled — is reused intact from desktop. The editor's
programmatic surface (`enterTextEditing`, `setSelection`,
`getActiveTextEditor`, `store.*`) is already what touch needs. No fork.

## Goals / Non-Goals

### Goals

- Slide decks are readable and navigable on phones (≤ 767px viewport),
  with or without edit permission.
- Tap an element on a mobile-mounted slide to select it. Drag to move.
  Drag a corner handle (enlarged for touch) to resize.
- Double-tap a text element to enter text edit; mobile virtual keyboard
  appears; `compositionstart`/`compositionend` produce the same Yorkie
  tree edits as desktop.
- Bottom-sheet shows bold / italic / underline / font-size / color while
  a text-box editor is active; controls call into
  `editor.getActiveTextEditor()`'s existing format API.
- Header gains undo / redo buttons wired to `store.undo()` /
  `store.redo()`. Always visible (not just during edit) — matches Google
  Slides mobile.
- Floating action button on the canvas: `+` adds a slide (default
  layout), long-press opens duplicate / delete / change-layout.
- Read-only viewers (no edit permission, shared-link viewers) get the
  Phase-A `SlideRenderer` path. Read-only is enforced *by not mounting
  the editor*, not by a `readOnly` flag.
- Present mode (`packages/slides/src/view/present`) is reachable in one
  tap from the mobile header, using the existing fullscreen overlay
  fallback already shipped for browsers that block the Fullscreen API.
- Crossing the 768px breakpoint at runtime (window resize, device
  rotation) swaps cleanly between desktop and mobile mounts without
  losing the active Yorkie attachment.
- All editing flows go through the existing `SlidesStore`, so multi-peer
  Yorkie sync, undo/redo, and persistence are inherited from desktop
  with zero new mutation surface.
- No regression to the desktop editor — the desktop code path is
  unchanged.

### Non-Goals

- Shape insert UI on mobile. Phase C. Toolbar shape-picker isn't
  touch-friendly yet.
- Connectors (line / arrow / elbow). Phase C — endpoint snapping UX on
  touch is its own design problem.
- Theme / layout panel on mobile. Phase C.
- Notes editing on mobile. Notes panel stays unmounted; speaker notes
  are read-only viewable in a follow-up.
- Multi-select via lasso. Mobile uses tap-to-select (single) and
  long-press to add to selection if it falls out cleanly from the spike;
  otherwise single-only.
- Adjustment diamonds for parametric shapes. Hidden on mobile.
- Pinch-to-zoom of the slide canvas. Canvas already fits viewport width;
  deeper inspection deferred.
- Tablet-specific layout (≥ 768px). Tablets still get the desktop
  editor.
- Speaker-notes panel on mobile. Notes are not surfaced; reuse on mobile
  waits for Phase C or a notes-aware presenter view.
- Shared-link read-only flow (`sharing.md`). The viewer is a natural
  building block, but wiring viewer roles to share tokens is a separate
  task.
- URL-stateful slide index. The current slide id is component-local;
  reload returns to the first slide.

## Proposal Details

### Detection and branching

`SlidesView` (`packages/frontend/src/app/slides/slides-view.tsx`)
branches at the top of its render based on `useIsMobile()`
(`packages/frontend/src/hooks/use-mobile.ts`), which tracks
`(max-width: 767px)`:

```tsx
const isMobile = useIsMobile();
if (isMobile) {
  return <MobileSlidesView documentId={documentId} mode={mobileMode} ... />;
}
// existing desktop editor mount path, unchanged
```

When the viewport crosses 768px at runtime, React unmounts one tree and
mounts the other. The desktop editor's `useEffect` cleanup tears down
the RAF tick, thumbnail panel, notes panel, editor instance, and style
tag. The Yorkie `useDocument` attachment lives on the surrounding
`DocumentProvider`, so the document stays attached across the swap.

`mobileMode` is passed by `slides-detail.tsx`: `'view'` when the user
lacks edit permission, `'edit'` otherwise (default).

### MobileSlidesView shell

`packages/frontend/src/app/slides/mobile-slides-view.tsx` owns the
mobile-side shell, shared between view and edit modes.

**DOM structure:**

```html
<div class="mobile-slides">
  <header>
    <button aria-label="Back to deck list">‹</button>
    <button aria-label="Undo">↶</button>      <!-- edit mode only -->
    <button aria-label="Redo">↷</button>      <!-- edit mode only -->
    <h1 class="truncate">{title}</h1>
    <button aria-label="Start presentation">▶</button>
  </header>
  <div ref={canvasHostRef} class="canvas-host">
    <canvas />
  </div>
  <footer>
    <button aria-label="Previous slide">‹</button>
    <span>{index + 1} / {slides.length}</span>
    <button aria-label="Next slide">›</button>
  </footer>
</div>
```

The outer container uses `100dvh` (dynamic viewport height) with a
`100vh` fallback so the iOS Safari address-bar collapse/expand does not
visually shift the canvas. Header is `≈ 44px`, footer `≈ 28px`,
`canvas-host` is `flex: 1`.

**Yorkie data flow:**

- `useDocument<YorkieSlidesRoot, SlidesPresence>()` provides the
  document handle, same as the desktop view.
- `ensureSlidesRoot(doc)` is called once on mount — a no-op when the
  document is already populated, a one-shot scaffold on empty decks.
- In `'view'` mode, the deck's slides/theme/meta are read from the
  Yorkie root into React state; `doc.subscribe((e) => ...)` triggers a
  re-snapshot on `remote-change` events. No writes are issued.
- In `'edit'` mode, the `YorkieSlidesStore` is constructed and passed
  to `SlidesEditor`, which subscribes and writes through the same
  desktop pathway.

### Mode A — read-only view (Phase A)

When `mode === 'view'`, the canvas-host hosts a standalone
`SlideRenderer` (`packages/slides/src/view/canvas/slide-renderer.ts`):

- A single `SlideRenderer` instance is created on mount, imported
  directly from `@wafflebase/slides`.
- A `ResizeObserver` on `canvasHostRef` tracks the available width and
  height; `computeFitSize` (existing 16:9 width-binding helper) computes
  the logical canvas size. DPR scaling matches desktop/presenter
  (backing store at `size × dpr`, CSS at `size`).
- Re-render is triggered when (a) slides array changes, (b)
  `currentSlideId` changes, (c) `canvasHostRef`'s box changes. There is
  no per-frame RAF tick; the slide is static between events.

The `computeFitSize` math is currently duplicated in `slides-view.tsx`,
`view/present/presenter.ts`, and the mobile view. The package keeps no
frontend dependencies, so a third copy of ~10 lines is cheaper than
introducing a shared utility.

**Read-only enforcement.** Read-only is a property of construction, not
configuration:

| Mutation source on desktop                | Why view mode cannot trigger it                    |
| ----------------------------------------- | -------------------------------------------------- |
| Toolbar buttons                           | Not mounted                                        |
| Keymap shortcuts                          | Not mounted                                        |
| Drag handles / adjustment diamonds        | Not mounted                                        |
| Double-tap / dblclick to enter text-edit  | No handler attached                                |
| Yorkie `doc.update()` from editor         | Editor is not instantiated                         |
| Shape picker / theme panel / notes panel  | Not mounted                                        |

The only write that *can* happen is `ensureSlidesRoot(doc)`, which is
a no-op on populated decks and a one-shot scaffold on empty ones. An
empty deck has nothing to protect.

### Mode B — light editing (Phase B)

When `mode === 'edit'`, the canvas-host instead hosts the desktop
`SlidesEditor` against the same canvas + a new overlay div:

```text
                     mode: 'view'
  YorkieSlidesStore ──► (used only by Present)
       SlideRenderer ──► <canvas>   (read-only paint)

                     mode: 'edit'
  YorkieSlidesStore ──► SlidesEditor ──► <canvas> + <overlay>
                                    └──► getActiveTextEditor() ──► <BottomSheet>
                                    └──► store.{addSlide, undo, ...}
```

The editor's public surface is the boundary. Mobile UI never reaches
into editor internals; mobile mutations go through the store.

#### Touch interaction strategy

Browsers synthesize a tap into `mousedown→mouseup→click`, so
single-event paths (select on tap, double-tap text-edit, blank-tap
clear) work for free. **But touch *drag* on iOS Safari does not
synthesize `mousemove` events** — only the down and up halves fire. The
editor uses `document.addEventListener('mousemove', ...)` after a
canvas mousedown to drive drag/resize/rotate/lasso/connector flows;
on iOS those move listeners never fire. Selection appears on tap but
the element won't follow the finger.

The fix is to migrate the editor's listeners from Mouse Events to
**Pointer Events** (Task 1a). `PointerEvent` inherits from `MouseEvent`
in TS, browsers synthesize pointer events from both mouse and touch
inputs, and the rename does not touch the state machine, hit-test,
drag-commit, or render pipeline. Desktop behavior is unchanged; pen
tablets and stylus input get supported as a side-effect.

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
Gate decision: option (B), proceed with the Pointer Events migration as
Task 1a prerequisite.

#### Bottom-sheet text formatting

A new component `MobileTextFormatSheet` mounts at the bottom of the
mobile shell, slide-up animated when `editor.isTextEditing()` is true.
It binds to `editor.getActiveTextEditor()`:

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

`SlidesTextBoxEditor` already exposes these calls on desktop (used by
`toolbar/text-edit-section.tsx`); mobile binds the same API. Missing
fields are added in the same PR.

Sheet height ~64px. The canvas-host shrinks while the sheet is visible,
the editor's `setHostSize` re-derives scale, and the selected text
element stays in view via a scroll-into-view call.

#### Slide ops FAB

Floating action button bottom-right, ~56×56, primary-color circle with
a `+` glyph. Tap = `store.addSlide(currentLayoutId)`. Long-press opens
a vertical menu (Radix `Popover` or a hand-rolled list — see
`context-menu.md` for the project's pattern):

- Duplicate slide → `store.duplicateSlide(currentSlideId)`
- Delete slide → `store.removeSlide(currentSlideId)` + advance to
  next-or-prev
- Change layout → opens a sheet of layout thumbnails; tap picks one →
  `store.applyLayout(currentSlideId, layoutId)`

The "change layout" sheet reuses the layout thumbnail rendering from
`view/canvas/layout-preview.ts`. Picker UI is mobile-native (2-column
grid of cards).

#### Undo / redo

Header gains two icon buttons next to the title:

```text
[‹]  [↶] [↷]  {title…}                  [▶]
```

Wired to `store.undo()` / `store.redo()`. Buttons disabled when the
respective stack is empty; subscribed to a `store.onHistoryChange` hook.
If that hook doesn't exist yet on `YorkieSlidesStore`, it gets added in
the same PR — the desktop toolbar will benefit too.

### Navigation (both modes)

**Current slide state**: `useState<string>(slides[0]?.id ?? '')`, kept
in sync with the slides array (if the current slide is removed by a
collaborator, falls back to `slides[0]?.id ?? ''`).

**Prev/next**: thin helpers that look up the current index and clamp at
the array ends.

```typescript
function nextSlide() {
  const i = slides.findIndex((s) => s.id === currentSlideId);
  if (i < 0 || i >= slides.length - 1) return;
  setCurrentSlideId(slides[i + 1].id);
}
```

**Swipe gesture** (view mode only — edit mode disables it so drag
gestures reach the editor): a `usePointerSwipe` hook on `canvasHostRef`
listens for `pointerdown` / `pointermove` / `pointerup`.

- `start` captures `(x, y, time)`.
- On `pointermove`, once `|dx| > 10px`, classify as horizontal if
  `|dx| > |dy|`, else cancel. Once classified as horizontal, set
  `touch-action: none` and call `preventDefault` to suppress the iOS
  swipe-back gesture (where the browser allows it — edge-anchored
  system gestures cannot be intercepted).
- On `pointerup`, if `|dx| > 50px` and elapsed time `< 600ms`, fire
  `dx < 0 ? nextSlide() : prevSlide()`.
- A single tap (no movement) is a no-op in view mode.

**Footer arrow buttons** are an explicit, accessible fallback for
screen readers and any environment where the pointer events do not
classify cleanly. Present in both modes.

**Present button**: invokes the same `onStartPresentation('current')`
callback that the desktop view uses. The outer route shell already
owns presentation mode and the fullscreen-overlay fallback; the mobile
view is just another trigger.

### Loader / error states

Reuses the existing `<Loader />` component during `useDocument`'s
`loading` state and the existing `toast` for errors. Matches
`SlidesView`'s current treatment and keeps the component small.

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
| `packages/frontend/src/app/slides/slides-view.tsx` | Add `useIsMobile()` branch at the top of render; delegate to `MobileSlidesView` when true. |
| `packages/frontend/src/app/slides/mobile-slides-view.tsx` | Shell + `mode: 'view' \| 'edit'`. `view` mounts `SlideRenderer`; `edit` mounts `SlidesEditor`. Wires bottom-sheet, FAB, undo/redo for edit mode. |
| `packages/frontend/src/app/slides/mobile-text-format-sheet.tsx` (new) | The bottom-sheet component. |
| `packages/frontend/src/app/slides/mobile-slide-ops-fab.tsx` (new) | The FAB + long-press menu. |
| `packages/frontend/src/app/slides/slides-detail.tsx` | Pass `mode` prop to `MobileSlidesView` based on user permission (default `edit`). |
| `packages/frontend/src/hooks/use-pointer-swipe.ts` (new) | Small hook (~50 lines) encapsulating the pointer classification described above (view mode). Unit-testable. |

No backend, model, or Yorkie schema changes. The editor's mutation
surface is unchanged.

### Spike — Task 0 outcome (done)

The spike ran on the iPhone 16 Pro simulator. `SlidesEditor` mounted
cleanly on the mobile shell; tap-select, double-tap-text-edit, and
blank-tap-clear all worked via iOS's tap-event synthesis. **Drag** and
**long-press callout** were blocked — see Touch interaction strategy
above and the lessons file for the full matrix.

Gate decision: option (B). Task 1 split into 1a (Pointer Events
migration in the slides package) + 1b (the original mobile-mount work,
plus the long-press CSS suppression). Strict gate's 5-change limit was
breached by the ~38 listener-string rename, but the gate's intent
("invasive — touches state machine") was not — the rename is mechanical
and desktop is unchanged. Pen tablet / stylus support arrives as a side
benefit.

### Testing

- **Unit (frontend):** `use-pointer-swipe.ts` — gesture classification
  thresholds (horizontal vs vertical, time cap, dead-zone). Pure
  function over synthetic pointer events.
- **Unit (slides):** existing `SlideRenderer` tests cover correct
  rendering; no new tests needed for renderer reuse.
- **Component (frontend):** `MobileSlidesView` mount renders the header,
  footer, and a canvas; clicking the footer next button advances the
  slide index by 1; the back and present buttons fire their respective
  callbacks. Separate cases assert `mode: 'view'` does not mount the
  editor and `mode: 'edit'` does.
- **Visual (`pnpm verify:browser:docker`):** fixtures at 360×640,
  390×844, and 430×932 viewports verify header + canvas + footer layout
  and that the first slide paints in both modes.
- **Manual smoke:** `pnpm dev` → DevTools mobile emulation; verify
  swipe navigation (view), drag + double-tap-edit (edit), Present
  button (fullscreen overlay fallback on iOS), and clean transition
  when toggling between mobile (375px) and desktop (1024px) emulated
  widths.

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Pointer Events migration regresses a desktop interaction the spike didn't exercise (drag-out-of-canvas, right-click drag, alt-drag, etc.). | PR 1a is mechanical (event-type rename only). Desktop smoke covers drag, resize, rotate, drag-out-of-canvas, right-click context menu, thumbnail drag-reorder, layout picker. Pen tablet is bonus coverage — not a regression vector since Mouse Events fired for pen too. |
| Mobile IME `compositionstart`/`end` ordering differs from desktop; existing `text-box-editor.ts` IME paths may misbehave. | Tested in spike on real iOS and Android. Patches go in `text-box-editor.ts` since desktop also benefits from correctness. |
| Adding `mode: 'edit' \| 'view'` to `MobileSlidesView` mid-flight while a permission system is being designed elsewhere. | The prop has only two values and a `'edit'` default; downstream permission wiring can land independently. |
| Bottom-sheet covers the selected text-box when it sits near slide bottom. | Editor's `setHostSize` already supports dynamic host size; mobile shell shrinks the canvas-host while the sheet is open and scrolls the selection into view. |
| Undo/redo button state needs a `store.onHistoryChange` hook we don't have yet. | One method to add; mirrors the existing `onSelectionChange` pattern in `SlidesEditor`. Desktop toolbar benefits too. |
| Spike found > 5 internal editor changes (Pointer Events) — strict gate breach. | Resolved at gate time: option (B). The "5 changes" rule was a heuristic against a state-machine rewrite; the Pointer Events rename is mechanical, no state change, and desktop gets pen tablet support as a bonus. Option (A) (mobile-only editor over `SlidesStore`) is still the fallback if Task 1a smoke surprises us. |
| Two `computeFitSize` copies (desktop, presenter) become three. | Accepted; the math is ~10 lines and the slides package must stay frontend-agnostic. Revisit if a fourth caller appears. |
| Pointer-event classification misfires on Android Chrome where horizontal scroll containers compete for the swipe gesture. | The mobile view has no scrollable ancestors inside the canvas host; outer container is `overflow: hidden`. Footer arrows are the fallback. |
| iOS system swipe-back at the screen edge cannot be prevented. | Documented limitation. Users who initiate near the edge will navigate away; this is consistent with every other mobile web app. |
| `useDocument`'s remote change causes the current slide to be removed mid-view. | Fall back to the first slide if `currentSlideId` is not found in the new slides array. No user-visible error. |
| Memory/perf: `SlideRenderer` re-runs on every resize during window drag. | Wrap the resize handler in `requestAnimationFrame` coalescing; same pattern used by presenter.ts. |
