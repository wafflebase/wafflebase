# Slides Shapes P3-B — Google Slides Parity Sweep (62 shapes) Implementation Plan

**Goal:** Add **62 new `ShapeKind` values** with handles for every parametric shape, taking the catalog from 55 → **117**. Three small architectural pieces land alongside: `drawActionButton` dispatcher branch, `angular` adjustment-axis factory, shared `polylineArc` helper. Architecture is documented in `docs/design/slides/slides-shapes.md` (consolidated doc); this plan operationalises it.

**Architecture (recap, see design doc for details):**
- New families `banners/` (5 shapes), `action-buttons/` (12 shapes, special-cased).
- Curved shapes route through `shapes/curves.ts` (`polylineArc` / `polylineEllipseArc`) — no `quadraticCurveTo` in any new builder (P3-A.2 lessons §8: stay on one code path).
- 5th adjustment axis `angular` in `shapes/handles.ts` for arc-based parameters (pie/arc/chord/blockArc/circularArrow/uturnArrow/bentArrow/bentUpArrow/curved*Arrow).
- Action buttons skip `PATH_BUILDERS`; `drawActionButton` paints body + glyph in two passes.
- Picker section order grows to **Lines · Shapes · Block Arrows · Banners · Flowchart · Callouts · Equation · Stars · Action Buttons**.

**Tech stack:** TypeScript, Vitest, Canvas2D (untouched), DOM overlay (untouched). Reuses `ADJUSTMENT_HANDLES`, `renderOverlay`, `startAdjustmentDrag`, `paintLiveAdjustments` from P3-A.

**Reference docs:**
- Spec: `docs/design/slides/slides-shapes.md` (consolidated; §Renderer architecture, §Adjustments model "Five axis types", §Picker UI, §Phase roadmap row P3-B)
- Predecessor lessons (read first):
  - `docs/tasks/archive/2026/05/20260510-slides-shapes-p3a-pilot-lessons.md`
  - `docs/tasks/archive/2026/05/20260512-slides-shapes-p3a2-sweep-lessons.md`

**Branch:** `slides-shapes-p3b` (off `main` once `slides-shapes-design-consolidate` lands, or rebased onto it before push).

**Conventions:** subject ≤70 chars; body explains WHY; one task = one commit; `pnpm verify:fast` green between commits. Pre-commit hook can take 3-5 min — Bash timeout 600 s, redirect output to `$CLAUDE_JOB_DIR/commit-T*.log`, verify via `git log`.

---

## Scope reference — 62 new shapes by family

> Adjustment counts and axis types are **draft inferences** from OOXML preset definitions (ECMA-376 §20.1.9). Path builder is source-of-truth — reconcile each row before writing its handle and correct this table in place if it disagrees. (P3-A.2 lessons §1: 24-shape sweep had 3 row-level disagreements; expect more here.)

### Basic — 22 shapes (T2)
| # | ShapeKind | Adj count | Axis type (draft) |
|---|---|---|---|
| 1 | `heptagon` | 0 | — |
| 2 | `decagon` | 0 | — |
| 3 | `dodecagon` | 0 | — |
| 4 | `pie` | 2 | 2× angular |
| 5 | `chord` | 2 | 2× angular |
| 6 | `teardrop` | 1 | linear (point sharpness) |
| 7 | `frame` | 1 | linear (border thickness) |
| 8 | `halfFrame` | 2 | 2× linear (h-thickness, v-thickness) |
| 9 | `corner` | 2 | 2× linear |
| 10 | `diagStripe` | 1 | linear (stripe thickness) |
| 11 | `plaque` | 1 | linear (corner cut) |
| 12 | `bevel` | 1 | linear (bevel depth) |
| 13 | `foldedCorner` | 1 | linear (fold size) |
| 14 | `smileyFace` | 1 | linear (mouth curvature) |
| 15 | `heart` | 0 | — |
| 16 | `lightningBolt` | 0 | — |
| 17 | `sun` | 1 | radial (ray length) |
| 18 | `moon` | 1 | linear (crescent thickness) |
| 19 | `arc` | 2 | 2× angular |
| 20 | `blockArc` | 3 | 2× angular + 1 linear (inner radius) |
| 21 | `cube` | 1 | linear (depth) |
| 22 | `noSmoking` | 1 | linear (band thickness) |

