# Slides Hover & Text-Edit Entry — Browser smoke follow-up

Spun off from [`20260601-slides-hover-text-edit-entry-todo.md`](20260601-slides-hover-text-edit-entry-todo.md)
after the umbrella PR ([#346](https://github.com/wafflebase/wafflebase/pull/346))
shipped. Two manual/browser scenarios were deferred because the slides
interaction-test harness is still sheets-only (tracked in the umbrella
lessons file under "Deferred / known limitations").

## Open items

- [ ] **Phase C — `dblclick` coexistence smoke.** In a real browser
      (`pnpm dev`), confirm a fast double-click on an already-selected
      text-capable element enters edit mode exactly once. P1.5 fires on
      pointerup (slow-click path) and then the browser's `dblclick`
      handler should no-op via `onDoubleClick`'s `editingElementId`
      guard. Verify the docs text-box editor's word-selection (the
      docs `TextEditor` second-mousedown selects a word) survives — i.e.
      the slides editor must NOT remount the textbox on the second
      dblclick.
- [ ] **Phase D — Real-Canvas type-to-edit scenario.** Vitest jsdom
      coverage in `test/view/editor/text-box-initial-text.test.ts`
      exercises the wiring (`api.insertText` injection on first focus),
      but the cross-Canvas + real-IME path needs the browser-test lane.
      Spec: select a shape, type `H`, expect `H` in the freshly mounted
      text-box; repeat with Korean IME to verify the partial jamo
      renders immediately (regression hedge on the docs composing
      preview wiring fix).

## Why this is separate

Both scenarios require a slides interaction-test harness that does not
exist yet. Adding the harness is its own scaffolding effort:

- slides bridge methods on `packages/frontend/src/app/harness/interaction/page.tsx`
- scenario registration in `scripts/verify-interaction-browser.mjs`
- slides fixture loader

Out of scope for #346. When the harness exists, both items collapse to
adding a `slides-hover-text-edit-entry.spec.ts` scenario.
