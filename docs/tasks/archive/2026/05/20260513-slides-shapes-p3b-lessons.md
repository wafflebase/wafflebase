# Lessons — Slides Shapes P3-B (Google Slides parity sweep)

## Scope reconciliation

The todo's "Scope reference" inferred 62 shape rows from OOXML preset names + axis-type guesses. Across implementation the table held up well — no row needed renaming or family reassignment — but the adjustment counts on several rows turned out to be V0 simplifications rather than the OOXML-spec count:

- **`upDownArrow`** (todo: 2 adj `linear shaft + head`) — OOXML actually has 3 (head length, head width, shaft width). V0 kept 2 with a hardcoded `shaftFull = 0.5 × headHalf` ratio to keep the spec lean; future OOXML import will need a third adj.
- **`bentArrow` / `bentUpArrow`** (todo: 4 / 3 adj) — V0 collapsed to 2 (shaft thickness + head length) with a 90° sharp corner (OOXML's curved bend deferred).
- **`uturnArrow`** (todo: 5 adj) — V0 collapsed to 2.
- **`swooshArrow`** (todo: 2 adj) — matched.
- **`circularArrow`** (todo: 5 adj — 3 angular + 2 linear) — V0 has 3 (shaft + head + start angle); sweep fixed at 300° in code.
- **`leftRightUpArrow`** (todo: 3 adj) — matched.
- **All `curved*Arrow`** (todo: 3 adj = 2 linear + 1 angular) — V0 has 2 (shaft + head length); per-shape sweep fixed by direction.
- **`borderCallout1/2/3`** (todo: 4 / 6 / 8 adj) — V0 dropped the first OOXML start point (fixed at the rect's bottom midpoint), so adj counts ended at 2 / 4 / 6.

**Lesson:** Treat the inventory's adj count as a maximum, not a target. When the OOXML preset's adjustment surface is too rich for V0 (a parameter has no obvious drag-handle UX, or the visual would degenerate at extreme values), drop indices to defaults and document — far better than shipping handles for parameters that don't earn their place in the picker.

## Axis-type assignments that surprised

- **`pie` / `chord` / `arc` / `blockArc` angle units**. OOXML defaults use degrees × 60000 (e.g. `16200000 = 270°`), confirmed during T2b. The `angularHandle` factory takes OOXML 60000ths as its spec range; no conversion at the storage boundary.
- **`blockArc` thickness** is genuinely `adj3` linear, not angular — initially planned as another angular axis, but the inverse projection works out cleaner as "project pointer onto the sweep-midradial direction, derive inner fraction" (see `block-arc.ts`).
- **`circularArrow` start angle wrap-around**. Carrying `startAdjustments` in the angular handle's `apply` closure unwrapped a `355° → 365°` drag correctly; without the unwrap it would have snapped to `5°`.

**Lesson:** The angular-vs-linear axis decision often comes down to "does dragging in screen coords naturally map to atan2 (angular) or to a radial projection (linear)?". Both are valid for arc-based shapes — `blockArc` thickness specifically needs the radial-projection approach.

## Factory consolidation decisions

| Family | Outcome | Why |
|---|---|---|
| Curved arrows (4) | **Shared factory** in `arrows/curved.ts` with a `CurvedDirection` enum | Per-shape file is a 5-line wrapper around `makeCurvedArrowBuilder(direction)` + `curvedArrowHandles(direction)`. The factory absorbs the pivot-corner + theta-range mapping for each direction. Net win. |
| Snip/round-corner rects (7) | **Inline** per shape | Each shape has a unique corner-mod set; a shared factory would have needed a "corner kind" matrix that was longer than 7 × inline `lineTo` sequences. Tried and abandoned. |
| Sector shapes (pie/arc/chord/blockArc) | **Shared `basic/sector.ts` helper** with one path function per closure variant | The 4 shapes differ only in how the arc closes (back to centre / chord / open / annular). One helper per variant kept the per-shape file at ~30 lines including `ADJUSTMENTS` and `HANDLES`. |
| Line callouts (3) | **Per-shape inline** + shared `indexHandle` helper inside each file | Different adj counts (2 / 4 / 6) means a single factory couldn't capture all three. The `indexHandle(index)` helper inside each shape file dedupes within the shape (e.g. borderCallout3 uses 3 of them). |
| Banner scrolls (horizontal/vertical) | **Inline** per shape | Only 2 instances; a factory would mostly be call-site bloat. |
| Action buttons (12) | **Body shared via `drawActionButton`; per-button glyph file** | Body is identical across all 12 — the only thing that varies is the inner glyph. One small glyph file per kind keeps the inner art reviewable in isolation. |

**Lesson:** Shared factories pay off when (a) more than ~3 shapes share an identical parameter shape AND (b) the per-shape call-site shrinks below the inline math. Curved arrows met both bars (4 shapes, identical 2-adj surface). Snip/round rects met neither (7 shapes but each is a different corner mix).

## `polylineArc` segment-count revisions

`DEFAULT_ARC_SEGMENTS = 32` proved sufficient for every P3-B curved shape — no per-shape override was needed. The closest call was `circularArrow` at full 300° sweep on a 960 × 540 canvas (~5° per segment); visually clean after anti-alias. The 32 default is exported as a named constant so a future per-shape override is one line.

## Angular winding-disambiguation edge cases

Only one shape exercises angular handles with a wide spec range: `circularArrow`'s start angle (`min: -21600000, max: 21600000` = ±360°). Default `-3600000` (= −60°) with the gap opening upper-right; users dragging the handle CCW past −360° unwrap correctly because the `while`-loop normalisation in `angularHandle.apply` walks the result toward `startAdjustments[index]`-derived angle. No regressions observed in T7a/T7b smoke.

**Lesson:** The wide-spec wrap case is rare in practice (most shapes have `[0, 21600000]` = `[0°, 360°]` range and atan2 naturally stays in that band). The unwrap branch earns its keep only when the spec range covers more than one full turn — and even then it's a 6-line cost.

## Action button rendering

12 glyphs landed across T7a + T7b. All paths use only `moveTo` + `lineTo` + `closePath` plus `polylineArc` for the dot+stem on `actionButtonInformation` and the question-mark curve on `actionButtonHelp`. Two specific tuning notes:

- **`actionButtonReturn`** is the only multi-segment polygon with non-trivial topology (vertical stem + horizontal leg + leftward arrowhead). Required careful CW vertex ordering so non-zero winding paints the silhouette correctly; one early iteration had a self-intersection that left a sliver hole.
- **`actionButtonHelp`** uses an annular sector (`polylineArc` outer + inner) for the upper curve, plus a separate small disc for the dot. Two subpaths under non-zero winding render as the expected hollow `?` shape.

The 4 px bevel inset never collided with any glyph at typical slide sizes — glyph coordinates use `min(w, h) * 0.x` fractions, so they shrink proportionally below the inset at very small frames (where glyph would be unreadable anyway).

## Picker icon legibility at 24 px

The 12 action button glyphs were initially **transparent** in the Shape picker dropdown — caught by user during T7. Root cause: `renderShapeIcon` queried `PATH_BUILDERS` only; action buttons live in `ACTION_BUTTON_GLYPHS` via the `drawActionButton` special-cased dispatcher. Fix (separate commit `a49c4d79`): add an `isActionButton(kind)` branch to the icon renderer that strokes the body rect + the glyph path.

Notable picker-size readability calls:
- **`actionButtonMovie`** — the 6 sprocket-hole "stripes" become barely-visible specks at 24 × 24 px but the overall filmstrip silhouette is recognisable.
- **`actionButtonHelp`** — the hollow question-mark curve is legible; the centre dot can blur into the body fill at the smallest preview sizes.
- **Snip/round-corner rects** — the four diagonal-corner variants (snip2DiagRect / round2DiagRect / snipRoundRect) look similar at icon size because only 1-2 corners differ. The picker label (e.g. "Snip diagonal corners") is the disambiguator.

**Lesson:** When a family has multiple variants that differ only by one or two corner positions, expect picker-icon readability to be limited; rely on the user-facing label to disambiguate. The OOXML names themselves carry the discrimination (`snip1Rect` vs `snip2DiagRect`), so the picker label maps 1:1.

## Pre-commit hook timeout

`pnpm verify:fast` finished consistently in ~50–90 s during the sweep — comfortably under the harness's default 2-minute Bash timeout. No need for the P3-A.2 lessons §8 `$CLAUDE_JOB_DIR/commit-T*.log` redirect this time. The verify-fast lane stays viable as a pre-commit gate at P3-B's diff scale.

## Visual harness whitelist

Whitelist + scenarios shipped together in T8 (commit `d31a7018`). The P3-A.2 trap (scenario file lands, whitelist forgotten → silent skip) was avoided by adding both in the same commit and verifying `scenarioIds.length` grew by 4 before commit. Worth keeping the convention: any change to `slides-scenarios.tsx` that introduces a new `id` value should land alongside the matching whitelist edit in `verify-visual-browser.mjs`.

## What to do differently for the next phase (P3-C or later)

1. **Action button click semantics** is the obvious P3-C scope. The data field will likely be `data.action: { type: 'slide' | 'url' | 'sound', target: string }`. The current outline `outlined` style in `STYLE_BY_KIND` may not match the OOXML default-action behaviour — confirm before reusing.
2. **OOXML-fidelity refinements** for V0-simplified shapes. Order of biggest visual gap to closest:
   - `bentArrow` / `bentUpArrow` should have a curved bend, not a 90° corner.
   - `diagStripe` should be a parallelogram stripe, not a triangular wedge.
   - `plaque` should have arc-cut corners, not 45° chamfers.
   - `smileyFace` mouth could be a cubic-Bézier curve instead of a thin polyline band.
   - `heart` outline could be more rounded near the bottom tip.
   - `swooshArrow` should follow the OOXML cubic-Bézier path, not a quarter-ellipse.
3. **Beveled fill gradients** for action buttons (and the basic `bevel` shape). Listed in the design doc under "Theming" out-of-scope. Path data is already correct; this is a renderer-only change.
4. **Picker-icon flair** for `actionButtonHelp` / `actionButtonMovie` / `actionButtonSound` — consider per-shape `RenderShapeIconOverride` so the glyph can use a stylised picker-only path while the slide-canvas keeps the path-faithful version.
5. **Curved-arrow wide-flare arrowhead** — V0's pointy-tip falls short of the OOXML preset's visible flare. Adding the flare without falling off the frame edge needs either a frame-aware position offset (shift the pivot inward) or a clip rect to keep shoulders inside the bounds.
