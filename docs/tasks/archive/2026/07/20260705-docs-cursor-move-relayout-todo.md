# Docs: cursor movement forces full-document re-layout

## Problem

As the docs body grows, cursor movement (arrow keys, Home/End) and scrolling
feel progressively slower. Profiling a large shared document shows
`measureText` / `measureWidth` dominating (~57% in `measureWidth`).

Root cause (verified):

1. **Cursor movement triggers a full re-layout.** Arrow keys route through
   `TextEditor.requestRender` → `renderWithScroll` → `render()` →
   `recomputeLayout()`. The navigation handlers never call `markDirty`, so
   `dirtyBlockIds === undefined` at layout time, which disables the
   incremental cache (`canUseCache` requires `dirtyBlockIds != null`,
   `layout.ts:311`). Every caret move re-lays-out and re-measures **all**
   blocks.
2. **The re-measure is expensive** because `computeCharOffsets`
   (`layout.ts:403`) is O(chars)-per-run and bypasses the `cachedMeasureText`
   cache. (Addressed separately in fix #2.)

Partial/viewport rendering does not help: it only culls the *paint* step
(`doc-canvas.ts:248-252`); measurement happens at *layout* time over all
blocks regardless of what is visible. Layout-level virtualization is an
explicit Non-Goal in `docs-rendering-optimization.md`.

## Fix #1 (this task): cursor moves must not re-layout

Pure caret navigation changes no document content, so it should paint-only
(reuse the cached layout) instead of recomputing layout.

- [x] Write a failing editor-level test: after initial render, an ArrowRight
      keypress on a multi-block document must not re-measure the whole
      document (count `measureText` calls; must not scale with block count).
      → `test/view/cursor-move-no-relayout.test.ts`. Before fix: **1991**
      `measureText` calls on one ArrowRight; asserts `< 40`.
- [x] In `editor.ts`, factor the post-render cursor side-effects
      (`fireCursorMoveCallbacks` + link detection) out of `renderWithScroll`
      into a shared helper (`afterCursorRender`), and add a `renderCursorMove`
      that runs those side-effects with `renderPaintOnly()` instead of
      `render()`.
- [x] Thread a new `requestCursorRender` callback into `TextEditor`
      (public property, fallback to `requestRender` via `requestCaretRender()`
      when unset, so slides text boxes stay correct).
- [x] Use `requestCursorRender` from the guaranteed non-mutating navigation
      paths only: non-table `handleArrow` tail, `handleHome`, `handleEnd`,
      `handleDocStart`, `handleDocEnd`. Table navigation stays on the full
      `requestRender` (its table-exit path can call `ensureBlockAfter`, which
      mutates the document).
- [x] `pnpm --filter @wafflebase/docs test` green (1064 pass); `pnpm
      verify:fast` green (exit 0).

## Fix #2: make full re-layouts measurement-free (computeCharOffsets cache)

After fix #1, a full re-layout still happens on every structural edit (Enter,
paste, multi-block delete), remote collaborative edit, undo/redo, and resize.
Word widths are already cached (`cachedMeasureText` in `measureSegments`), but
`computeCharOffsets` (`layout.ts:403`) measured every character prefix
uncached on every full re-layout — the remaining `measureText` hotspot.

- [x] Failing test: a second `computeLayout` of unchanged blocks (full
      recompute) must perform zero `measureWidth` calls.
      → `test/view/char-offsets-cache.test.ts`. Before: 63 calls; after: 0.
- [x] Memoise `computeCharOffsets` per `(measurer, font, text)` — whole
      offsets array cached, keyed like `cachedMeasureText`. Offsets depend
      only on font+text (not layout width), so the cache survives resizes.
      Registered in the shared `knownCaches` drain so `clearMeasureCache`
      clears it too. Returned array is shared and treated read-only (no
      callsite mutates `LayoutRun.charOffsets`; verified by grep).
- [x] `pnpm --filter @wafflebase/docs test` green (1067 pass).

## Fix #2-B: caret/selection resolvers reuse charOffsets (no per-frame measure)

