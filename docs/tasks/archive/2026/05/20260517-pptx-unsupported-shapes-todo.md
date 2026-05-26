# Support unsupported PPTX preset shapes

## Context

User reported that slide 7 of a locally-supplied PPTX deck
(`Yorkie, 캐즘 뛰어넘기.pptx`) shows the centre shape as an empty
rotated rectangle instead of an arrow callout. Root cause: PPTX
preset
`rightArrowCallout` is missing from `ShapeKind`, so
`prstToShapeKind()` returns `undefined` and the importer falls back
silently to `rect` (shape.ts:389).

The same deck contains two more unsupported `prst` names that
produce the same silent-rect symptom:

| prst | Slide | Action |
|---|---|---|
| `rightArrowCallout` | slide7 | New `ShapeKind` + path builder |
| `homePlate` | slide31 | Alias to existing `pentagonArrow` |
| `leftBracket` | slide28 | New `ShapeKind` + open-path builder |

`packages/slides/test/import/pptx/geometry.test.ts:94-100` already
encodes the three `prst`s as "expected undefined" — they need to
flip to positive assertions after the fix.

## Scope

User asked to support all unsupported shapes. To keep OOXML
preset families coherent (so the next deck doesn't trip on a
sibling), add the natural sets rather than only the three
encountered:

- 7 arrow callouts: `rightArrowCallout`, `leftArrowCallout`,
  `upArrowCallout`, `downArrowCallout`, `leftRightArrowCallout`,
  `upDownArrowCallout`, `quadArrowCallout`
- 4 brackets/braces: `leftBracket`, `rightBracket`, `leftBrace`,
  `rightBrace` — open-path, stroke-oriented
- `homePlate` → `pentagonArrow` import alias (visually identical
  pentagon-pointing-right shape; only the OOXML preset name
  differs)

Total: 11 new `ShapeKind` values + 1 alias. Roadmap moves
117 → 128.

## Todo

- [x] Confirm patterns by reading existing builders (`buildRightArrow`, `buildQuadArrow`, `buildWedgeRectCallout`, `buildPentagonArrow`)
- [x] `packages/slides/src/view/canvas/shapes/callouts/right-arrow-callout.ts` with shared `ARROW_CALLOUT_ADJUSTMENTS`
- [x] `left-arrow-callout.ts` / `up-arrow-callout.ts` / `down-arrow-callout.ts` (mirror/rotate of right)
- [x] `left-right-arrow-callout.ts` / `up-down-arrow-callout.ts` (bidirectional body in middle)
- [x] `quad-arrow-callout.ts`
- [x] `packages/slides/src/view/canvas/shapes/basic/left-bracket.ts` (open path, rounded corners)
- [x] `right-bracket.ts` / `left-brace.ts` / `right-brace.ts`
- [x] Extend `ShapeKind` union in `packages/slides/src/model/element.ts`
- [x] Register PATH_BUILDERS / ADJUSTMENT_SPECS / ADJUSTMENT_HANDLES in `packages/slides/src/view/canvas/shapes/index.ts`
- [x] Add `homePlate` → `pentagonArrow` alias in `packages/slides/src/import/pptx/geometry.ts` (`prstToShapeKind`)
- [x] Flip the three negative assertions in `packages/slides/test/import/pptx/geometry.test.ts` to positive + add alias test
- [x] Unit tests for new builders (nominal frame, 0×0 degenerate)
- [x] Update `docs/design/slides/slides-shapes.md` shape count 117 → 128 + new categories
- [x] `pnpm verify:fast` green
- [x] Visual smoke check via `pnpm dev` on slide 7 / 28 / 31
- [x] Open PR; capture lessons; `pnpm tasks:archive && pnpm tasks:index`

## Notes

OOXML `rightArrowCallout` adjustments:
- adj1: shaft half-thickness as % of h/2 (default 25000)
- adj2: head half-thickness as % of h/2 (default 25000, ≥ adj1)
- adj3: head depth as % of w (default 25000)
- adj4: body width as % of w (default 64977)

Slide 7 uses adj1=9283, adj2=13570, adj3=16082, adj4=81236 with
a 90° rotation (`rot="5400000"`), producing an upward-pointing
thin arrow with a tall body to its left.

Brackets render via a single PathBuilder. OOXML defines them as
separate fill / stroke paths; we use a single open path and the
renderer skips `ctx.fill()` for open-path kinds (`OPEN_PATH_KINDS`
in `shape-renderer.ts`) so only the stroke outline paints — fills
would otherwise auto-close into a misleading C-rect. adj: corner
radius as % of min(w, h) (default 8333 ≈ 8.33%).

Braces add a middle notch. adj1 = corner radius, adj2 = notch
position (default 50000 = middle).