### Snip / round-corner rects — 7 shapes (T3)
| # | ShapeKind | Adj count | Axis type (draft) |
|---|---|---|---|
| 23 | `snip1Rect` | 1 | linear-corner |
| 24 | `snip2SameRect` | 2 | 2× linear-corner |
| 25 | `snip2DiagRect` | 2 | 2× linear-corner |
| 26 | `snipRoundRect` | 2 | 2× linear-corner |
| 27 | `round1Rect` | 1 | linear-corner |
| 28 | `round2SameRect` | 2 | 2× linear-corner |
| 29 | `round2DiagRect` | 2 | 2× linear-corner |

### Block arrows — 13 shapes (T4)
| # | ShapeKind | Adj count | Axis type (draft) |
|---|---|---|---|
| 30 | `upDownArrow` | 2 | 2× linear (shaft + head) |
| 31 | `leftRightUpArrow` | 3 | 3× linear |
| 32 | `bentArrow` | 4 | 3× linear + 1 angular |
| 33 | `bentUpArrow` | 3 | 2× linear + 1 angular |
| 34 | `uturnArrow` | 5 | 4× linear + 1 angular |
| 35 | `curvedRightArrow` | 3 | 2× linear + 1 angular (sweep) |
| 36 | `curvedLeftArrow` | 3 | 2× linear + 1 angular |
| 37 | `curvedUpArrow` | 3 | 2× linear + 1 angular |
| 38 | `curvedDownArrow` | 3 | 2× linear + 1 angular |
| 39 | `circularArrow` | 5 | 3× angular + 2 linear |
| 40 | `notchedRightArrow` | 2 | 2× linear |
| 41 | `stripedRightArrow` | 2 | 2× linear |
| 42 | `swooshArrow` | 2 | 2× linear |

### Banners — 5 shapes (T5)
| # | ShapeKind | Adj count | Axis type (draft) |
|---|---|---|---|
| 43 | `ribbon` | 2 | 2× linear |
| 44 | `ribbon2` | 2 | 2× linear |
| 45 | `horizontalScroll` | 1 | linear (roll thickness) |
| 46 | `verticalScroll` | 1 | linear (roll thickness) |
| 47 | `leftRightRibbon` | 3 | 3× linear |

### Line callouts — 3 shapes (T6)
| # | ShapeKind | Adj count | Axis type (draft) |
|---|---|---|---|
| 48 | `borderCallout1` | 4 | 2× point (tail bend points) |
| 49 | `borderCallout2` | 6 | 3× point |
| 50 | `borderCallout3` | 8 | 4× point |

### Action buttons — 12 shapes (T7)
> No adjustments (OOXML `<a:avLst/>` empty). Two artefacts per shape: body builder + glyph builder. No `ADJUSTMENT_SPECS` / `ADJUSTMENT_HANDLES` entries. Click semantics deferred to P3-C.

| # | ShapeKind | Glyph |
|---|---|---|
| 51 | `actionButtonBlank` | (none) |
| 52 | `actionButtonBackPrevious` | left triangle |
| 53 | `actionButtonForwardNext` | right triangle |
| 54 | `actionButtonBeginning` | left triangle + vertical bar |
| 55 | `actionButtonEnd` | right triangle + vertical bar |
| 56 | `actionButtonHome` | house outline |
| 57 | `actionButtonInformation` | "i" circle |
| 58 | `actionButtonReturn` | bent return arrow |
| 59 | `actionButtonMovie` | filmstrip |
| 60 | `actionButtonSound` | speaker + waves |
| 61 | `actionButtonDocument` | folded-corner doc |
| 62 | `actionButtonHelp` | "?" |

---

## Tasks

Each task = one commit on `slides-shapes-p3b`. Mark complete when the commit lands locally and `pnpm verify:fast` is green.

### Setup

- [x] **T0 — Branch + commit todo+lessons skeleton + design doc updates** (commit `26ca1ade`)
  - `git checkout -b slides-shapes-p3b` (off `main` or `slides-shapes-design-consolidate`)
  - `pnpm verify:fast` green baseline
  - This file + `20260513-slides-shapes-p3b-lessons.md` skeleton + the `docs/design/slides/slides-shapes.md` edits go into this commit.

### Shared infrastructure

