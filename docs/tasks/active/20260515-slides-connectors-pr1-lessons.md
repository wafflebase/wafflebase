# Slides Connectors PR1 — Lessons

Captured at the end of the 15-task implementation. Patterns worth keeping
and stumbles worth not repeating.

## Patterns that worked

### Endpoint-driven model with derived `frame`

Keeping `frame` on `ConnectorElement` (so it satisfies `ElementBase` and
participates in the existing selection/z-order/hit-test infrastructure)
while treating it as a **derived bbox cache** maintained by
`computeConnectorFrame` proved cheap and clean. No consumer audit
needed; the renderer reads endpoints live, the cached frame just
serves selection bbox. `MemSlidesStore.updateElementFrame` was extended
to refresh dependent connector frames when a source shape moves —
single hook, O(connectors-per-slide) cost.

### Snapshot-based undo discovery

The original plan assumed closure-based inverses. The Task 6 implementer
discovered that `MemSlidesStore` is actually **snapshot-based** (deep-
clone of `this.doc` at outermost `batch()` entry). This made the cascade
sweep dramatically simpler: just mutate inside a batch and the snapshot
restores everything on undo. No need to push per-mutation inverses.

### Pure-function snap math + thin editor orchestration

`findSnapTarget`, `snappedEndpoint`, `finalizeInsert`, `dragEndpoint`
were all written as pure functions in `interactions/insert-connector.ts`
and `interactions/connector-endpoint-drag.ts`. The editor adds
deadband, ESC handling, batch boundaries, and `paintLive` repaints, but
the snap math itself is dead-simple to unit-test (15+ tests).

### Single source of truth for radii

`SHAPE_HOVER_RADIUS` and `SITE_SNAP_RADIUS` are exported from
`interactions/insert-connector.ts` and re-imported by `overlay.ts`. This
caught a unit mismatch (highlight `/ zoom` vs snap raw) — flagged in
code review and fixed cleanly because there's one place to align.

### Two-stage review per task

Spec compliance + code quality reviewers running in parallel after each
implementer caught real bugs:
- Task 5 → Task 6 cleanup of inline `import()` types.
- Task 11: sub-threshold drag pollutes undo stack (real correctness bug).
- Task 13: snap/highlight unit mismatch at zoom != 1 (real correctness bug).
- Task 12: missing editor-level deadband regression test.

Per-task review cost paid for itself.

## Stumbles worth not repeating

### Plan-time test math errors

The Task 2 test fixture asserted `e.y ≈ 300` for a 90° rotation case
where the correct answer is `350`. The implementer caught it via
TDD-red walkthrough. **Walk every coordinate-math test by hand before
publishing the plan**; the cost of a math slip in the plan compounds
across all subsequent implementers reading it.

### `batch()` snapshots eagerly on entry

`MemSlidesStore.batch` pushes the undo snapshot at `batchDepth === 0`
unconditionally — so wrapping a potential no-op in `batch(...)` leaks
a phantom undo entry. Hit this in Task 11 (sub-threshold connector
click → empty undo entry). The fix: move `batch(...)` inside the
function that owns the threshold check. **General principle: locate
transaction boundaries with the threshold gates, not at the call
site.** Audit other threshold-gated mutators (e.g. drag-to-resize) for
the same pattern at some point.

### Inline `import()` types vs top-level imports

Task 5's reviewer noticed inline `import('../model/connector').X` types
break the slides convention of top-level `import type { … }`. Used
inline form temporarily in the interface stubs to avoid dragging
connector types into the store interface's transitive surface — then
cleaned up in Task 6. **For PRs that span multiple commits, accept the
inline `import()` as a temporary scaffold; convert to top-level in the
commit that actually consumes the types.**

### Frontend consumers outside the slides package

Removing `'line'` / `'arrow'` from `ShapeKind` (Task 10) immediately
broke 2 frontend files that imported `ShapeKind` from
`@wafflebase/slides`: `shape-picker-helpers.ts` and
`slides-scenarios.tsx`. `pnpm verify:fast` did NOT catch this because
the frontend reads slides via emitted `dist/*.d.ts`, and `verify:fast`
doesn't rebuild slides or run `tsc -b` on the frontend. **`verify:fast`
is a lint-and-unit-test gate, not a cross-package type gate.** For any
breaking change to a package's public types, also run
`pnpm --filter @wafflebase/frontend exec tsc --noEmit` (or
`verify:self` which rebuilds). Task 14 caught and fixed these.

### Stub-error-message consistency

Stub branches (introduced in Task 1, removed in later tasks) had
inconsistent error messages: one cited a concrete task number, another
said "PR1 later". Trivial nit but compounded across files. **When
introducing TODO stubs, pick a single format with the task number that
will retire each stub** — makes the resolution flow easier to verify.

### CtxSpy API doesn't match plan sketch

The plan's test sketches assumed `new CtxSpy()` + `ctx.calls.map(…)`,
but the actual helper is `createCtxSpy()` + `asCtx()` returning a
factory of `vi.fn()`s. Task 7 implementer adapted correctly; minor but
worth noting. **Test sketches in plans should be marked as
"shape-only — verify actual helper API before copying"**, not
copy-paste-ready.

## Deferred to PR2 / PR3

Documented in the design doc but worth explicit mention:

- **PR2:** Per-`ShapeKind` connection-site overrides (triangle, diamond,
  star, callouts). PR1 ships 4-cardinal-only for all shapes.
- **PR2:** `routeElbow`, `routeCurved`, elbow `bend` handle and
  `updateConnectorElbowBend` store method.
- **PR3:** Arrowhead kinds beyond filled `triangle` (open variants,
  diamond, circle, square; sm/md/lg sizes).
- **PR3:** Inspector panel section for arrowhead selection.
- **PR3:** `drawConnectorIcon`'s arrowhead is stroked-only in the
  picker preview; the runtime renderer fills its triangle. Visual
  inconsistency between picker and canvas — small polish item.

## Non-blocking polish notes from reviews

Not worth blocking PR1 but worth opportunistic cleanup:

- `editor.ts` is on a growth trajectory (1526 lines after this PR);
  consider extracting connector-specific interaction orchestration to
  `interactions/connector-endpoint-drag.ts` itself rather than living
  inline on `SlidesEditorImpl`.
- `detachConnectorsTargeting` rebuilds the `Map` lookup once per
  mutated connector — O(n²) on `removeElements` with many ids. Trivial
  at expected slide sizes; flag if profiling ever shows it.
- Arrowhead-renderer test coverage uses only `angle = 0`. Add at least
  one off-axis test (e.g. `π/2`) to lock in the perpendicular sign
  convention.
- `TRIANGLE_LEN` / `TRIANGLE_WIDTH` constants are file-local; promote to
  a shared `ARROWHEAD_SIZES` registry when PR3 lands the other
  arrowhead kinds.
