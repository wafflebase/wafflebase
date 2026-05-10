# Slides Shape Library Phase 1 — Lessons

**Created**: 2026-05-09

Lessons captured while shipping Phase 1 of the slides shape library
expansion (4 → 35 OOXML-aligned ShapeKind values, path-builder
registry, categorised picker popover).

## Workflow / build

- `pnpm verify:fast` is green only **after** `pnpm sheets build && pnpm
  --filter @wafflebase/docs build && pnpm slides build` runs first. CI
  is fine because `pnpm verify:self` builds those packages before
  invoking `verify:fast`. Locally, a fresh checkout (or after `pnpm
  install` invalidates `dist/`) breaks verify:fast for the slides
  package — the frontend's Node test runner can't resolve directory
  imports like `from './themes'` against TypeScript sources, so it
  needs the built artifacts. **Always build the workspace packages
  before running verify:fast in a fresh shell.**

## Test infrastructure

- The slides package uses **Vitest**; the frontend package uses
  **node:test** with `--experimental-strip-types`. They are not
  interchangeable — Vitest-style tests (`vi.fn()`, `.toMatchObject`)
  do not work in the frontend. The frontend's test glob is
  `tests/**/*.test.ts` (not `.tsx`), and `tests/resolve-hooks.mjs`
  stubs `.tsx` modules at load time. **Component tests must extract
  their data into a sibling `*-helpers.ts` file**, mirroring the
  pre-existing `themed-color-picker-helpers.ts` /
  `theme-panel-helpers.ts` pattern.

- The slides `Path2D` shim in
  `packages/slides/src/view/canvas/test-canvas-env.ts` started life
  supporting only `rect`/`ellipse`/polygon ops. Phase 1 needed
  extensions to support: `quadraticCurveTo` (roundRect / wedgeRoundRect),
  `bezierCurveTo` (can), `arc` (cloud / mathDivide dots), `addPath`
  (cloudCallout), and an `'evenodd'` fill rule (donut). The
  approximation strategy — sampling each curve as 8/16/32 line
  segments and ray-casting the resulting polygon — is exact enough for
  inside/outside reference points well clear of the boundary. Edge
  semantics (ray-cast excludes right/bottom edges) differ from the
  browser; **prefer nudging a test point inward by 1 px over chasing
  edge-case shim semantics**.

- The frontend Yorkie schema declares `YorkieShapeElement` in
  `packages/frontend/src/types/slides-document.ts`, inlining its own
  copy of `ShapeKind` rather than re-exporting from
  `@wafflebase/slides`. **When `ShapeKind` (or any element-level type)
  changes in the slides package, update this parallel schema too** —
  otherwise Yorkie writes of new kinds narrow to `never` at type-check
  time. Same applies to `data` field expansions like `adjustments?:
  number[]`.

## Path-builder design

- Each path builder is `(size, adjustments?) => Path2D`. **Builders
  must not touch `fillStyle`/`strokeStyle`** — the dispatcher in
  `shape-renderer.ts` resolves theme colours and applies fill/stroke.
  This invariant is what lets the icon helper (`renderShapeIcon`)
  reuse builders by simply setting `strokeStyle = currentColor` and
  calling `ctx.stroke(builder(size))`. Mixing colour calls into a
  builder breaks both icon rendering and theme-aware re-paints.

- `donut` is the only Phase 1 shape that uses `'evenodd'` fill rule.
  The dispatcher carries a `const EVENODD_KINDS: ReadonlySet<ShapeKind>
  = new Set(['donut']);` so a single builder can emit two ellipses
  (outer + counter-clockwise inner) and have the hole rendered
  correctly. **Future shapes that need a hole (frame, halfFrame,
  roundRectFrame…) should be added to `EVENODD_KINDS`**, not by
  re-implementing the builder around path differencing.

- OOXML adjustment defaults are stored as **thousandths** (e.g.
  `25000` = 25%). Each `AdjustmentSpec` documents what dimension the
  index refers to (frame `w`, `h`, `min(w,h)`, etc.). Phase 2's
  toolbar UI iterates `ADJUSTMENT_SPECS` to build numeric inputs; the
  per-spec `format?: (n: number) => string` callback handles
  display-time formatting (e.g. `"16.7%"` for OOXML thousandths).

