# Slides: gradient fill for shapes (import + render + PPTX export)

## Problem

PPTX shapes filled with `<a:gradFill>` (linear gradient) import with no
fill: `parseShapeFill` handles only `<a:solidFill>` ("gradient and pattern
fills … out of v1 scope"). The renderer paints nothing for a fill-less
shape, so e.g. slide 4's three blue header boxes (비디오/이미지 생성,
멀티모달 추론 — `0093FF→006AFF`) and their white labels vanish.

There is **no existing gradient model** anywhere in the slides package —
`Background.fill` and shape `data.fill` are solid `ThemeColor` only. This
builds the precedent.

## Scope

- **Linear gradients only.** Radial/path (`<a:path>`) → approximated by the
  first stop (documented limitation).
- **Shape fills only** (`ShapeElement.data.fill`, incl. freeform — same
  field + renderer). Text-box fill, table-cell fill, and backgrounds are
  parallel solid-only stacks — deferred.

## Design

Model (`model/theme.ts`), additive:
```ts
export type GradientStop = { pos: number; color: ThemeColor }; // pos 0..1
export type GradientFill = { kind: 'gradient'; angle: number; stops: GradientStop[] };
export type Fill = ThemeColor | GradientFill;                  // discriminated on `kind`
export function representativeColor(fill: Fill): ThemeColor;    // gradient → first stop
```
`ShapeElement.data.fill?: ThemeColor` → `fill?: Fill`. The `kind:'gradient'`
discriminator turns every `resolveColor(data.fill)` into a compile error,
surfacing all consumers.

## Plan

- [x] **Model** — `theme.ts`: `GradientStop`/`GradientFill`/`Fill`/
      `representativeColor`. `element.ts` `fill?: Fill`. Exported from index.
- [x] **Import** — `import/pptx/shape.ts` `parseShapeFill` + `parseGradientFill`:
      `<a:gradFill>` stops + `<a:lin ang>` → radians (default 90° when absent).
      Text-box gradient collapses to representative solid. Tests.
- [x] **Render** — `resolveFillStyle(ctx, fill, theme, w, h)` in
      `render-context.ts` (`createLinearGradient` across bbox at angle). Wired
      `paintFillStroke`, `drawPlaceholderRect`, `shape-special` body + glyph
      collision; `paintFaces` uses `representativeColor`. Unit test w/ fake ctx.
- [x] **PPTX export** — `export/pptx/color.ts` `gradFillXml` + `fillXml`;
      shape writer uses `fillXml`. Export test.
- [x] **Migration** — `wrapColor` already passes a `kind`-tagged object
      through (`'kind' in c`); no change needed.
- [x] **Frontend** — `readShapeFill` → `representativeColor`; import from
      `@wafflebase/slides`.
- [x] **Verify** — `pnpm verify:fast` green (EXIT 0). e2e import of the Naver
      deck: all 3 slide-4 boxes (incl. 멀티모달 추론 모델) now import
      `fill.kind === 'gradient'` with stops `#0093FF → #006AFF`.
- [x] Design doc `docs/design/slides/slides-gradient-fill.md` + README index.

## Verification

- Unit: import (gradFill stops + angle, default-angle), export (`gradFillXml`
  exact XML, `fillXml` dispatch), render (`resolveFillStyle`: solid string,
  gradient axis/stops via fake ctx, single-stop collapse). All green.
- e2e (throwaway, removed): real deck slide 4 → 3 gradient boxes confirmed.
- `pnpm verify:fast` EXIT 0 (frontend lint incl.). slides `dist` rebuilt so
  the frontend consumes the new `representativeColor` export.

## Code review (high effort) — dispositions

- **Single-stop `<a:gradFill>` is schema-invalid on export (correctness)** —
  fixed: `fillXml` degrades a `<2`-stop gradient to `solidFill(representativeColor)`.
- **Degenerate render axis / <2-stop paints flat last-stop (correctness)** —
  fixed: `resolveFillStyle` returns the representative solid when
  `stops.length < 2` OR the axis half-length is 0 (0×0 box). Test added.
- **Import silently drops unparseable stops (correctness)** — accepted with
  graceful degradation: a stop whose color can't resolve (`phClr`) is skipped;
  if `<2` stops remain, render + export both collapse to the representative
  solid (consistent). Documented in `parseGradientFill`.
- **Duplicated `#000000` fallback literal (cleanup)** — fixed: `resolveFillStyle`
  now calls `representativeColor` instead of inlining the literal.
- **`colorChildXml` writes alpha/lumMod/tint/shade as 0..1 not OOXML thousandths
  (correctness)** — PRE-EXISTING bug in the solid-fill exporter (importer
  normalizes to 0..1 at color.ts:130/177/187; exporter echoes raw). Affects
  solid fills equally and predates this feature; the target deck's stops carry
  no alpha/mods. Out of scope — deferred to a separate solid-export unit fix
  (also needs the existing `color.test.ts` thousandths inputs corrected).
- **Frontend value-imports `representativeColor` from `@wafflebase/slides`
  (refuted by verifier)** — intended: it's exported from the package index and
  `dist` is rebuilt; consistent with existing value imports like `resolveColor`.

## Non-goals

Radial/path gradients (first-stop approx), gradient editing UI, gradient on
text-box / table-cell / slide backgrounds, `rotWithShape`/`tileRect`.