The caret- and selection-pixel resolvers re-measured `run.text.slice(0, n)`
on every paint frame instead of reading the run's already-computed
`charOffsets`. Small per-frame cost, but redundant and a latent inconsistency
(they re-resolved the font, which can differ from the layout's `seg.font`).

- [x] Failing test for the shared helper: `caretOffsetX(run, n, measurer)`
      returns `charOffsets[n-1]` (0 at n=0) with no `measureWidth` call, and
      falls back to measuring only when offsets are missing/short.
      → `test/view/caret-offset-x.test.ts`.
- [x] Add `caretOffsetX` to `layout.ts`; route all 8 offset→x callsites
      through it: `peer-cursor.ts` (body + table caret), `selection.ts` (body
      selection), `editor.ts` (header/footer/table caret + selection rects,
      5 sites). Image runs keep their own width handling. `measurer` stays in
      the signatures (used by the fallback), so no API churn.
- [x] `pnpm --filter @wafflebase/docs test` green (1069 pass); typecheck
      clean.

## Code review follow-up: font-load cache invalidation

High-effort review flagged that caching `computeCharOffsets` made a
**pre-existing** docs bug observable: the measure cache keys by `(font, text)`
with no load-state key, and docs — unlike slides — never cleared it when a web
font finished loading. So layout (already, via the older word-width cache) and
now caret offsets stayed pinned to fallback-font metrics after an async font
load, drifting from the painted glyphs until reload.

- [x] Failing test: dispatching `document.fonts` `loadingdone` on a warm
      editor must re-measure the document; the listener must be removed on
      dispose. → `test/view/font-load-invalidation.test.ts`.
- [x] `editor.ts` `initialize`: add a `document.fonts` `loadingdone` listener
      → `clearMeasureCache()` + `invalidateLayout()` + `render()` (mirrors
      slides `editor.ts`), removed in `dispose`. `clearMeasureCache` already
      drains the new offset cache via the shared `knownCaches`, so one wiring
      fixes both the word-width and char-offset staleness.
- [x] docs suite green (1071 pass); typecheck clean.

### PR #444 CodeRabbit round

- [x] **`knownCaches` retains dead Maps (Major).** The drain registry strongly
      held every per-measurer Map forever, defeating the WeakMaps' GC intent —
      one leaked cache pair per disposed editor (pre-existing for the width
      cache, doubled by the offset cache). Added `disposeMeasureCache(measurer)`
      to `layout.ts`, called from `editor.dispose()`; exported from the package
      index.
- [x] **`document.fonts.ready` fallback (Major).** `loadingdone` is unreliable
      on WebKit/Safari. `initialize()` now also settles via `fonts.ready`,
      armed only when `status === 'loading'` at mount, guarded on dispose.
      (Mid-session Safari font picks would still want the slides-style per-apply
      `fonts.load().then()` in the frontend picker — noted as follow-up.)
- [x] **Stale task-doc `#2` "Still open" entry (Minor).** Removed.
- [x] Declined: extract shared `installCanvasShim` into `test-utils.ts` — CR
      marked "Low value / Trivial"; the shims carry per-test variations and the
      duplication is contained. Left to keep the PR focused.

**Second finding (unbounded cache growth) — accepted as known limitation.**
The offset cache shares the exact lifecycle of the pre-existing word-width
cache, whose unbounded growth `docs-rendering-optimization.md` explicitly
deferred ("monitor and add LRU if needed"). The new font-load clearing also
drains it periodically. Adding LRU to one cache but not its twin would be
inconsistent; deferred to a joint follow-up if profiling shows real pressure.

## Non-goals here

- Fix #3 — remote-edit / undo-redo / structural-edit still force a full
  re-layout pass (now cheap thanks to fix #2, but still O(blocks) walk).
- Cache LRU eviction (see above; consistent with existing width-cache design).
- Layout-level virtualization (explicit design Non-Goal).

## Review

**Result:** A single arrow keypress on a 40-block document dropped from
**1991** `measureText` calls to **< 40** (caret-only). The caret move now
repaints from the cached layout instead of re-measuring every block, so
navigation cost is independent of body length.

**Changed files**
- `src/view/editor.ts` — split `renderWithScroll` into `afterCursorRender`
  (shared side effects) + `renderCursorMove` (paint-only variant); wired
  `textEditor.requestCursorRender = renderCursorMove`.
- `src/view/text-editor.ts` — added optional `requestCursorRender` property +
  `requestCaretRender()` helper; routed the 5 non-mutating navigation paths
  through it.
- `test/view/cursor-move-no-relayout.test.ts` — new perf-guard test.

**Scope guard:** table arrow navigation intentionally still does a full
render because its table-exit branch can call `ensureBlockAfter` (a document
mutation). Tables are not the perf-sensitive path, so this is a safe, minimal
boundary.

**Still open (separate fixes):**
- #3 — remote-edit / undo-redo / resize still force a full re-layout pass
  (now measurement-free after #2, but still an O(blocks) walk).

_(#2 and #2-B are completed above; see their sections.)_
