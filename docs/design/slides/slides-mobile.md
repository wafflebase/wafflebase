---
title: slides-mobile
target-version: 0.4.4
---

# Slides Mobile

## Summary

A touch-driven mobile experience for the slides package, mounted whenever
the viewport is narrower than 768px. The owner route (`slides-detail.tsx`)
and the shared-link route (`shared-document.tsx`) both branch on the
existing `useIsMobile()` hook and delegate to `MobileSlidesView`, which
exposes two modes:

- **`mode: 'view'` (read-only, Phase A — v0.4.3).** Paints with a
  standalone `SlideRenderer` and surfaces swipe navigation plus a
  Present-mode entry. Read-only is enforced by *not mounting* the
  editor — no mutation pathway exists.
- **`mode: 'edit'` (light editing, Phase B — v0.4.4).** Replaces
  the renderer with the full desktop `SlidesEditor` and adds
  mobile-specific UI affordances: a parent-owned `MobileSlidesToolbar`
  (`toolbar/mobile-toolbar.tsx`) for text formatting, and an add-slide
  (`+`) button inside the horizontal `ThumbnailStrip`. Undo/redo and the
  Present button are owned by the parent `SlidesToolbar` / `SiteHeader`,
  not by `MobileSlidesView` itself.

`mode` is decided by the route: `slides-detail.tsx` (owner) mounts
`MobileSlidesView` with `mode="edit"` hardcoded, while
`shared-document.tsx` (shared link) passes `mode={readOnly ? 'view' :
'edit'}` — viewers without edit permission get `'view'`, editors get
`'edit'`. Both modes share the same Yorkie attachment and the same
canvas-host; only the rendering surface swaps.

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
- A mobile text-formatting bar (`MobileSlidesToolbar`) shows bold /
  italic / underline / font-size / color while a text-box editor is
  active; controls call into `editor.getActiveTextEditor()`'s existing
  format API.
- Undo / redo, wired to `store.undo()` / `store.redo()`, live on the
  parent `SlidesToolbar` (shared with desktop).
- Add a slide via a `+` button in the horizontal `ThumbnailStrip`
  (`store.addSlide('blank')`). Duplicate / delete / change-layout are
  not yet wired on the mobile surface.
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
- ~~Shared-link read-only flow (`sharing.md`).~~ **Shipped.** The
  shared-link route (`shared-document.tsx`) mounts `MobileSlidesView`
  with `mode={readOnly ? 'view' : 'edit'}`, so anonymous viewers on a
  phone get the read-only `SlideRenderer` path and share-link editors
  get the edit path.
- URL-stateful slide index. The current slide id is component-local;
  reload returns to the first slide.

## Proposal Details

### Detection and branching

The branch lives in the route shells, not in `SlidesView`. Both the
owner route (`packages/frontend/src/app/slides/slides-detail.tsx`) and
the shared-link route (`packages/frontend/src/app/shared/shared-document.tsx`)
branch on `useIsMobile()`
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

`mobileMode` is fixed to `'edit'` on `slides-detail.tsx` (the owner
always has edit access), while `shared-document.tsx` derives it from the
resolved share-link role: `'view'` for viewers, `'edit'` for editors.

### MobileSlidesView shell

`packages/frontend/src/app/slides/mobile-slides-view.tsx` owns the
mobile-side canvas surface, shared between view and edit modes.

**DOM structure.** `MobileSlidesView` renders only two children — a
`flex: 1` canvas-host and a horizontal `ThumbnailStrip`. The header
chrome (Back / title / Present) and undo/redo live on the parent
`SiteHeader` / `SlidesToolbar` in the route shell, not inside this
component; there is no in-component header or prev/next footer.

```html
<div ref={canvasHostRef} class="canvas-host">   <!-- flex: 1 -->
  <canvas />
  <!-- edit mode also mounts an absolutely-positioned overlay div -->
</div>
<ThumbnailStrip ... />   <!-- horizontal mini-slide strip; tap to jump,
                              add-slide (+) button in edit mode -->
```

