# Slides Shape Library Phase 2 — Lessons

**Created**: 2026-05-09 (planning) / 2026-05-10 (implementation)

Lessons captured while shipping Phase 2 of the slides shape library
expansion (35 → 55 OOXML-aligned `ShapeKind` values, `regularPolygonPath`
helper, Flowchart + Stars picker categories).

## Workflow / build

- The P1 build prerequisite for `pnpm verify:fast` (workspace builds
  must be fresh) still applies. After the branch landed T1–T8, the
  full `verify:self` lane took roughly 73.2 seconds locally; commit hooks
  ran a tighter `verify:fast` per commit which kept the feedback loop
  short (34.5s).
- Subagent dispatch with the haiku model handled mechanical tasks
  (template instantiation, registry edits) reliably. The geometry-heavy
  T6 (path builder implementation for Flowchart + Stars) needed careful
  path-builder code in the prompt; the subagent did not need to reason
  about geometry, only translate the Unicode/SVG reference specs to our
  polyline/arc API.

## Path-builder design

- `regularPolygonPath(cx, cy, rx, ry, points, rotation?)` is the
  shared inscribed-polygon helper. Pentagon (P1) was refactored onto
  it in T3 with bit-identical output (registry snapshot unchanged).
  Stars iterate two rings (outer + inner) and zigzag through the points.
- `flowchart/wave.ts` exposes `appendSineWave(path, startX, endX,
  baseY, amplitude, segments)` for `document` / `multidocument` /
  `punchedTape`. `document.ts` also exposes
  `appendDocumentSubpath(path, x, y, w, h)` for `multidocument`'s
  three-layer stacking.
- Curves: P1 lessons advised against `Path2D.ellipse` due to shim
  quirks; T6 follows that. Full ellipses (`summingJunction`, `or`)
  use 64-segment polylines; semi-ellipses (`delay`, `display`) use
  32 segments. Tests pass without shim approximation issues.

## Picker UX

- The new picker categories slot into `SHAPE_PICKER_CATEGORIES` in
  `shape-picker-helpers.ts` between existing entries — Flowchart
  between `arrows` and `callouts`, Stars at the end. Final order:
  Lines · Shapes · Block Arrows · Flowchart · Callouts · Equation ·
  Stars (matches Google Slides).
- The picker invariant test (every kind has a registered builder
  + non-empty label) caught label-typo edge cases in development;
  no runtime work to add icons.
- The visual catalog scenario in `slides-scenarios.tsx` uses
  picker-category order *except* Stars and Flowchart sit at the
  end (after Equation), so the P1 portion of the grid stays in
  its original cells and the diff focuses on P2 additions. This
  is a deliberate trade-off — picker UX uses one order, visual
  regression baseline uses another to maximize diff signal.

## Frontend Yorkie schema

- The `YorkieShapeElement.data.kind: ShapeKind` import from
  `@wafflebase/slides` (post-P1 cleanup) means new kinds flow
  in automatically. The lessons rule from P1 only applies if a
  hypothetical NEW field were added to `data` — pure ShapeKind
  expansions need no parallel edit.

## Visual harness

- 55-shape catalog renders within the per-image baseline budget
  (PNGs stayed ~35–43 KB on a 5×11 grid). No need to split into
  two scenarios; if Phase 3 adds 50 more shapes, splitting will be
  necessary.
- Docker baseline regen (`pnpm verify:browser:docker:update`) ran
  cleanly on macOS arm64 via Rosetta linux/amd64 emulation; the
  platform mismatch warning is cosmetic.

## Things to watch in P3

- **Drag handle UX (yellow diamonds)** is the canonical Google
  Slides adjustments UX. P3 ships them on the canvas selection
  layer for every kind that registers an `ADJUSTMENT_SPECS` entry
  (currently 23 kinds: 17 P1 + 6 stars). Each drag handle reads
  one entry of `data.adjustments[]`, clamps to the spec's
  `[min, max]`, and writes back via the store.
- A complementary number-input popover (the original P2 idea,
  deferred) could land alongside drag handles for users who need
  exact values.
- P3 also adds 50 more shapes for full Google Slides parity. The
  `__test_unknown__` synthetic-cast pattern in the dispatcher
  fallback test (P1 lessons) must continue to be carried forward.
- The `flowChartDisplay` builder is a hand-coded approximation;
  the Phase 4 DrawingML formula evaluator is expected to override
  it with the canonical OOXML preset path.
