# Slides Layout Change — Lessons

Surprises and corrections accumulated during implementation, kept tight so the next agent can scan in 60 seconds.

## 1. Yorkie array element proxies cannot be safely re-spliced

The T3 design specified `applyLayoutToSlide` as: produce a new `[...userElements, ...slotted, ...orphans]` array, assign back to `slide.elements`. This works flawlessly for plain arrays (`MemSlidesStore`). It crashes Yorkie with `TypeError: Unsupported type of value: function`.

Two compounding gotchas:

- **Spreading a Yorkie proxy element** (`{ ...reuse, frame, placeholderRef }`) carries proxy methods like `toJSON` into the new object, which Yorkie's serializer rejects on the next splice.
- **Mutating in place is necessary but not sufficient.** A Yorkie array element whose nested fields (e.g., `data.blocks: Block[]`) have been edited becomes a fully-Yorkified proxy. When Yorkie's `buildCRDTElement` recurses, `Array.isArray(arrayProxy)` returns **false** for the nested array, so the array is treated as an object. `Object.entries` then exposes the underlying CRDTArray's `elements: function`, which Yorkie rejects.

**Fix shape that works:** classify each existing element (reuse / demote / delete) without removing it; mutate surviving entries in place (frame and placeholderRef assignment); splice out only deletions one at a time from highest index down; push only fresh-from-spec placeholders (plain JSON, never a proxy).

This is encoded in `applyLayoutToSlide` (`packages/slides/src/model/layout.ts`) and pinned by integration test `apply-layout-with-edit` in `yorkie-slides-concurrent.integration.ts`. **Don't** revert to "build a new array and reassign" — it will pass MemStore tests and silently break Yorkie.

## 2. `YorkieSlidesStore.read()` strips `placeholderRef` (was latent — fixed mid-PR)

`read()` originally built a plain `SlidesDocument` from the Yorkie root via per-element conversion that did NOT propagate `placeholderRef`. The layout-change feature itself didn't notice because `applyLayoutToSlide` ran against the live Yorkie proxy. T12 (ghost text) is what made it bite — the renderer's empty-placeholder branch reads `element.placeholderRef` from the `read()` snapshot to look up the hint string, and silently never fired in the live editor.

**Fix:** the text and non-text branches of `read()` both unwrap `el.placeholderRef` via `yorkieToPlain<PlaceholderRef | undefined>` and include it on the returned element. Single commit, one import + one field per branch.

**Lesson:** when adding a new field to elements, audit BOTH the write path (`addSlide` in T5) AND the read conversion (`read()`). Tests for MemSlidesStore alone won't catch this because Mem returns a deep clone of the live state — the field auto-survives. Yorkie's per-element rebuild needs explicit propagation.

## 3. Slides package is framework-free; the picker had to be vanilla DOM

The brainstorm draft said "Radix `ContextMenu.SubContent`," echoing the colour/font pickers in the frontend. Wrong package — `packages/slides/src/view/editor/{thumbnail-panel, context-menu}.ts` are pure DOM and the package has no Radix dep. The design doc was corrected before plan-writing, but if an agent reads only the brainstorm transcript without the design doc, they may add Radix unnecessarily.

**Rule of thumb:** anything inside `packages/slides/src/view/editor/` is vanilla DOM. The Radix-backed UI lives in `packages/frontend/src/app/slides/` (theme panel, color picker, font picker).

## 4. `pnpm --filter @wafflebase/slides build` after every `index.ts` re-export

Frontend tests resolve `@wafflebase/slides` against the package's pre-built `dist/`. A new export from `packages/slides/src/index.ts` is invisible to `pnpm --filter @wafflebase/frontend test:integration` until the slides package is rebuilt — the test fails with `SyntaxError: The requested module '@wafflebase/slides' does not provide an export named '...'`. `pnpm verify:fast` runs the build for you; one-off `--filter` test invocations don't.

## 5. Element ordering in `applyLayoutToSlide`: kept in place

The earlier draft of `applyLayoutToSlide` produced `[user, slotted, orphans]` order (user-added first, then slotted, then demoted). The Yorkie-safe rewrite preserves the original index of each surviving element (only splicing out deletions and appending fresh placeholders). No tests asserted the old reordering, and the new behaviour is UX-positive: a user-added shape that sat above a placeholder before a layout switch sits above the new placeholder after the switch (z-order preserved).

If a future feature needs deterministic placeholder-first ordering, fix it explicitly rather than relying on the array-reassignment side-effect that no longer exists.

## 6. `clone<T>` lives in `packages/slides/src/model/clone.ts`

Promoted out of `store/memory.ts` after T7's review found four copies of `JSON.parse(JSON.stringify(...))` across the package. Internal helper, not re-exported. New consumers in the slides package should import from `'../model/clone'` rather than reinventing the JSON dance.

## 7. Browser smoke is the user's job, not the agent's

`CLAUDE.md` is explicit: manual smoke in `pnpm dev` before merge if UI changed. The agent runs `pnpm verify:fast` and opens the PR; the user runs through the smoke checklist (`docs/tasks/active/20260508-slides-layout-change-todo.md` § Task 11 Step 2) before approving the merge. Don't claim the feature works in the browser without confirmation.