The route shell's outer container uses `100dvh` (dynamic viewport
height) with a `100vh` fallback so the iOS Safari address-bar
collapse/expand does not visually shift the canvas.

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
| iOS swipe-back at screen edge during drag | Cannot be intercepted — documented limitation. The `ThumbnailStrip` is the in-app navigation workaround for users near the edge. |
| Browser pinch-zoom vs element drag | `touch-action: none` on the canvas-host suppresses both pinch and pan. Slide swipe-nav is gone in edit mode (the `ThumbnailStrip` replaces it). |
| Resize handle hit area | The editor renders handles at 8px on desktop. A mobile mode bumps the *hit* radius to 22px (≈ 44px diameter) without changing the visual handle size — done by extending `hit-test.ts`'s `handleHitTest` with a `tolerance` parameter, default 0. |
| Double-tap zoom (iOS) | `touch-action: manipulation` on the canvas-host disables the 300ms double-tap zoom delay; the editor's double-click → text-edit fires immediately. (Subsumed by `touch-action: none` when we also need to block pinch.) |
| Long-press system callout (iOS) | The callout is NOT a `contextmenu` event — `oncontextmenu` is a no-op against it. The kill is CSS: `-webkit-touch-callout: none` + `user-select: none` on the canvas-host. (Right-click `oncontextmenu` is still suppressed for desktop edit mode.) |

The spike (Task 0, done) validated this list. Findings live in
[lessons](../../tasks/archive/2026/05/20260517-slides-mobile-edit-lessons.md):
selection / double-tap-text / blank-tap-clear work out of the box;
drag and long-press-callout were both blocked by the items above.
Gate decision: option (B), proceed with the Pointer Events migration as
Task 1a prerequisite.

#### Touch beyond the mobile shell

The strategy above holds, with one premise that turned out to be wrong:
that "mobile" and "touch" name the same set of sessions. `useIsMobile()`
answers *is this viewport narrow* (< 768px). A tablet, an Android
tablet, and a phone in landscape all sit above that line and take the
**desktop** mount — with no handle tolerance, no `touch-action`, and no
callout suppression. The accommodations listed in the table above were
therefore reaching a strict subset of the devices that need them.

The axis is the input device, `(pointer: coarse)`. Imperative mounts
read it through `isCoarsePointer()` in `@/hooks/use-coarse-pointer`;
components express it as Tailwind's `pointer-coarse:` variant, which is
the same media query evaluated by the browser with no re-render, so no
React hook exists for it. `useIsMobile()` keeps its job — choosing the mobile *shell*, which is a layout question — and the
touch accommodations key on the pointer instead.

What that changed:

- **Handle tolerance** (`TOUCH_HANDLE_TOLERANCE`, 22px) now also applies
  on the desktop slides mount and on the board. The constant moved
  beside the hook so the three mounts cannot drift.

- **`touch-action: none` on the desktop slide canvas.** With none set,
  the browser claimed every touch drag as a scroll of `scrollHost` and
  cancelled the editor's pointer stream mid-gesture: on a tablet,
  dragging a shape scrolled the page.

  A first attempt conceded scrolling past Fit, where the canvas outgrows
  its host and there genuinely is somewhere to scroll to, applying
  `pan-x pan-y` there. That is worse than it reads. The press still
  reaches the editor and starts a drag or a resize, and only *then* does
  the browser take the gesture and fire `pointercancel`. The move and
  lasso loops now abort on that; the handle loops (resize, rotate,
  adjust, bend) still do not, so a stolen handle drag would leave
  document listeners installed and let the next release anywhere commit
  a resize the user had abandoned.

  So it is `none` throughout on coarse input, and the cost is worth
  stating plainly: past Fit a finger cannot scroll the slide, and the
  way back is the zoom control. That is the trade every touch mount here
  already makes — never concede a gesture the editor may be running.

- **Drag thresholds per device** (`dragThresholdFor`), and — the part
  that actually mattered — **a commit gate** (`commitsAsDrag`). 3px is a
  mouse number: a mouse that has not moved reports no movement. A
  fingertip reports 5–10px across a press the user experienced as
  stationary, as the contact patch shifts and the browser re-centroids
  it, so every tap nudged what it landed on and pushed an undo entry.

  Raising the threshold does not by itself fix that, and assuming it did
  was the substantive error in the first draft of this work. The
  threshold fed only the snap corrections. The move commit keys on
  `liveDx`/`liveDy`, assigned on every move with no threshold at all,
  and the single- and multi-resize commits key on nothing — they write
  `live.worldFrame` unconditionally. The gate now sits in all three
  `onUp` paths.

  It is **touch-only**, deliberately: a mouse reporting 1px of travel
  was moved 1px on purpose, and slides has always committed that; two
  existing tests pin it. `pen` stays on the mouse rules throughout,
  being as precise.