- [x] **T1 — `shapes/curves.ts` + `angularHandle` factory** (commit `5825f73d`)
  - New `shapes/curves.ts` exporting `polylineArc(cx, cy, rx, ry, theta0, theta1, segments = DEFAULT_ARC_SEGMENTS)`. Single helper handles both circle and ellipse via distinct `rx` / `ry` — no separate `polylineEllipseArc` needed.
  - Add `angularHandle({ center, radius, index, spec })` to `shapes/handles.ts`. `apply` carries a winding-disambiguation branch (while-loops normalise atan2 result to within ±180° of `startAdjustments[index]`-derived angle) so dragging across 0°/360° doesn't snap. Pre-condition: `spec.min`/`max` in OOXML 60000ths.
  - Unit tests:
    - `shapes/curves.test.ts` (10 cases): monotonic advance, analytical endpoint match within `1e-9`, full-circle close, reverse sweep, elliptical, segment-count validation.
    - `shapes/handles.test.ts` angular cases (13 cases): 4 quadrants + 359°, wrap-around (start 355° → 365°), clamp above spec.max, multi-index passthrough, round-trip identity.
  - No new `ShapeKind`; no registry edits; no picker changes.

### Shape sweep

> **Picker registration is per-family** (Option B). Each T2–T7 commit
> includes the matching `SHAPE_PICKER_CATEGORIES` entries and
> `STYLE_BY_KIND` rows so the new shapes are insertable from the
> dropdown the moment the commit lands. T8 reduces to visual
> scenarios + whitelist + baselines + invariants.

- [x] **T2 — 22 basic shapes + handles + picker entries**
  - Files: `basic/{heptagon,decagon,dodecagon,pie,chord,teardrop,frame,halfFrame,corner,diagStripe,plaque,bevel,foldedCorner,smileyFace,heart,lightningBolt,sun,moon,arc,blockArc,cube,noSmoking}.ts`.
  - `pie` / `arc` / `chord` / `blockArc` share a private `sectorPath` helper in `basic/sector.ts` (P3-A.2 lesson §2: factor when call-site shrinks below inline math).
  - Parametric shapes register `*_HANDLES` next to the builder. `pie`/`arc`/`chord`/`blockArc` route through `angularHandle` for angle adjustments; `blockArc` adds one `linearXHandle` for the inner-radius axis.
  - `<kind>.test.ts` per shape; `<kind>.handles.test.ts` only for parametric shapes.
  - Register all 22 in `shapes/index.ts` `PATH_BUILDERS` + `ADJUSTMENT_SPECS` + `ADJUSTMENT_HANDLES` maps.
  - `ShapeKind` union in `packages/slides/src/model/element.ts` gains the 22 kinds.
  - **Picker**: add 22 entries to the existing `Shapes` section in `SHAPE_PICKER_CATEGORIES` (`shape-picker-helpers.ts`). Existing `STYLE_BY_KIND` Basic row already covers them.
  - **Smoke**: run `pnpm dev`, open a slide, verify the 22 new shapes appear in the Shapes section of the picker and one example from each axis family (e.g. `pie`, `frame`, `heart`) inserts and renders correctly.

- [x] **T3 — 7 snip/round-corner rects + handles + picker entries**
  - Files: `basic/{snip1Rect,snip2SameRect,snip2DiagRect,snipRoundRect,round1Rect,round2SameRect,round2DiagRect}.ts`.
  - All 7 reuse `linearTopEdgeHandle` (per-corner index passed via `index` parameter — already supported, P3-A.2 lessons §3). `snipRoundRect` mixes snip-corner + round-corner indices in one shape.
  - One unit test + one handle smoke test per shape.
  - **Picker**: add 7 entries to the `Shapes` section (after the basic 22, before the section closes). Basic row of `STYLE_BY_KIND` covers them.
  - **Smoke**: `pnpm dev` — verify all 7 appear and at least one of each (snip vs round) inserts correctly.

