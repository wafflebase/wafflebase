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
      `freeform` to a user-authored tool. Toolbar Scribble toggle arms
      `setInsertMode('freeform')`; `startScribbleInsert` captures the
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
- [ ] Callout variants: plain / accent / accentBorder line-callout families
      (`callout1/2/3`, `accentCallout1/2/3`, `accentBorderCallout1/2/3`)
- [ ] Curved up/down ribbon banners

### Already planned (no action here)
- Remaining ~130 OOXML presets (`gear6/9`, `chartX/Plus/Star`, `funnel`, …)
  are deferred to **P4** in `slides-shapes.md` behind the DrawingML formula
  evaluator + `kind: 'preset'` escape hatch.

## Plan

- [ ] Reflect gaps into `docs/design/slides/slides-shapes.md` phase roadmap
      (new P3.5 = P0/P1 catalog additions, P5 = freeform drawing tool).
- [ ] Land P0 catalog shapes as builder-only additions (one file per shape
      in the matching `shapes/<category>/` dir + registry `.set()` + picker
      category entry). No schema migration (adjustments are additive).
- [ ] Freeform drawing tool is its own task (editor interaction work, larger).

## Review

(to fill in after implementation)
