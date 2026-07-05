# Lessons — docs decoration culling

## What made the fix land cleanly

- **Read the profile as a call graph, not a leaderboard.** The top self-time
  entry (`findPageForPosition`) and the anonymous `pagination.ts:288` frame were
  the *same* linear scan (`findIndex` callback). Grouping the hot frames by what
  they actually do — resolve a block position — pointed straight at the two
  scans to kill, instead of micro-optimizing one function.

- **Verify object identity before memoizing.** WeakMap-on-the-layout only works
  because `computeLayout` (layout.ts:427) and `paginateLayout` (pagination.ts)
  return **fresh** objects each recompute. Confirmed that first; it's what makes
  the cache auto-invalidate on real edits yet stay warm across paint-only
  cursor/scroll renders. A stale-key WeakMap would have been a silent
  correctness bug.

## Traps avoided

- **The decoration loops are in `paint()`, not `render()`.** `render()` =
  `recomputeLayout(); paint()`. Scroll calls `renderPaintOnly() → paint()`,
  which re-reads `scrollY`. If culling had lived in `render()`, scrolling would
  have painted stale (culled) decorations. Locating the exact function that owns
  the loop — and confirming it reruns on scroll — was the difference between a
  correct cull and a scroll regression.

- **Don't filter an array another index points into.** `activeMatchIndex`
  indexes `searchHighlightRects` 1:1 with `searchMatches`. Culling had to map
  off-screen matches to `[]`, not `.filter()` them out.

## Review catch (unit mismatch)

- The first cull band used `canvasHeight` (scaled screen px) against `scrollY` /
  `blockYExtent` (logical doc px). On desktop `scaleFactor === 1` so it looked
  fine; on mobile zoom-to-fit (`scaleFactor < 1`) the band was too short and
  dropped bottom-of-screen decorations. **Lesson: whenever a threshold mixes a
  viewport measurement with a document-space value, restate both in the same
  space explicitly (`canvasHeight / scaleFactor`).** A same-coordinate-system
  assertion is easy to eyeball; a mixed one hides behind `scaleFactor === 1`.

## Follow-up ideas (not in this PR)

- `cloneDocument` (`yorkie-doc-store.ts:472`) is `JSON.parse(JSON.stringify(doc))`
  on every change for undo snapshots — O(document) per keystroke, ~4% of the
  trace. Structural sharing / incremental snapshots would remove it. Deferred:
  touches undo/redo correctness and wants its own test pass.