- [x] **T4 — 13 block arrows + handles + picker entries**
  - Files: `arrows/{up-down,left-right-up,bent,bent-up,uturn,curved-right,curved-left,curved-up,curved-down,circular,notched-right,striped-right,swoosh}-arrow.ts`.
  - Curved arrows (curvedRight/Left/Up/Down) share a directional factory in `arrows/curved.ts` (mirrors the P3-A.2 `directionalArrowHandles` pattern). If symmetry doesn't collapse cleanly to one factory, drop to inline per-direction and record divergence in lessons.
  - `circularArrow`, `uturnArrow`, `bentArrow`, `bentUpArrow`, `notchedRightArrow`, `stripedRightArrow`, `swooshArrow`: expect inline implementation. Try a shared factory only if 2+ of them collapse to the same arg signature.
  - All curve segments use `polylineArc`.
  - Unit + handle tests per shape.
  - **Picker**: add 13 entries to the existing `Block Arrows` section. Existing Block Arrows row of `STYLE_BY_KIND` covers them.
  - **Smoke**: `pnpm dev` — verify all 13 appear; insert one curved (e.g. `curvedRightArrow`) and one ad-hoc (e.g. `uturnArrow`) and confirm rendering.

- [x] **T5 — 5 banners + handles + new picker section**
  - New folder `shapes/banners/` with index module pattern matching existing families.
  - Files: `banners/{ribbon,ribbon2,horizontal-scroll,vertical-scroll,left-right-ribbon}.ts`.
  - `horizontalScroll` and `verticalScroll` share a private `scrollEnds` helper for the curled-end paths (uses `polylineArc`).
  - Register family in `shapes/index.ts`.
  - **Picker**: introduce the new `Banners` section in `SHAPE_PICKER_CATEGORIES` between Block Arrows and Flowchart (matches design doc ordering). Add 5 entries.
  - **`STYLE_BY_KIND`**: add Banners row (`'filled' (accent1)`).
  - **Smoke**: `pnpm dev` — verify the new Banners section appears in the picker after Block Arrows, all 5 entries visible and insertable.

- [x] **T6 — 3 line callouts + handles + picker entries**
  - Files: `callouts/{border-callout-1,border-callout-2,border-callout-3}.ts`.
  - Multiple tail points → reuse `pointTailHandle` factory (P3-A.2 lessons §2 already promoted it to `callouts/handles.ts`); each callout registers 2-4 handles.
  - Unit + handle tests per shape.
  - **Picker**: append 3 entries to the existing `Callouts` section. Existing Callouts row of `STYLE_BY_KIND` covers them.
  - **Smoke**: `pnpm dev` — verify the 3 line callouts appear at the bottom of the Callouts section; drag-add one and confirm tail handles drag correctly.

- [x] **T7 — 12 action buttons + `drawActionButton` + dispatcher branch + new picker section**
  - New folder `shapes/action-buttons/`. Files per button: `action-buttons/<name>.ts` exporting `<NAME>_BODY: PathBuilder` and `<NAME>_GLYPH: (size) => Path2D`.
  - `shapes/action-buttons/index.ts` aggregates `ACTION_BUTTON_GLYPHS: Map<ShapeKind, GlyphBuilder>` (body builder map kept separate from `PATH_BUILDERS`).
  - `shape-special.ts`: new `drawActionButton(ctx, size, data, theme)` paints body (outer rect + 4 px inset bevel rect, single fill from `data.fill ?? role('background')`) then glyph (scaled by `min(w, h)`, fill = `role('text')`).
  - `shape-renderer.ts`: add `if (isActionButton(data.kind)) return drawActionButton(...)` branch.
  - `isActionButton(kind)` = `kind.startsWith('actionButton')`.
  - `ShapeKind` union gains the 12 button kinds.
  - **No** `ADJUSTMENT_SPECS` / `ADJUSTMENT_HANDLES` entries for any button.
  - Unit tests:
    - `action-buttons/<name>.test.ts`: snapshot body+glyph commands for default size.
    - `shape-special.test.ts`: extends to cover `drawActionButton` two-pass paint (fill called twice, distinct paths).
  - **Picker**: introduce the new `Action Buttons` section as the last section in `SHAPE_PICKER_CATEGORIES`. Add 12 entries.
  - **`STYLE_BY_KIND`**: add Action buttons row (`'filled' (background)` + `'text'` stroke 1; glyph fill forced to `'text'`).
  - **`shape-picker.test.ts` invariants**: every action-button entry has a registered `ACTION_BUTTON_GLYPHS` glyph; every action-button kind is recognised by `isActionButton`.
  - **Smoke**: `pnpm dev` — verify Action Buttons section appears at the end of the picker; insert at least 3 distinct buttons (e.g. Home, Forward Next, Help) and confirm body + glyph render with the right colours.

