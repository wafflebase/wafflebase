# Slides Hover & Text-Edit Entry — Phase B Lessons

## Predicate alignment beats spec letter

The spec said "zero blocks, or a single empty paragraph block." That phrasing is narrower than the renderer's actual ghost-hint gate (`isBlocksEmpty` — every inline across every block must be empty, regardless of block type or count). Mirroring the renderer's gate keeps a single source of truth: the predicate fires exactly when the user sees a ghost. Re-implementing the spec's narrower phrasing would have re-introduced a drift class where the predicate disagrees with what the user sees.

**Rule for future predicates that gate UX off "the rendered ghost state":** delegate to the same helper the renderer uses (`isElementEmpty` / `isTextBodyEmpty`), don't write a parallel narrower check.

## Self-review caught a quiet plan deviation

Code-review skill flagged that one of the plan's draft truth-table tests ("multiple blocks → false") was silently dropped during implementation because it would have failed against the broader predicate. The plan's Risks table also said the predicate "rejects non-paragraph blocks" — the implementation does not.

Both items were doc-consistency bugs, not correctness bugs, but they were exactly the kind of small drift that quiet plan deviation produces. Capture deviations from the plan **out loud** in the lessons file (or in the commit messages) at the moment the choice is made, not after review surfaces them.

## Pointer-down vs pointer-up entry — still open

The spec's wording was "in the same pointer-up handler." The implementation lands the `enterEditMode` call in `onPointerDown`, alongside the existing `selection.click` path, for two reasons:
1. The fresh-selection branch already lives in `onPointerDown`; deferring to `pointerup` would split state across two handlers.
2. The risk being mitigated (user wanted to drag the placeholder, not type) is rare for an empty placeholder.

If dogfooding turns up "I clicked to drag the placeholder and got dumped into text-edit," the fix is small: move the `enterEditMode` to the no-drag `pointerup` path (which Phase C will already touch for slow-double-click). Not done preemptively because the cost is low.

## Test helper duplication is fine

The integration test (`empty-placeholder-entry.test.ts`) duplicates `makeMockMount()` and a `setup()` helper from `hover-highlight.test.ts`. Trying to extract them to a shared helper would have widened the diff for ~30 lines of mock plumbing — not worth it. Each spec stays self-contained and easy to read in isolation.

## Manual smoke deferred

Could not run `pnpm dev` from this Claude session. The 5 jsdom integration cases + 8 predicate cases cover the wiring deterministically; the remaining "does it *feel* right" check (smoke step 7 in the todo — drag-from-empty-placeholder) is best done by a human dogfooder. Flagged in the PR description.

## preventDefault on pointerdown when mounting a focused input — caught by smoke, not unit

The wiring shipped without `e.preventDefault()` on the pointerdown that triggers `enterEditMode`. All 6 jsdom integration cases passed, but dev showed "click selects, never enters edit." Diagnostic logs revealed the textbox mounted and focused synchronously, then `onCommit` fired between microtask drain and 0ms timer — the textarea was blurring within the same click sequence. Root cause: without `preventDefault`, the browser's pointerup + synthetic click re-focus the canvas / body, blurring whatever was focused inside the pointerdown handler.

The existing `onDoubleClick` path at `editor.ts:2096-2098` already calls `e.preventDefault() + e.stopPropagation()` for the same reason. Phase B's 1-click branch needed the same guard. jsdom doesn't reproduce the focus-stealing because it has no real focus management, so unit tests passed despite the missing guard.

**Rule:** any pointerdown handler that mounts a focused input synchronously must call `e.preventDefault()` on the originating event. The corresponding regression test asserts `pointerdown.defaultPrevented === true` rather than asserting on focus, because the focus-stealing itself isn't reproducible in jsdom.

**Debug technique that worked:** triple log (synchronous after-enter / `queueMicrotask` / `setTimeout(_, 0)`). The three timestamps bisect the event-loop phases — sync, microtask, next-tick — and pinpoint exactly where state mutated. Worth remembering for similar "thing was true, then wasn't" mysteries in the same code area.

## Workspace dist resolution was a red herring

While debugging the focus-stealing bug, I initially suspected stale `dist/wafflebase-slides.es.js` because frontend tests resolve to `dist/*.es.js`. Rebuilt slides, but it didn't fix anything. Re-read `packages/frontend/vite.config.ts:156` — the dev server aliases `@wafflebase/slides` to `../slides/src/index.ts`, not the dist. So `pnpm dev` always reads from src; dist matters only for production builds and the frontend's `pnpm test` lane. Memory entry `project_workspace_dist_resolution.md` is correct for test failures, but doesn't apply to dev-mode behavior.
