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

## Non-goals here

- `computeCharOffsets` caching / caret resolver reuse of `LayoutRun.charOffsets`
  (fix #2).
- Remote-edit full-relayout, undo/redo, resize (separate follow-ups).
- Layout-level virtualization.

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
- #2 — `computeCharOffsets` bypasses `cachedMeasureText`; caret/selection
  resolvers re-measure instead of reusing `LayoutRun.charOffsets`. Makes the
  full-relayout paths (remote edits, undo/redo, resize) cheaper.
- #3 — remote-edit / undo-redo / resize still force a full re-layout.
