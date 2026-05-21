# Slides thumbnail — async background image + lazy paint

## Problem

In `mountThumbnailPanel` (`packages/slides/src/view/editor/thumbnail-panel.ts:248`),
each visible slide is painted via `renderThumbnail()` once on mount. Inside
`renderThumbnail` (`packages/slides/src/view/canvas/thumbnail.ts:15`) a fresh
`SlideRenderer` is created, `render()` is called once, then the renderer is
discarded.

`drawSlide` → `drawImage` → `getOrLoadImage` registers an `onAssetLoad`
callback that calls the renderer's `markDirty()` when the `<img>` load event
fires (`packages/slides/src/view/canvas/slide-renderer.ts:66`). But by then the
renderer has been GC'd — the canvas is never repainted. Result: slides with a
background image (slide-level or master-level) show only the background-color
fill in the thumbnail panel until some other event happens to re-render them
(slide-add, slide-delete, resize, current-slide change).

Symptom is most visible with many slides + image backgrounds — the panel boots
up showing flat color rectangles, then random thumbnails fill in as the user
interacts.

## Goal

Single PR that delivers:

1. **Foundation fix** — thread `onAssetLoad` from `renderThumbnail` back up to
   the panel so async image loads (background image, image element, master
   image) repaint just the affected thumbnail. Coalesce multiple loads in the
   same frame.
2. **Lazy paint** — IntersectionObserver-driven painting: only thumbnails
   inside (or one viewport-buffer outside) the scroll viewport actually call
   `renderThumbnail()`. Off-screen thumbnails stay unpainted until they enter
   range. Cuts initial-mount cost on large decks and avoids triggering N
   simultaneous image loads on a 50+ slide deck.

The two parts go together because (2) alone doesn't fix the bug — even visible
thumbs need the callback to repaint when their async background image lands;
and (1) alone leaves the initial paint storm on large decks.

## Non-goals

- Skeleton/loading shimmer for unpainted thumbs. The thumbnail item already has
  a 1px border + background-color from CSS — that reads as "empty slot" fine.
- Persisting per-canvas bitmaps across panel re-renders. `image-cache.ts` keeps
  decoded images in memory, so repainting is cheap; re-rendering the canvas
  from the cached `HTMLImageElement` is the right level of caching.
- Removing `ThumbnailScheduler`. It exists and does exactly what we need; just
  wasn't wired up.

## Design

### Renderer signature

`renderThumbnail()` gains an optional 5th param:

```ts
export function renderThumbnail(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  doc: SlidesDocument,
  options: SlideRendererOptions,
  onAssetLoad?: () => void,
): void
```

Implementation drops the `SlideRenderer` wrapper (dirty tracking is meaningless
for a one-shot paint) and calls `drawSlide(ctx, slide, doc, options,
onAssetLoad)` directly. Existing test `paints the slide at the requested host
size` still passes because `drawSlide` is the same function that ran inside
`renderer.render()`.

### Panel: per-slide state + IntersectionObserver

`mountThumbnailPanel` keeps a `ThumbnailScheduler` (200ms debounce — matches
the existing exported constructor signature) whose `onFlush(ids)` calls
`paintThumb(id)` for each id that's currently mounted.

Per-thumb lifecycle inside `render()` (which still rebuilds the DOM
end-to-end when called — store changes are infrequent enough that incremental
DOM diffing isn't worth the complexity for this PR):

1. Create item + canvas as today, but DON'T call `renderThumbnail` yet.
2. Register the item with an IntersectionObserver scoped to the scroll parent
   (`findScrollParent(container) ?? null` as root, `rootMargin: '200px'`).
3. When the observer fires with `isIntersecting: true`, call `paintThumb(id)`:
   - look up `{ ctx, slide, doc, dims, dpr }` from a per-render state map
   - call `renderThumbnail(ctx, slide, doc, opts, () => scheduler.schedule(id))`
   - set a per-slide `painted` flag so we don't repaint identical slides each
     scroll wiggle
4. Subsequent `isIntersecting: false` events do NOT unpaint — once a thumb has
   been drawn, keep its bitmap. (Memory: 192×108×4 ≈ 80KB per thumb × 200
   thumbs = 16MB worst case, acceptable.)

### onAssetLoad path

When `drawImage` returns false (still loading) it has already added our
callback to `pendingCallbacks[src]`. When the image loads, the callback fires
synchronously inside the `<img>` load handler. We hand it to
`scheduler.schedule(slideId)`; after the debounce window expires,
`onFlush(ids)` repaints each affected thumb with the now-cached image.

Important: the callback closures `slideId`, not the canvas/ctx. The flush
re-derives `{ ctx, slide, doc }` from the current per-render state, so a
late-arriving image load after the panel has been rebuilt (e.g., slide deleted
in the meantime) is a no-op rather than a crash — `paintThumb` returns early
if the id isn't in the current state map.

### Test/jsdom fallback

`typeof IntersectionObserver === 'undefined'` (jsdom default): fall back to
painting every thumb immediately in `render()`. Existing tests that count
`canvas` paint calls or assert thumbnail content stay green. Matches the
existing `ResizeObserver` fallback pattern in the same file.

### Disposal

`dispose()` disconnects the IntersectionObserver and calls
`scheduler.flushNow()` is a no-op once disconnected — but we should null the
panel-internal `onFlush` target so a pending timer that hasn't fired yet
doesn't try to paint into a torn-down canvas. Simplest: a `disposed = true`
flag checked at the top of `paintThumb`.

## Plan

- [x] **R1** — `thumbnail.ts`: add optional `onAssetLoad` to `renderThumbnail`;
      drop the `SlideRenderer` wrapper; call `drawSlide` directly. Update the
      existing JSDoc.
- [x] **R2** — `thumbnail.ts` test: add a case asserting the callback is
      invoked when a background image is still loading. Use a tiny stubbed
      slide whose background.image.src is a never-resolving URL; assert
      `getOrLoadImage`'s pending callback set contains a function (or that
      drawSlide was called with a defined onAssetLoad).
