# Slides Shape Gaps vs PowerPoint / Google Slides

Review of the shapes `@wafflebase/slides` should support, benchmarked
against PowerPoint and Google Slides. Current catalog is **128 closed-path
`ShapeKind` builders + special renderers** (lines/arrows via `ConnectorElement`,
action buttons) and is effectively at **Google Slides parity** for the
Shapes / Arrows / Callouts / Equation menus. The gaps below are mostly
PowerPoint-side extensions plus the freeform drawing tool.

## Current coverage (baseline)

| Category | Count | Notes |
|---|---|---|
| Basic shapes | ~33 | rect…noSmoking |
| Snip/round rects | 7 | snip1Rect…round2DiagRect |
| Block arrows | 21 | right…curvedDownArrow |
| Banners | 5 | ribbon, ribbon2, scrolls, leftRightRibbon |
| Callouts | 14 | wedge×4, borderCallout1/2/3, arrow callouts ×7 |
| Brackets/braces | 4 | single left/right bracket + brace only |
| Equation | 6 | mathPlus…mathNotEqual |
| Stars | 6 | star4/5/6/7/8/10 |
| Flowchart | 14 | + process/decision/data/altProcess as aliases |
| Action buttons | 12 | blank…help |
| Connectors | — | straight/elbow/curved routing + arrowheads |
| Freeform | 1 | `freeform` is **PPTX-import only**, not user-drawable |

## Gap analysis

### P0 — high visibility, low cost (both PPT and GS expose)
- [x] Explosions: `irregularSeal1`, `irregularSeal2` (Stars & Banners)
- [x] Waves: `wave`, `doubleWave`
- [x] High-point stars: `star12`, `star16`, `star24`, `star32`
- [x] **Freeform / Scribble drawing tool** — promoted import-only
      `freeform` to a user-authored tool. The Line ▾ picker's Scribble
      entry arms `setInsertMode('freeform')`; `startScribbleInsert`
      captures the
      pointer stream (distance-decimated), live-previews via the shared
      `forceRender` ghost channel, and commits a stroke-only freeform
      ShapeElement whose `data.path` is normalized to the captured bbox.
      (Click-vertex polyline + curve-smoothing variants deferred; the
      freehand scribble is the high-value Google-Slides parity case.)

### P1 — small builders
- [x] `bracketPair` (double bracket `[ ]`), `bracePair` (double brace `{ }`)

### P2 — PowerPoint-only (GS has no Flowchart category)
- [x] Flowchart remainder: `preparation`, `connector`, `collate`, `sort`,
      `extract`, `merge`, `onlineStorage`, `magneticDisk`, `magneticDrum`,
      `magneticTape`

### P3 — variants, low impact
- [x] Curved up/down ribbon banners (`ellipseRibbon`, `ellipseRibbon2`)
      — simplified parabolic band + folded end tabs (consistent with the
      V0 straight `ribbon` simplification), body-height drag handle.
- [~] Callout variants (`callout1/2/3`, `accentCallout1/2/3`,
      `accentBorderCallout1/2/3`) — **deferred by decision.** In our
      single-Path2D fill+stroke model the plain `calloutN` family is
      *geometrically identical* to the shipped `borderCalloutN` (the only
      OOXML delta is whether the body rect strokes, which the Stroke
      picker already controls); shipping them would be pure duplicates,
      which `slides-shapes.md` explicitly warns against ("keep this list
      small"). The accent variants add only a cosmetic inner bar that
      would need path-splitting to render without a fill artifact. The
      existing `borderCallout1/2/3` already cover the line-callout need;
      revisit if/when the renderer gains multi-subpath fill control.

### Already planned (no action here)
- Remaining ~130 OOXML presets (`gear6/9`, `chartX/Plus/Star`, `funnel`, …)
  are deferred to **P4** in `slides-shapes.md` behind the DrawingML formula
  evaluator + `kind: 'preset'` escape hatch.

## Plan

- [x] Reflect gaps into `docs/design/slides/slides-shapes.md` phase roadmap
      (new P3.5 = P0/P1 catalog additions, P5 = freeform drawing tool). — #387
- [x] Land P0 catalog shapes as builder-only additions (one file per shape
      in the matching `shapes/<category>/` dir + registry `.set()` + picker
      category entry). No schema migration (adjustments are additive). — #387
      (PATH_BUILDERS 114 → 136; see Review/Outcome)
- [x] Freeform drawing tool is its own task (editor interaction work, larger).
      — shipped as the freehand scribble tool in #387

## Review

**Outcome.** All P0/P1/P2/P3 gaps closed (callout variants resolved by
documented decision). The catalog grew by 22 closed-path builders +
the freehand scribble tool. PATH_BUILDERS: 114 → 136.

Shipped across three commits:
1. **PPT-parity catalog** — 4 high-point stars, 2 explosions, 2 waves,
   2 double brackets, 10 flowchart symbols. Vertices/defaults
   transcribed from the ECMA-376 preset geometry (pulled from the
   LibreOffice `presetShapeDefinitions.xml`).
2. **Freehand scribble** — Line ▾ picker Scribble entry →
   `startScribbleInsert` pointer capture → normalized `FreeformPath`.
3. **Curved ribbons + insert defaults backfill** — `ellipseRibbon/2`,
   plus per-kind size/style for every new shape.

**Verification.**
- `@wafflebase/slides`: typecheck clean, 264 test files green
  (added `p35-catalog.test.ts`, `insert-freeform.test.ts`, and
  importer-resolution + registry-snapshot coverage).
- Frontend picker test updated 115 → 137 entries; eslint clean on
  touched files.
- PPTX importer resolves all 22 new presets with zero translation
  (`prstToShapeKind` checks `PATH_BUILDERS`), asserted in
  `geometry.test.ts`.

**Known limitations.**
- Curved ribbons + straight ribbon are simplified V0 approximations of
  the OOXML parabolic presets (recognizable, not pixel-exact).
- Scribble is freehand only; click-vertex polyline + curve smoothing
  deferred.
- Plain/accent line-callout variants intentionally not shipped
  (duplicate geometry in the single-path model — see P3 above).
- Wave `adj2` (pitch/skew) stored for round-trip but not rendered.

**Not done (out of scope by design):** P4 — the remaining ~33 OOXML
presets behind the DrawingML formula evaluator (`gear6/9`, `chartX`,
`funnel`, …) remain planned, gated on `kind: 'preset'`.