- The plan's `chevron` builder uses an approximate notch math
  (`min(w, notch * (w / h))`) rather than the OOXML formula
  (`min(w, h/2 * tan(angle))`). Visually fine for Phase 1, but
  **Phase 4's preset-formula evaluator should override this builder**
  rather than try to fix the approximation.

## Visual harness

- Five new scenarios in
  `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`
  cover the shape registry end-to-end: full 35-shape catalogue
  (5×7 grid) under three themes, plus single-shape baselines for
  donut (evenodd hole) and wedgeRectCallout (tail attachment).
- **Baselines need regeneration** after merge — run
  `pnpm verify:browser:docker:update` to capture the new PNGs and
  commit them. Without baselines, the next `pnpm
  verify:browser:docker` run fails for the new scenario IDs. Worth
  doing as a follow-up commit on this PR rather than a separate one
  so the visual gate stays meaningful.
- The catalog scenario uses `layoutId: "blank"` to keep the
  background uniform (no placeholder text adding noise to the
  geometry diff).

## Picker UX

- 35 canvas-rendered icons in the popover render fast enough on
  modern hardware (one stroked path each at 24×24 DPR), but **a
  visual / perf check on lower-end devices is recommended** before
  Phase 2 grows the catalogue to 55+. If perf becomes an issue, the
  per-icon canvas can be memoised across opens (currently re-painted
  in a `useEffect` per render).

- The plan called for `@radix-ui/react-popover`; the project uses
  `@radix-ui/react-dropdown-menu` for the sibling Fill / Font pickers
  in the same toolbar. **Stay consistent with the existing pattern**
  — DropdownMenu portals to the body and avoids toolbar overflow
  clipping the same way Popover would.

## Dispatcher invariants

- The unknown-kind fallback in `shape-renderer.ts` paints a
  placeholder rect and warns once per kind via `placeholderWarned`.
  This path matters in production: Phase 4's PPTX importer will
  encounter `prst` values not yet registered, and the importer's
  fallback strategy is "preserve the OOXML preset name as a string,
  let the dispatcher render placeholder until the builder lands".

- Each commit that registers a new kind needs to keep the unknown-kind
  fallback test exercising a still-unregistered kind. Phase 1's
  pattern was to pass the placeholder forward through tasks (T7→T8→T9)
  via small "Move placeholder" commits. **At T10 — the last task that
  registers kinds — we switched to a synthetic name
  (`'__test_unknown__' as ShapeKind`) cast through `as never`** so
  the fallback path remains under test. Future tasks that register
  more kinds should keep the synthetic name; the cast is the
  load-bearing detail.

## Subagent execution

- Subagent-driven development for ~50 commits worked well when the
  plan was specific. The biggest single dispatch (T7: 13 basic shape
  builders, ~1.5 hours) was uneventful because each shape's
  `Path2D` math was spelled out verbatim in the plan. Trying to "let
  the implementer figure it out" for any single shape would have
  produced visibly different geometry.

- Implementers reported reasonably accurate self-reviews; only one
  required a code-quality follow-up (T1's parallel `YorkieShapeElement`
  schema). The `code-reviewer` subagent caught the gap; the
  `spec-reviewer` did not. **Code quality review is worth keeping
  even when spec compliance passes** — the two angles catch different
  things.

## Things to watch in P2

- Phase 2 adds 14 flowchart shapes + 6 stars. Stars use multi-pointed
  geometry that may benefit from an "inscribed-polygon" helper in
  `shapes/builder.ts` — pentagon (T7.7) already does this manually.
  Generalising into a `regularPolygon(cx, cy, rx, ry, points)` helper
  would DRY this up.

- Phase 2 also adds the **adjustments toolbar UI**, which iterates
  `ADJUSTMENT_SPECS`. The format callback shape (`format?: (n: number)
  => string`) was designed for this. The Phase 1 specs already have
  meaningful min/max bounds; verify they match what the OOXML
  reference actually accepts before exposing them to users.
