# Lessons — Slides share toolbar + read-only canvas

Captured during implementation. Worth carrying into the next share-link
or read-only-mount task.

## Findings

- **`attachInteractions()` is the single binding seam in `SlidesEditorImpl`.**
  Every pointer + document keydown listener is attached inside this one
  method (`editor.ts:1036`). Constructor work outside it is pure state
  setup (`selection.subscribe(...)`, `buildKeyRules(...)`). When you
  need an "interaction-free editor" mode, gating that call alone is
  sufficient — no need to thread a flag through every interaction
  module. Verified by grepping `editor.ts` for `this.on(...)` /
  `addEventListener` outside `attachInteractions` (only the in-flight
  pointermove/up handlers inside drag callbacks, which are themselves
  gated on a handler that won't fire without `attachInteractions`).
- **Drag-handler tests in jsdom can't use `DataTransfer`.** The
  constructor isn't implemented. Either stub via
  `Object.defineProperty(DragEvent.prototype, 'dataTransfer', …)` or
  test indirectly (`item.draggable === false`, or "menu DOM not
  mounted"). The thumbnail-panel suite already documents this limit;
  the existing pattern is observational, not synthetic-event.
- **`ensureSlidesRoot` writes even on viewer mounts of unmigrated decks.**
  `yorkie-slides-store.ts` has an unconditional `doc.update()` migration
  block that backfills `themes`/`masters`/`notes` for pre-v0.5 docs. The
  empty-deck seed-skip in `slides-view.tsx` doesn't cover this. A
  future "no viewer writes" guarantee needs to either gate the migration
  on role, or run server-side at upgrade time. Left as a known limit
  (see comment at `slides-view.tsx` `ensureSlidesRoot` call).
- **Lazy-imported sibling components share a Suspense boundary cleanly.**
  Adding a second `lazy()` import (`SlidesToolbar`) alongside
  `SlidesView` in `shared-document.tsx` did not need a second
  `<Suspense>` — the existing fallback covers both, and both chunks
  share the `@wafflebase/slides` dependency chunk so the extra lazy
  surface emits the toolbar's contextual subsections (idle / object /
  text-edit / mobile) as their own chunks, so the final count rose to
  91 against the budget that this PR bumps from 90 to 93.
- **`import type` from `@wafflebase/slides` is safe in non-slides routes.**
  Type-only imports are erased by tsc + esbuild, so referencing
  `SlidesEditor` / `Theme` / `YorkieSlidesStore` types in
  `shared-document.tsx` does not pull the slides runtime into the
  shared-document chunk. The lazy split for `SlidesView` /
  `SlidesToolbar` is what gates the runtime; types are free.

## Process

- **Verify comment veracity before shipping.** The `SharedSlidesLayout`
  block had a 6-line "Phase 4a no-op" comment that became false the
  moment readOnly was wired. The reviewer caught it; I had read past
  it twice. Add "comment veracity" to the self-review checklist.
- **`pnpm verify:fast` from a sub-directory fails with `command not
  found`.** It's a root-level script. Always run from
  `/Users/hackerwins/Development/wafflebase/wafflebase`, not a package
  subdir. (Cost me one cycle of "EXIT=254" confusion.)
- **Adding optional flags to multiple public APIs in one PR is fine when
  they share a single conceptual gate.** Three signatures changed
  (`SlidesEditorOptions`, `MountThumbnailPanelOptions`,
  `MountNotesPanelOptions`), each backwards-compatible (optional
  bag, opt-in). The reviewer didn't flag fan-out because the gate is
  one-line in each consumer.
