---
title: slides-mobile-view
target-version: 0.4.3
---

# Slides Mobile View

## Summary

Add a read-only mobile experience to the slides package. When the
viewport is narrower than 768px, the slide deck mounts as a dedicated
`MobileSlidesView` component — a thin header (back / title / Present),
a single full-width canvas showing the current slide, and a footer
indicator (`2 / 12`). Slide navigation is left/right swipe plus small
arrow buttons. Editing is not exposed on mobile in this phase; the
editor module is not mounted, so read-only is enforced by construction
rather than by feature flags.

This is the slides equivalent of `docs-mobile-zoom-to-fit.md`, but the
implementation is simpler: the slides canvas already paints into a
fit-sized box (`computeFitSize` in `slides-view.tsx`), so no
`ctx.scale` plumbing is needed — the existing `SlideRenderer` from
`packages/slides/src/view/canvas/slide-renderer.ts` is reused directly.

## Goals / Non-Goals

### Goals

- Slide decks are readable and navigable on phones (≤ 767px viewport).
- Read-only is enforced by not mounting the editor — no mutation
  pathway exists from the mobile component.
- Present mode (`packages/slides/src/view/present`) is reachable in
  one tap from the mobile header, using the existing fullscreen
  overlay fallback already shipped for browsers that block the
  Fullscreen API.
- Crossing the 768px breakpoint at runtime (window resize, device
  rotation) swaps cleanly between desktop and mobile mounts without
  losing the active Yorkie attachment.
- No regression to the desktop editor — the desktop code path is
  unchanged.

### Non-Goals

