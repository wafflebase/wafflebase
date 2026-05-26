# Lessons — Slides Shapes P3-A.2 (Adjustment Handles Sweep)

## Scope reconciliation

The todo's "Scope reference" table was inferred from filenames + spec entries; reading the path builders before writing each handle uncovered three places where the inference was off:

- **`donut` is not radial in the `radialStarHandle` sense.** Stars use a multiplicative inner ratio (`innerRx = outerRx * ratio`), so the factory closes over `theta` and projects pointer onto a unit-ellipse ray. Donut's inner ring is subtractive (`innerRx = outerRx - t`) with `t` scaled by `min(w, h)` (not by either axis individually). The math is genuinely linear, not radial, and the radial factory doesn't fit. The handle is inlined.
- **`plus` and `pentagonArrow` are linear-x but with non-trivial forward functions** — `plus` is centred (`xL = (w - t)/2`), `pentagonArrow` is reversed (`x = w - point`). The `linearTopEdgeHandle` factory taking `forward`/`inverse` per shape (rather than hard-coding a single mapping) was the right call.
- **`mathPlus` is geometrically identical to `basic/plus`** — same forward and same inverse, only the default thickness differs. Reusing the same factory call pattern produced one fewer file's worth of math without sacrificing per-shape clarity.

**Lesson**: When a sweep design doc gives a scope table, treat it as a coarse plan. Each row needs its path builder read individually before the handle is written — for a 24-shape sweep, that's 24 small disambiguations, not "trust the table once and proceed."

## Factory consolidation decisions

The lessons doc on P3-A.1 said "If symmetry collapses cleanly: one factory; if not: split per-direction and record the divergence." Here is what collapsed:

| Family | Outcome | Why |
|---|---|---|
| 7 linear-x basics (triangle, parallelogram, trapezoid, hexagon, octagon, plus, pentagonArrow) + roundRect | **`linearTopEdgeHandle({forward, inverse, spec, index?})` factory** | Per-shape forward/inverse are 4 lines each; the factory adds clamping + 8px corner inset + multi-adjustment index passthrough. Net win. |
| 3 point-axis callouts (`wedgeRoundRectCallout`, `wedgeEllipseCallout`, `cloudCallout`) + `wedgeRectCallout` | **`pointTailHandle(specX, specY)` factory** | Identical tail-tip encoding across all four; the factory absorbs the corner-inset-near-corner rule once. |
| 5 directional arrows | **5 inline implementations** | The math collapses logically (each is a rotated/mirrored version of rightArrow) but parameterising it required ~6 axis/length/perp/scale arguments per call, the same volume of code as inline. Inline is clearer per-shape. |
| `quadArrow`, `donut`, `can`, 6 math equations | **Inline** | Single use; no reuse opportunity. |

**Lesson**: A "shared factory" is only a net win when the per-shape callsite is *shorter* than inline math + the factory itself adds something the shape would otherwise re-derive (clamping, inset, index passthrough). For the arrows, the factory would have moved the math from inline to factory args without reducing it.

## `linearTopEdgeHandle` index parameter

The factory originally hard-coded `adjustments[0]` and returned `[clampedValue]`. For `wedgeRoundRectCallout`'s corner-radius adjustment (index 2 in a 3-element array) the factory needed an `index?: number` parameter plus a `[...start]; result[index] = clamped` apply implementation.

The refactor is backward-compatible (default `index = 0`, default `arity` inferred from `start.length`) so the 7 T2 shapes work without changes.

**Lesson**: When extending a single-purpose factory to handle multi-axis shapes, pass through other indices via `[...start]; result[index] = clamped` rather than rebuilding the full array from primitives. The spread+assignment is one line and self-documents the contract.

## `insetAlongAxis` helper

The 8px corner inset was originally inline inside `roundRect` (T1) and `wedgeRectCallout` (also T1). Each new shape that paints near a frame edge needs the same guard. Extracting `insetAlongAxis(coord, dim)` as an exported helper in `shapes/handles.ts` made it trivial to apply across:

- `linearTopEdgeHandle` (all 8 linear-x shapes through the factory)
- inline `can` (linear-y on h-axis)
- inline `donut` (linear-x on w-axis, painted near right edge)
- all 5 directional arrows (both axes per arrow)
- `quadArrow` (3 handles, mixed axes)
- 6 math equations (mostly y-axis)

The wedge callouts use a different inset pattern (corner-only, not edge-only) — that lives inside `pointTailHandle`.

**Lesson**: Inset-near-edge is a recurring concern for any new handle. A small named helper exported from the family's `handles.ts` is the right home; per-shape inlining loses to DRY as the shape count grows past 2-3.

## `mathMultiply` rotation gotcha

The shape is a `+` outline rotated 45° about the centre. The natural handle position would be "top of the cross's vertical arm" in the un-rotated frame at `(cx, cy - t/2)`. After the 45° rotation, the same vertex lands at `(cx, cy - t * SQRT1_2)` (the SQRT1_2 falls out of the rotation matrix applied to `[−t/2, −t/2]`).

The first attempt put the handle at `(cx, cy - t/2)` from naive thinking, which would have placed it inside the shape rather than on the visible outline. The inverse also needs the SQRT1_2 factor: `t = (cy - pointer.y) / SQRT1_2`.

**Lesson**: For shapes built by rotating an un-rotated outline, derive the handle position in the rotated frame, not by inspecting the un-rotated math. The rotation factor (here SQRT1_2) appears in both `position` and `apply` and must be symmetric.

## `axisLabel` only collides once after P3-A.2

Multi-axis specs added by the sweep: 5 arrows × 2, quadArrow × 3, wedgeRoundRectCallout × 3, 3 simple callouts × 2, mathEqual × 2, mathDivide × 3, mathNotEqual × 3. The `lastWord` heuristic produces distinct labels for *all but one*: `mathNotEqual`'s `"Bar thickness"` and `"Slash thickness"` both collapse to `"thickness"`.