- **Slow double-click withheld from touch** (`allowsSlowDoubleClick`).
  Its window is 3px over 350ms — inside that same jitter, so it could
  not tell a deliberate second click from a tap held still. Widening it
  would open the keyboard on every held tap. `dblclick` (double-tap) is
  the touch route and was already wired.

- **Non-primary touch pointers ignored** in `onPointerDown`, so a second
  finger cannot re-enter select/drag/lasso on top of an in-flight
  gesture. Scoped to `pointerType === 'touch'` rather than testing
  `isPrimary` alone, because `PointerEventInit.isPrimary` **defaults to
  false** — an `isPrimary`-only test silently rejects every synthetic
  `PointerEvent`, which is what the editor dispatches internally and
  what the whole interaction suite is built from.

- **Long-press → context menu**, timed by the editor
  (`LONG_PRESS_DELAY_MS` / `LONG_PRESS_TOLERANCE_PX`, matching
  `use-mobile-sheet-gestures`). The table above notes that the iOS
  callout is not a `contextmenu` event; the corollary it did not draw is
  that suppressing the callout with `-webkit-touch-callout: none` also
  costs the *real* `contextmenu`, so the menu had no touch entry point
  at all. Disarmed by movement past the tolerance, by release, or by a
  `pointercancel`, and skipped while an insert, crop, format-paint or
  text-edit session owns the press — and on a selection handle, whose
  press starts a gesture built to travel.

  Firing also **aborts** the move-drag or lasso the press had already
  started (`abortCanvasGesture`). Opening a menu over a live gesture is
  not enough: "hold, then drag" is a natural grab, and the drag would go
  on committing under a stale menu. Those two loops gained a
  `pointercancel` listener through the same seam, which they had never
  had — a gesture the platform revoked used to leave its document
  listeners installed and let the next release anywhere commit.

  `openContextMenuAt` is public so a host that intercepts a press first
  can still offer the menu.

- **Menu rows at ~44px** on coarse input (`context-menu.ts`), plus a
  larger type size. The `max-height` + scroll that goes with it applies
  to every pointer, since a long menu could always outgrow a short
  window; it is sized from `window.innerHeight` rather than `100vh`,
  which on mobile browsers is the *large* viewport and would let the cap
  exceed the clamp's idea of the screen.

- **Toolbar controls at a 44px floor**, applied on the shared `Toolbar`
  root as `pointer-coarse:` `min-h`/`min-w`. Floors, so nothing shrinks
  and no call site opts in; Sheets, Docs, Slides and Board are covered
  at once. Controls rendered into a portal are outside that subtree and
  set their own.

- **Presentation mode navigates both ways.** Click-to-advance already
  worked under a finger, but every route *back* was a key, so a deck
  presented from a tablet was one-directional. Swipe moves both ways
  (50px, 600ms, horizontal-dominant) and a tap in the left third goes
  back. The zones are touch-only — a mouse keeps click-anywhere — and a
  flag stops the synthetic click that follows a touch from advancing a
  second time.

#### Mobile text formatting

Text formatting shipped as `MobileSlidesToolbar`
(`packages/frontend/src/app/slides/toolbar/mobile-toolbar.tsx`), owned by
the parent route shell rather than mounted inside `MobileSlidesView`
(the standalone `mobile-text-format-sheet.tsx` in the original file plan
was never created). It surfaces while a text-box editor is active and
binds to `editor.getActiveTextEditor()`:

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

#### Slide ops (add slide)

Slide creation shipped as an `IconPlus` button at the end of the
horizontal `ThumbnailStrip` (not a bottom-right FAB). Tap calls
`store.addSlide('blank')`.

The long-press menu (duplicate / delete / change layout via
`store.duplicateSlide` / `removeSlide` / `applyLayout`) is **not yet
wired on mobile** — only add-slide is available. Those ops remain
available on desktop and are a follow-up for the mobile surface.