- [x] **P1** — `thumbnail-panel.ts`: introduce per-render thumb state map and
      paint queue. Move `renderThumbnail` call out of the build loop into a
      `paintThumb(id)` helper. Initial behavior: paint everything (no observer
      yet) so the existing tests stay green.
- [x] **P2** — `thumbnail-panel.ts`: wire up `ThumbnailScheduler` so the
      `onAssetLoad` callback drives a debounced repaint of only the affected
      thumbs. Verify with a unit test using a fake image source.
- [x] **P3** — `thumbnail-panel.ts`: add IntersectionObserver. Skip when the
      global isn't defined (jsdom default). `rootMargin: 200px`, threshold 0.
      `paintThumb` runs on first intersection, then memoizes.
- [x] **P4** — `thumbnail-panel.ts`: dispose path — disconnect observer, set
      `disposed = true` so a pending scheduler tick doesn't repaint a torn
      thumb.
- [x] **T1** — Panel tests: add a test that simulates IntersectionObserver
      (inject a mock global). Mount 5 slides where 2 are "visible", assert
      only those 2 had their `<canvas>` actually painted (count `fillRect`
      calls or use a `paintTracker` hook).
- [x] **T2** — Panel tests: add a test that the async-image callback flow
      repaints the right thumb. Use the existing `image-cache.ts` test
      helpers; stub `getOrLoadImage` if needed.
- [x] **V1** — `pnpm verify:fast` green.
- [ ] **V2** — Manual visual: start `pnpm dev`, create a deck with a
      master-level image background and ~30 slides, confirm:
      - on mount, all visible thumbs show the image (not just the color);
      - scrolling reveals lower thumbs that also paint with the image;
      - duplicating a slide doesn't blank previously-painted thumbs.

## Risks

- **IntersectionObserver root mismatch.** If the scroll parent we pass as
  `root` is null or wrong, the observer falls back to the document viewport,
  which still works but with looser margins than intended. Verified by reading
  `findScrollParent`'s contract — it walks ancestors for `overflow: auto/scroll`.
  If it returns null we should pass `root: null` explicitly so the document
  viewport is used.
- **Hidden panel (display:none).** When the panel is hidden, IO never fires
  intersection events — thumbs stay unpainted. Acceptable: there's nothing to
  paint for the user to see, and the next time the panel is visible the
  observer wakes up and paints what's in range.
- **Scheduler test fragility.** The scheduler uses `setTimeout` (real time in
  some test paths). The existing `thumbnail.test.ts` already uses
  `vi.useFakeTimers()` — propagate the same pattern to panel tests that drive
  the callback flow.

## Follow-ups added mid-implementation

After the first round, surfaced two additional issues:

1. **Click-flicker** — `onCurrentSlideChange` was triggering a full `render()`
   (innerHTML wipe + observer rebuild). With lazy paint via IO, the rebuild
   left every canvas blank for the one frame between `observe()` and IO's
   async initial-fire. Fix: split `render()` (structural) from
   `syncCurrentHighlight()` (highlight-only — toggles `.current` class +
   border color on existing items). The cheap path is used for current-slide
   switch; the `render()` calls in shift-click and right-click handlers
   (which had no visual effect) were also dropped.