- [x] **T8 — Visual scenarios + whitelist + baselines + closeout invariants**
  - Visual scenarios in `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`:
    - `shapes-basic-p3b` (29 shapes — 22 basic + 7 snip/round)
    - `shapes-arrows-p3b` (13 block arrows + 5 banners = 18 shapes)
    - `shapes-callouts-p3b` (3 line callouts)
    - `shapes-action-buttons` (12 buttons)
  - **Whitelist update** (P3-A.2 lessons §6 — easy to forget): add all 4 IDs to the `scenarioIds` array in `packages/frontend/scripts/verify-visual-browser.mjs`.
  - Regen baselines with `pnpm verify:browser:docker:update`; visually inspect each new baseline before commit.
  - Final cross-family invariant pass: existing `shapes/index.test.ts` registry-consistency test asserts every parametric kind in `ADJUSTMENT_SPECS` has an `ADJUSTMENT_HANDLES` entry (auto-passes given T2–T7 discipline).

### Closeout

- [x] **T9 — Self-review + PR** (in progress at archive time — completes when PR opens)
  - Dispatch `code-review` or `superpowers:requesting-code-review` skill over the full branch diff. Resolve blockers; note non-blockers in lessons doc.
  - Rebase on latest `origin/main`. Re-run `pnpm verify:fast` and `pnpm verify:browser:docker`.
  - Push branch; open PR (title ≤70 chars; body = summary + test plan + four scenario screenshots).

- [x] **T10 — After merge: archive + design-doc finalisation**
  - Fill lessons in `20260513-slides-shapes-p3b-lessons.md` ✓ (commit `651b907e`).
  - Update `docs/design/slides/slides-shapes.md` Summary count `55` → `117` ✓; strike the P3-A.1 / P3-A.2 / P3-B rows in §Phase roadmap ✓. PR number annotation deferred to post-merge.
  - Flip remaining `- [ ]` → `- [x]` in this todo ✓; run `pnpm tasks:archive && pnpm tasks:index` to land the pair in `archive/2026/05/`.
  - Commit the archive move + design-doc edits together.

---

## Verification (must all be true before opening PR)

- [x] `pnpm verify:fast` green
- [x] `pnpm verify:self` green (pending re-verify after late edits)
- [x] `pnpm verify:browser:docker` green — final scenario set: `shapes-adjustments-p3b-basics`, `shapes-adjustments-p3b-arrows`, `shapes-action-buttons`, plus the expanded `slides-canvas-shapes-catalog-{light,dark,material}` carrying all 117 kinds
- [x] All 62 new kinds registered in `PATH_BUILDERS` or `ACTION_BUTTON_GLYPHS` — asserted by `registry.snap.test.ts` snapshot diff
- [x] Every parametric shape with `ADJUSTMENT_SPECS` also has `ADJUSTMENT_HANDLES` — asserted by existing `shapes/index.test.ts`
- [x] P1/P2/P3-A visual baselines drifted **only** for the legitimate catalog expansion (55 → 117 in `slides-canvas-shapes-catalog-*`) and the harness-root composite that contains them
- [x] Picker shows new families in correct order — Lines · Shapes · Block Arrows · Banners · Flowchart · Callouts · Equation · Stars · Action Buttons

## Accepted limitations

- **Bevel highlight gradient on action buttons**: flat fill in V0; tracked under design-doc Out-of-scope follow-ups (Theming row).
- **Click semantics for action buttons**: out of scope; P3-C follow-up.
- **Native Bézier curves**: every curved shape uses `polylineArc` even where production browsers would render Bézier crisper at extreme zoom. Single code path > test/prod divergence.
- **Separate Insert > Action button menu entry**: single popover for V0; split to a separate entry under P3-C.

## Out of scope (recorded for later phases)

| Phase | Item |
|---|---|
| P3-A.3 | Popover number-input fallback for typed adjustment values |
| P3-C | Action button click handlers in presentation mode; separate Insert > Action button menu entry |
| Theming | Beveled fill gradients (action buttons + `bevel` shape) |
| P4 | DrawingML formula evaluator (`<a:avLst>` PPTX adjustment round-trip) |
| Importer | `prst → ShapeKind` mapping table extended with 62 new entries |
| Selection | Path-precise hit-testing (`ctx.isPointInPath`) — relevant for `pie`/`arc` interior |
