# Slides Motion — Implementation Lessons

Paired with `20260620-slides-animation-todo.md`. Captures what was
non-obvious during the transitions + object-animations build.

## Codebase facts that contradicted initial assumptions

- **Slides tests live in `packages/slides/test/` mirroring `src/`**, imported
  via `../../src/...` — NOT colocated `src/*.test.ts`. The plan's `Test:`
  paths were written as `src/...` and had to be corrected per-task.
- **`MemSlidesStore` starts empty.** `new MemSlidesStore()` has zero slides;
  create one with `store.batch(() => store.addSlide('blank'))`. There is no
  `.empty()` factory and no slide at index 0.
- **The slides package `index.ts` uses named exports**, so new model types
  (`ObjectAnimation`, `SlideTransition`, `SlideAnimation`, `AnimEffect`, …)
  had to be added explicitly before any frontend consumer could import them.
  After editing `index.ts`, run `pnpm slides build` — the frontend resolves
  `@wafflebase/slides` against `dist/`.
- **A pre-commit hook runs the full `verify:fast` on every commit.** Commits
  take ~1–2 min and only land if lint + all package tests pass — so every
  landed commit is fully gated.
- **The PPTX shape parser already builds the spid→element-id map** as
  `ctx.idMap: Map<number, string>` (`<p:cNvPr id>` → generated id). Wiring
  `<p:timing>` only needed a string-keyed view, not a new map (Task 24 was
  much smaller than planned).
- **The slides editor selection overlay is a DOM overlay** (`renderOverlay`
  in `view/editor/overlay.ts`), positioned with `frame.x * scale` — the
  overlay element's own origin already encodes the pan, so per-element chrome
  needs no extra offset.

## Architecture decisions that paid off

- **Optional trailing `AnimState` arg threaded through `drawSlide`/
  `drawElement`** kept the static render byte-identical (guarded by a
  ctx-call-sequence regression test). Wrapping the whole `drawElement` body
  in `try { … } finally { if (hasAnim) ctx.restore(); }` guarantees restore
  across every early-return path (connector branch, group recursion).
- **Animation transform applied in slide-space OUTSIDE the element's local
  rotate/flip** — composition order matters; verified with a spy
  invocation-order test on a rotated shape.
- **Pure, time-injected engine** (`tick(nowMs)`) made the player/timeline/
  sample deterministically unit-testable without RAF or canvas.
- **Transition compositing at canvas-pixel size**: calling
  `sampleTransition(t, p, { w: canvas.width, h: canvas.height })` yields
  device-pixel offsets, so two offscreen slide bitmaps composite with plain
  `drawImage(off, dx, dy)` at identity transform — no `SlideRenderer` scale
  accessor needed (the first attempt wrongly assumed one was required).

## Bugs caught in review (worth guarding against next time)

- **CRDT whitelist drops new fields.** `migrateSlide` and both stores' `read()`
  rebuild slides field-by-field, silently dropping `transition`/`animations`
  unless explicitly forwarded. Any new `Slide`/element field needs the same
  forwarding or it evaporates on the first `read()`.
- **Dual RAF loops must cancel on EVERY nav path.** The transition RAF was
  initially cancelled only in `next()`/`dispose()`; `prev`/`goToFirst`/
  `goToLast`/`setDocument` left it running, firing a stale `onDone` for the
  wrong slide. Fold all loop cancellation into one place.
- **Idle RAF spinning.** The object-animation loop re-scheduled at 60fps
  between steps; gate re-scheduling on `player.isAnimating`.
- **`easing` default vs explicit `linear`.** Import wrote `easing:'linear'`
  when accel/decel were absent, overriding the model's documented
  "absent ⇒ easeInOut". Leave optional fields UNSET to honor model defaults.
- **Human-facing direction labels vs engine geometry.** `AnimDirection` is
  the SOURCE side ("from"); the panel labels were all inverted relative to
  `offset()`. Engine + import agreed on VALUE — only the label layer drifted,
  which per-task review (each layer internally consistent) couldn't catch.
  This is the classic case for the whole-branch review.
- **Panel must subscribe to `onCurrentSlideChange`**, not just
  `onSelectionChange` — slide nav with an empty selection otherwise leaves
  the panel stale.

## Process notes

- Subagent-driven execution: pure-engine tasks (complete code in the brief)
  ran reliably on the cheapest model; integration tasks (presenter, import
  tree-walk, render injection) needed a standard model; the final
  whole-branch review used the most capable model and found the two
  cross-layer bugs the per-task reviews structurally could not.
- One implementer subagent died mid-run (transient auth error) having
  staged but not committed; the controller verified the files against the
  plan, ran the tests, and committed. The progress ledger + `git log` were
  the recovery map.
