# Slides Background — Lessons

Task: expand the slides right-side "Background Color" control into a full
"Background" (Color / Image / Gradient), per
`docs/design/slides/slides-background.md`. Executed via subagent-driven
development (9 tasks, per-task review + whole-branch review).

## What made this cheap
- The model, renderer, and Yorkie persistence already supported an image
  background fill, and every non-UI layer already had a `Fill`-aware
  sibling of the solid-only helper the background path used
  (`resolveColor→resolveFillStyle`, `wrapColor→migrateGradientFill`,
  `solidFillXml→fillXml`). The feature was mostly widening
  `Background.fill: ThemeColor → Fill` and swapping calls, then adding UI.
  Confirming this up front (two Explore agents) turned an "add gradient
  backgrounds" ask from a feared model change into reuse-and-wire.

## Gotchas that bit (or nearly did)
- **Canvas gradient axis vs. fill rect coordinate space** (final-review
  catch, the important one): the no-pasteboard render branch runs under an
  identity CTM (scale applied *after*) and fills `bitmapW × bitmapH` device
  pixels, so a gradient laid across logical `SLIDE_WIDTH × slideH` only
  lines up when the bitmap is exactly 1920 wide. It rendered fine in the
  editor (which uses the pasteboard path, in logical coords) but was wrong
  in thumbnails, PDF export, and presentation/mobile. Lesson: when a
  `CanvasGradient` and its `fillRect` must agree, lay the gradient across
  the SAME coordinate space the rect is drawn in — and beware that two
  render paths (pasteboard vs. not) use different spaces. The renderer
  unit spy ignored gradient coords, so only a coord-recording test catches
  it.
- **`resolveBackgroundImage` returns inherited images** (Task-7 review
  catch): a slide can't opt out of a master/layout image. `image ? {image}
  : {fill}` in apply-to-all silently dropped the user's fill whenever the
  master already had an image. A master's fill/image are NOT mutually
  exclusive (a slide's are), so the correct patch is
  `{ fill, ...(image ? {image} : {}) }`.
- **Type-widening blast radius**: widening `Background.fill`/`MasterBackground.fill`/
  `MasterPatch.background.fill` to `Fill` left `theme-builder-panel.tsx`
  calling `resolveColor(masterFill as ThemeColor)` — returns `undefined`
  for a gradient (empty swatch). Grep every consumer of a widened field
  for `.role`/`.kind`/`as ThemeColor` and collapse with
  `representativeColor` where a solid is required.
- **A stopgap forced by a commit gate**: Task 1 (model widening) had to
  touch `slide-renderer.ts` and the PPTX export even though later tasks
  owned them, because the pre-commit `verify:fast` runs `pnpm slides
  typecheck` (a hard gate). Plan for "the gate won't let me leave this
  broken" — a widening task must keep every slides-typechecked consumer
  compiling, via a `representativeColor` collapse + TODO the owning task
  later replaces.

## Repo test conventions (cost real re-work to discover)
- `packages/frontend` vitest `include` is `tests/**` ONLY — colocated
  `src/*.test.ts` never run. Frontend tests go under
  `packages/frontend/tests/app/slides/`.
- `packages/slides` runs BOTH `src/**/*.test.ts` AND `test/**/*.test.ts`;
  renderer tests live in `test/view/canvas/` with a shared `ctx-spy`.
- Frontend **view components** are not unit-tested here (verify via `tsc
  --noEmit -p tsconfig.app.json` + build + lint + browser smoke); pure
  logic and logic-heavy hooks (`use-slide-background`) ARE unit-tested with
  RTL `renderHook` against a REAL `MemSlidesStore` (assert resulting
  `store.read()` state, not mock calls).
- Root `tsc --noEmit` is a NO-OP (root tsconfig `files: []`) — the real
  frontend typecheck is `tsc --noEmit -p tsconfig.app.json`. There are
  ~120-140 PRE-EXISTING frontend tsc errors on `main`; only branch-introduced
  errors matter.
- `verify:fast` runs `frontend lint` + `frontend test` but NOT frontend
  typecheck; it DOES run `slides typecheck`. So a frontend type error can
  ride green through the pre-commit gate (caught only by `tsc -p`).

## Process notes
- The whole-branch review (opus) paid for itself: it found the renderer
  coordinate bug that all nine per-task reviews missed, because each
  per-task review only saw one commit and the bug lived in the seam between
  Task 2's choice and the pre-existing two-path renderer.
- Using a real `MemSlidesStore` in hook tests (vs. a hand-rolled fake)
  made "drops the other kind" assertions meaningful — they exercise the
  store's real replace-not-merge `updateSlideBackground`.