2. **Initial-mount block on large decks** — synchronous DOM construction for
   N items × (div + canvas + getContext + observe) blocks the main thread for
   ~hundreds of ms on 50+ slide decks. Fix: chunked render with rAF yield.
   First chunk (20 items, ~viewport's worth) runs synchronously so users see
   the panel start filling immediately; subsequent chunks defer via
   `requestAnimationFrame` so the main thread stays responsive. Token guards
   (`activeRenderToken`) ensure a follow-up render or dispose cancels the
   prior generation cleanly.
3. **Whole-panel flicker on any slide edit** — `slides-view.tsx`'s
   `store.onChange` handler was calling `thumbHandle.refresh()` (full DOM
   wipe) on every content edit (drag, color, text). With lazy paint, that
   blanked every canvas for one frame. Fix: new
   `ThumbnailPanelHandle.refreshContent()` repaints painted thumbs in place,
   re-snapshotting each `ThumbState.slide` / `.doc` from the store — no DOM
   churn, no observer rebuild. Structural refresh stays available for
   add/remove/reorder via the rAF tick's count check.

## Review section

Implementation matches the plan; all 12 plan items checked off.

- `renderThumbnail` now takes an optional `onAssetLoad` and calls `drawSlide`
  directly — the SlideRenderer wrapper was load-bearing for the main canvas
  (dirty flag) but pure overhead for thumbnails.
- `thumbnail-panel.ts` keeps a panel-lifetime `Map<slideId, ThumbState>` so the
  `ThumbnailScheduler` (100ms debounce) can repaint a thumb after its image
  resolves, even if the panel was rebuilt between the request and the load.
- IntersectionObserver with `rootMargin: 200px` paints only what's near the
  viewport; jsdom and old browsers fall back to "paint all" so existing tests
  and downlevel environments keep working.
- `canvas.dataset.paintCount` was added as a tiny debug + test signal — it
  lets the new unit tests verify paint counts without spying on the renderer.
  Side benefit: easy to inspect in DevTools.

### Verification

- `pnpm verify:fast` — green (792 tests).
- New unit coverage: `thumbnail.test.ts` (`onAssetLoad` propagation through
  `renderThumbnail`), `thumbnail-panel.test.ts` (lazy-paint via mocked IO,
  no-repaint after intersection re-fire, dispose disconnects observer,
  async-image repaint coalesce, no-repaint-after-dispose).
- Manual visual check still pending (V2) — needs `pnpm dev` against a deck
  with master-level image background.

### Code-review-driven adjustments

A self-review pass (via `superpowers:requesting-code-review`) surfaced four
should-fix items. All applied before declaring done:

- **Remote reorder gap.** `refreshContent` now detects when the state map's
  slide-id sequence diverges from the store's `doc.slides` order and falls
  back to a full `render()`. Without this, a remote peer reordering slides
  (same count, different positions) would leave the DOM order pointing at
  the wrong slides — a regression vs. main's "refresh on every onChange."
- **Synchronous repaint storm.** `refreshContent` previously called
  `paintThumb` synchronously for every painted thumb on every store change.
  Now it routes through `ThumbnailScheduler` (same instance used by async
  image loads), collapsing a burst of edits into one paint per affected
  thumb per debounce window.
- **Scheduler timer leak on dispose.** Added `ThumbnailScheduler.cancel()`
  and call it from `dispose()`. The disposed-flag guard inside `onFlush`
  already prevented use-after-free, but explicit cancel keeps the lifecycle
  from depending on that guard.
- **Chunk-cancel test strengthened.** The previous "no duplicate ids" check
  passed even if stale chunks leaked. New test removes 20 slides between
  mount and refresh, then asserts the final DOM exactly matches the
  post-shrink store — proving stale chunks bailed out cleanly.

Minor adjustments:

- Corrected the `RENDER_CHUNK_SIZE` justification comment (the previous math
  said "smallest thumb" but the panel typically renders at default size).
- Clarified the IntersectionObserver `root: null` behavior comment.
- Added a `painted`-flag lifecycle invariant comment in `paintThumb` —
  flagging the coupling between IO's "skip if painted" gate and
  `refreshContent`'s "keep slide/doc fresh" promise.

### Known limitations

- **One-frame blank flicker on mount in real browsers.** IntersectionObserver
  delivers entries asynchronously, so the first paint of visible thumbs
  happens one microtask after `render()`. Acceptable for v1; if visible in
  practice, the fix is to pre-emptively paint items inside the scrollparent's
  `clientHeight` synchronously and leave the rest to the observer.
- **Thumbnails do not auto-refresh on canvas content edits.** The panel only
  subscribes to `onCurrentSlideChange`, not to general store changes. This is
  pre-existing behavior, not a regression — covered by the existing `refresh`
  handle pattern.
- **Memory unbounded by deck size.** Once painted, thumbs stay painted for the
  panel lifetime. ~80KB per 192×108 canvas → 16MB at 200 slides. Acceptable
  for current product scope; if larger decks become common, swap to an LRU
  that unpaints (clears dataset.paintCount and clears the canvas) thumbs
  outside a wider band.