- Mobile editing (text edit, slide reorder, theme change). Tracked
  as phase (B) — light edit — separately. Locking is done by
  omission (the editor module isn't mounted), not by a `readOnly`
  flag on the editor.
- Pinch-to-zoom. The canvas already fits the viewport width; zooming
  for fine inspection is deferred.
- Speaker-notes panel on mobile. Notes are not surfaced in this
  phase; reuse on mobile waits for phase (B) or a notes-aware
  presenter view.
- Per-tablet treatment. iPads in landscape and portrait (≥ 768px)
  remain on the desktop UI. Touch interaction in the desktop editor
  on tablets is out of scope here.
- Shared-link read-only flow (`sharing.md`). The mobile viewer is a
  natural building block for that flow, but wiring viewer roles to
  share tokens is a separate task.
- URL-stateful slide index. The current slide id is component-local;
  reload returns to the first slide. Persisting the position in the
  URL is deferred.

## Proposal Details

### Detection and branching

`SlidesView` (`packages/frontend/src/app/slides/slides-view.tsx`)
branches at the top of its render based on the existing
`useIsMobile()` hook (`packages/frontend/src/hooks/use-mobile.ts`),
which already tracks `(max-width: 767px)`:

```tsx
const isMobile = useIsMobile();
if (isMobile) {
  return <MobileSlidesView documentId={documentId} ... />;
}
// existing desktop editor mount path, unchanged
```

When the viewport crosses 768px at runtime, React unmounts one tree
and mounts the other. The desktop editor's existing mount-time
`useEffect` cleanup tears down the RAF tick, thumbnail panel, notes
panel, editor instance, and style tag. The Yorkie `useDocument`
attachment lives on the surrounding `DocumentProvider`, so the
document stays attached across the swap.

### MobileSlidesView component

New file: `packages/frontend/src/app/slides/mobile-slides-view.tsx`.

**DOM structure** (built as JSX, unlike the desktop view which
hand-builds DOM for the vanilla editor):

```html
<div class="mobile-slides">
  <header>
    <button aria-label="Back to deck list">‹</button>
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
`100vh` fallback so the iOS Safari address-bar collapse/expand does
not visually shift the canvas. Header is `≈ 44px`, footer `≈ 28px`,
`canvas-host` is `flex: 1`.

**Yorkie data flow**:

- `useDocument<YorkieSlidesRoot, SlidesPresence>()` provides the
  document handle, same as the desktop view.
- `ensureSlidesRoot(doc)` is called once on mount — this is the only
  write path the mobile component touches, and it is a no-op when
  the document is already populated. It exists so a user who lands
  on a freshly created (empty) deck on mobile still sees a usable
  shell.
- The deck's slides, theme, and meta are read from the Yorkie root
  into React state. A `doc.subscribe((e) => ...)` listener triggers
  a re-snapshot on `remote-change` events; this mirrors the pattern
  used by `yorkie-slides-store.ts` and avoids a heavier
  `YorkieSlidesStore` instance, which the mobile view does not
  need. No writes are issued.

**Canvas rendering**:

- A single `SlideRenderer` instance is created on mount
  (`packages/slides/src/view/canvas/slide-renderer.ts`, imported
  directly from `@wafflebase/slides`).
- A `ResizeObserver` on `canvasHostRef` tracks the available width
  and height; `computeFitSize` (existing 16:9 width-binding helper)
  computes the logical canvas size. DPR scaling is applied the same
  way the desktop and presenter renderers do it — backing store at
  `size × dpr`, CSS at `size`.
- Re-render is triggered when (a) slides array changes, (b)
  `currentSlideId` changes, (c) `canvasHostRef`'s box changes. There
  is no per-frame RAF tick; the slide is static between events.

The `computeFitSize` math is currently duplicated in
`slides-view.tsx` and `view/present/presenter.ts` — both copies are
identical and the slides package README already notes this is
intentional duplication to keep the package free of frontend
dependencies. The mobile view continues the pattern (a third copy of
~10 lines is cheaper than introducing a shared utility module).

### Navigation

**Current slide state**: `useState<string>(slides[0]?.id ?? '')`, kept
in sync with the slides array (if the current slide is removed by a
collaborator, falls back to `slides[0]?.id ?? ''`).

**Prev/next**: thin helpers that look up the current index and clamp
at the array ends.

```typescript
function nextSlide() {
  const i = slides.findIndex((s) => s.id === currentSlideId);
  if (i < 0 || i >= slides.length - 1) return;
  setCurrentSlideId(slides[i + 1].id);
}
```

**Swipe gesture**: a `usePointerSwipe` hook on `canvasHostRef`
listens for `pointerdown` / `pointermove` / `pointerup`.

- `start` captures `(x, y, time)`.
- On `pointermove`, once `|dx| > 10px`, classify as horizontal if
  `|dx| > |dy|`, else cancel. Once classified as horizontal, set
  `touch-action: none` and call `preventDefault` to suppress the iOS
  swipe-back gesture (where the browser allows it — edge-anchored
  system gestures cannot be intercepted).
- On `pointerup`, if `|dx| > 50px` and elapsed time `< 600ms`, fire
  `dx < 0 ? nextSlide() : prevSlide()`.
- A single tap (no movement) is a no-op. This is intentional —
  read-only means no edit affordance.

**Footer arrow buttons** are an explicit, accessible fallback for
screen readers and any environment where the pointer events do not
classify cleanly.

**Present button**: invokes the same `onStartPresentation('current')`
callback that the desktop view uses. The outer route shell
(`packages/frontend/src/app/slides/...`) already owns presentation
mode and the fullscreen-overlay fallback; the mobile view is just
another trigger.

### Read-only enforcement

Read-only is a property of construction, not configuration:

| Mutation source on desktop                | Why mobile cannot trigger it                       |
| ----------------------------------------- | -------------------------------------------------- |
| Toolbar buttons                           | Not mounted                                        |
| Keymap shortcuts                          | Not mounted                                        |
| Drag handles / adjustment diamonds        | Not mounted                                        |
| Double-tap / dblclick to enter text-edit  | No handler attached                                |
| Yorkie `doc.update()` from editor         | Editor is not instantiated                         |
| Shape picker / theme panel / notes panel  | Not mounted                                        |

The only write that *can* happen from `MobileSlidesView` is
`ensureSlidesRoot(doc)`, which is a no-op on populated decks and a
one-shot scaffold on empty ones. That tradeoff is acceptable: an
empty deck has nothing to protect.

### Loader / error states

The mobile view reuses the existing `<Loader />` component during
`useDocument`'s `loading` state and the existing `toast` for errors.
This matches `SlidesView`'s current treatment and keeps the
component small.

### File change summary

| File                                                            | Changes                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/frontend/src/app/slides/slides-view.tsx`              | Add `useIsMobile()` branch at the top of render; delegate to `MobileSlidesView` when true.           |
| `packages/frontend/src/app/slides/mobile-slides-view.tsx` (new) | Component described above: header, canvas, footer, swipe hook, ResizeObserver, SlideRenderer mount.  |
| `packages/frontend/src/hooks/use-pointer-swipe.ts` (new)        | Small hook (`~50 lines`) encapsulating the pointer classification described above. Unit-testable.    |
| `packages/slides/src/index.ts`                                  | No change — `SlideRenderer` is already exported.                                                     |

No changes to the slides package model, store, view editor, or
presenter modules. No changes to the backend.

### Testing

- **Unit (frontend)**: `use-pointer-swipe.ts` — gesture classification
  thresholds (horizontal vs vertical, time cap, dead-zone). Pure
  function over synthetic pointer events.
- **Unit (slides)**: existing `SlideRenderer` tests cover correct
  rendering; no new tests needed for renderer reuse.
- **Component (frontend)**: `MobileSlidesView` mount renders the
  header, footer, and a canvas; clicking the footer next button
  advances the slide index by 1; the back and present buttons fire
  their respective callbacks.
- **Visual (`pnpm verify:browser:docker`)**: new fixtures at 360×640,
  390×844, and 430×932 viewports verify header + canvas + footer
  layout and that the first slide paints.
- **Manual smoke**: `pnpm dev` → DevTools mobile emulation; verify
  swipe navigation, Present button (fullscreen overlay fallback on
  iOS), and clean transition when toggling between mobile (375px)
  and desktop (1024px) emulated widths.

## Risks and Mitigation

| Risk                                                                                                                  | Mitigation                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Two `computeFitSize` copies (desktop, presenter) become three.                                                        | Accepted; the math is ~10 lines and the slides package must stay frontend-agnostic. Revisit if a fourth caller appears.                  |
| Pointer-event classification misfires on Android Chrome where horizontal scroll containers compete for the gesture.   | The mobile view has no scrollable ancestors inside the canvas host; outer container is `overflow: hidden`. Footer arrows are the fallback. |
| iOS system swipe-back at the screen edge cannot be prevented.                                                         | Documented limitation. Users who initiate near the edge will navigate away; this is consistent with every other mobile web app.          |
| `useDocument`'s remote change causes the current slide to be removed mid-view.                                        | Fall back to the first slide if `currentSlideId` is not found in the new slides array. No user-visible error.                            |
| Adding a hard mobile/desktop branch in `SlidesView` makes future feature flags awkward (e.g., a `viewerOnly` prop).   | The branch is one `if`. When `viewerOnly` lands (for shared-link viewers), it ORs with `isMobile` to pick the same mobile component.   |
| Memory/perf: `SlideRenderer` re-runs on every resize during window drag.                                              | Wrap the resize handler in `requestAnimationFrame` coalescing; same pattern used by presenter.ts.                                       |