So P3-A.2 ships with `axisLabel` populated on exactly two specs (the two `thickness` entries). Every other multi-axis spec is left alone — adding labels everywhere would be premature.

**Lesson**: Optional fields like `axisLabel` should be populated only where the default heuristic fails. Blanket population grows the surface area for inconsistency without earning anything.

## Visual harness has a hardcoded scenario whitelist

`packages/frontend/scripts/verify-visual-browser.mjs` keeps an explicit `scenarioIds` array. The visual harness does NOT auto-discover scenarios from `slides-scenarios.tsx` — adding a scenario file is half the work; the other half is appending the id to the whitelist.

The first baseline-regen run silently skipped `shapes-adjustments-sweep` and only updated the pilot, with no error. Catching this required reading the script.

**Lesson**: When adding a new visual scenario, search for the existing pilot's id in the broader codebase, not just in the scenarios file. The whitelist file is the second integration point.

## Pre-commit hook timeout

The repo's pre-commit hook (`.githooks/pre-commit`) runs `pnpm verify:fast` — full lint + every package's unit tests. On this hardware that takes ~3-5 minutes. Two specific Bash-tool consequences:

- The default 2-minute tool timeout aborts the commit before the hook completes. Bump tool timeout to 600s for any commit on a non-trivial diff.
- The hook output is large (1000+ lines from frontend node test runner) and overflows the tool's stdout buffer, returning a non-zero exit code even when the underlying commit succeeded. Redirect commit stdout/stderr to `$CLAUDE_JOB_DIR/commit-T*.log` and just check `git log` for landing.

**Lesson**: For any pre-commit hook that runs a large verification, route the commit output to a file and verify success via `git log` rather than the tool's exit code. Long-running hooks need explicit long timeouts.

## Unused-variable typecheck after handle extraction

After extracting `MATH_DIVIDE_HANDLES`'s gap handle, the `dotR` constant was computed but never read (the gap's geometry doesn't actually depend on `dotR`, only on `bar` and `gap`). `tsc --noEmit` caught it with TS6133; the pre-commit hook failed cleanly.

**Lesson**: Path builders compute values shared across the entire shape outline. When extracting a handle that only uses a subset, the leftover names that "look related" are often actually dead. Trust tsc — don't silence with `_` prefix unless the value is genuinely needed.

## What worked well

- **Per-task verify + commit cadence**: every task ended with `pnpm --filter @wafflebase/slides test` green + a single commit. The 10 commits on this branch are each shippable individually; a reviewer can read any one in isolation.
- **Scope reference table in the todo (with the "draft inferences" caveat)**: gave a map of the sweep without committing to it. Each row was reconciled at handle-writing time.
- **Sharing factories at the family boundary** (`basic/handles.ts`, `callouts/handles.ts`, `stars/handles.ts`, plus the cross-family `shapes/handles.ts`): the four files keep family-specific math local while letting cross-family helpers like `insetAlongAxis` live one level up.
- **Lifting the pilot's wedgeRectCallout tail math into `pointTailHandle` at the same time as registering the 3 new callouts**: kept the corner-inset behaviour single-sourced rather than fighting drift later.
- **Single source of truth for clamp ranges**: every factory and inline handle pulls `min`/`max`/`defaultValue` from the matching `AdjustmentSpec` entry, not hardcoded. The T1 `radialStarHandle` refactor (dropping `STAR_MIN`/`STAR_MAX`) set the pattern; the sweep follows it.

## What to do differently for P3-B

P3-B adds +50 shapes for Google Slides parity (banners, action buttons, more callouts). With the sweep complete, the abstractions to lean on are:

- `linearTopEdgeHandle`, `pointTailHandle`, `radialStarHandle`, `insetAlongAxis` — proven across 33 shapes. New shapes that fit these patterns get one-line registrations.
- For shapes that don't fit (likely: action buttons with click hit-areas; banners with non-edge handles), prefer inline implementation over forcing a factory. The arrows showed that fat factories don't earn their keep at 5 shapes.
- Multi-axis tooltips: every new multi-axis spec should be checked against the `lastWord` collision rule. After P3-A.2 only `mathNotEqual` needed `axisLabel`; new collisions surface easily with a small check.
- Visual harness scenarios: each new shape family (banners, action buttons) probably wants its own scenario rather than overcrowding the sweep grid. Reusing the 6×4 layout pattern keeps the baselines readable.
- The `verify-visual-browser.mjs` scenarioIds whitelist must be updated alongside the scenario file. Add a short script-side comment pointing at the .tsx, or — better — auto-discover scenarios by scanning the exported array.

## Accepted limitations carried forward

- **Inline arrow handles**: 5 directional arrows have inline 2-handle implementations rather than a parameterised factory. If P3-B introduces more block-arrow-like shapes (e.g. notched arrows, double-quad arrows), a factory becomes worth it; until then, inline.
- **`mathMultiply` perpendicular drag UX**: the handle slides along the y-axis only, even though the rotated shape's "thickness" axis is perpendicular to the slash. Following the un-rotated y-axis is simpler for the user (one familiar drag direction) but slightly less intuitive on a rotated shape. Revisit if user feedback flags it.
- **`mathNotEqual` slash-thickness handle**: drags along the slash perpendicular (using projection math). Three handles cluster on the upper-left quadrant — visually busy at default values where bar and slash are both near the centre. Acceptable for v1; could spread them later.
- **Pilot deferred #4 (thin per-star tests)** and **#5 (module-level tooltip singleton)**: unchanged from pilot lessons. Sweep doesn't surface either limitation more sharply.