#### Undo / redo

Undo/redo is owned by the parent `SlidesToolbar` (shared with desktop),
not by `MobileSlidesView`. The planned dedicated `store.onHistoryChange`
hook was not added — the toolbar drives undo/redo through the existing
store surface, so no new history-subscription API was needed.

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

**ThumbnailStrip taps** are the explicit, accessible fallback for
screen readers and any environment where the pointer events do not
classify cleanly — tapping a thumbnail jumps directly to that slide.
Present in both modes.

**Present button**: lives on the parent route shell (not inside
`MobileSlidesView`) and invokes the same presentation entry the desktop
view uses. The route shell already owns presentation mode and the
fullscreen-overlay fallback; the mobile view is just another trigger.

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
| `packages/frontend/src/app/slides/slides-detail.tsx` | Add `useIsMobile()` branch; mount `MobileSlidesView` with `mode="edit"` (owner always edits). |
| `packages/frontend/src/app/shared/shared-document.tsx` | Add `useIsMobile()` branch for the shared-link route; mount `MobileSlidesView` with `mode={readOnly ? 'view' : 'edit'}`. |
| `packages/frontend/src/app/slides/mobile-slides-view.tsx` | Canvas-host + `ThumbnailStrip`, `mode: 'view' \| 'edit'`. `view` mounts `SlideRenderer`; `edit` mounts `SlidesEditor` and adds the strip's add-slide (`+`) button. |
| `packages/frontend/src/app/slides/toolbar/mobile-toolbar.tsx` (new) | `MobileSlidesToolbar` — parent-owned text-formatting bar (replaced the planned `mobile-text-format-sheet.tsx`). |
| `packages/frontend/src/hooks/use-pointer-swipe.ts` (new) | Small hook (~50 lines) encapsulating the pointer classification described above (view mode). Unit-testable. |

The `onHistoryChange` hook on `store.ts` / `memory.ts` /
`yorkie-slides-store.ts`, and the standalone `mobile-slide-ops-fab.tsx`,
were dropped: undo/redo and slide-ops live on the parent `SlidesToolbar`
/ `ThumbnailStrip` and needed no new store surface.

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
- **Component (frontend):** `MobileSlidesView` mount renders the
  canvas-host and `ThumbnailStrip`; tapping a thumbnail advances the
  slide index; the add-slide (`+`) button appears only in edit mode.
  Separate cases assert `mode: 'view'` does not mount the editor and
  `mode: 'edit'` does.
- **Visual (`pnpm verify:browser:docker`):** fixtures at 360×640,
  390×844, and 430×932 viewports verify canvas + `ThumbnailStrip` layout
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
| Undo/redo button state needs a `store.onHistoryChange` hook we don't have yet. | Resolved: undo/redo shipped on the parent `SlidesToolbar` using the existing store surface, so no new `onHistoryChange` hook was added. |
| Spike found > 5 internal editor changes (Pointer Events) — strict gate breach. | Resolved at gate time: option (B). The "5 changes" rule was a heuristic against a state-machine rewrite; the Pointer Events rename is mechanical, no state change, and desktop gets pen tablet support as a bonus. Option (A) (mobile-only editor over `SlidesStore`) is still the fallback if Task 1a smoke surprises us. |
| Two `computeFitSize` copies (desktop, presenter) become three. | Accepted; the math is ~10 lines and the slides package must stay frontend-agnostic. Revisit if a fourth caller appears. |
| Pointer-event classification misfires on Android Chrome where horizontal scroll containers compete for the swipe gesture. | The mobile view has no scrollable ancestors inside the canvas host; outer container is `overflow: hidden`. Footer arrows are the fallback. |
| iOS system swipe-back at the screen edge cannot be prevented. | Documented limitation. Users who initiate near the edge will navigate away; this is consistent with every other mobile web app. |
| `useDocument`'s remote change causes the current slide to be removed mid-view. | Fall back to the first slide if `currentSlideId` is not found in the new slides array. No user-visible error. |
| Memory/perf: `SlideRenderer` re-runs on every resize during window drag. | Wrap the resize handler in `requestAnimationFrame` coalescing; same pattern used by presenter.ts. |
