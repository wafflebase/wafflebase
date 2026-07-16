# Slides mobile/presenter background repaint on async image load

## Problem

On mobile, opening a slide deck can render the slide background white when
the background **image** hasn't finished decoding yet. Navigating to another
slide and back fixes it (the image is cached and drawn synchronously on the
revisit).

## Root cause

`SlideRenderer` draws background images asynchronously. On the first paint the
image is not decoded, so only the background *fill* (theme color, often white)
is painted. When the image finishes loading, the `drawSlide` asset-load
callback resolves to `SlideRenderer.markDirty()` — which only flips a boolean.
Something must re-call `render()` for the repaint to happen.

- Desktop editor: continuous RAF loop → repaints next frame. OK.
- Thumbnails: `ThumbnailScheduler` re-flushes via explicit `onAssetLoad`. OK.
- **Mobile view mode**: no RAF loop; `paint()` only runs on resize /
  `store.onChange` / slide change → background image dropped. BUG.
- **Presenter mode**: event-driven `paint()`, no RAF on a static slide. Same BUG.

## Fix

Add an optional `onAssetLoad` callback to `SlideRendererOptions`. On async
asset load the renderer calls `markDirty()` **and** `options.onAssetLoad?.()`,
so consumers without a per-frame loop can schedule a repaint. Editor keeps
relying on its RAF loop (omits the callback).

- [x] `packages/slides/src/view/canvas/slide-renderer.ts` — add `onAssetLoad`
      option + private `handleAssetLoad()` used by `render()`/`forceRender()`.
- [x] `packages/frontend/src/app/slides/mobile-slides-view.tsx` — RAF-coalesced
      `scheduleRepaint`, pass as `onAssetLoad` when building the view renderer.
- [x] `packages/slides/src/view/present/presenter.ts` — RAF-coalesced
      `scheduleRepaint` (+ cancel on dispose), pass as `onAssetLoad`.

## Verification

- [x] `pnpm verify:fast` green.
- [x] Regression test: `slide-renderer.test.ts` — `onAssetLoad` fires when a
      background image finishes loading (fails on pre-fix `markDirty`-only wiring).
- [x] Manual: mobile Slides view — first open paints the background image
      without needing to navigate away and back. (shipped as #476; covered by
      the `slide-renderer` `onAssetLoad` regression test)

## Code review (high effort, workflow-backed)

Two CONFIRMED correctness findings, same root cause — the presenter's
`scheduleRepaint` fired `paint()` unconditionally:

- A late-decoding asset during an **in-flight transition** force-painted the
  settled next slide over the transition composite (one-frame flash).
- A late asset during a **running object-animation** step force-painted the
  resting state, stuttering the animation.

Fix: `scheduleRepaint` skips while `rafHandle` or `transitionRafHandle` is
active — those loops already repaint every frame (and the transition settles
via its own `onDone` `paint()`). Regression tests added in
`presenter-transition.test.ts` and `presenter-anim.test.ts`.

One PLAUSIBLE cleanup: the mobile view retained a stale `onAssetLoad` after a
slide switch. Fixed with a `cancelled` flag so the stale callback can't
schedule an uncancellable RAF.
