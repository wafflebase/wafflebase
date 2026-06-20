# Slides: import & render custom-geometry (freeform) shapes

> **Status (2026-06-18): DONE.** All plan items implemented + tested.
> `pnpm verify:fast` green. End-to-end re-import of the user's deck now
> yields 15 freeform shapes on slide 1 (0 on `main`). See the matching
> `*-lessons.md`.

## Problem

PPTX `<a:custGeom>` freeform shapes are silently dropped on import.
`parseSp` (`packages/slides/src/import/pptx/shape.ts`) dispatches only on
`txBox` → `blipFill` → `prstGeom` → `txBody`, else `return []`. A custom
freeform with a solid/scheme fill and no image and no text matches no branch
and vanishes.

Repro: the user's deck
(`베이지 화이트 알록달록 … 프레젠테이션.pptx`) slide 1, bottom-right
Group 5 → Freeform 7 (`custGeom` + `solidFill #4B6BF5`, no text) is dropped,
so its background does not render. Slide 1 alone drops 15 custGeom freeforms;
only the 2 with a `blipFill` (treated as images) survive.

Root cause is twofold:
1. The model/renderer has **no** freeform (path) shape type.
2. The importer has **no** `custGeom` branch.

## Goal

Import custGeom freeforms as a new `freeform` ShapeKind that stores a
normalized vector path, and render it (fill + stroke) in the canvas
renderer. Import-only for v1 (no picker / drag-handle editing UX, matching
how blip-clip-path loss is already accepted for v1).

## Plan

### Model — `packages/slides/src/model/element.ts`
- [x] Add `'freeform'` to the `ShapeKind` union.
- [x] Add `FreeformPath` / `FreeformCommand` types (commands normalized to
      `[0,1]` of the path viewBox: `M`/`L`/`Q`/`C`/`A`/`Z`).
- [x] Add optional `path?: FreeformPath` to `ShapeElement['data']`.

### Path builder — `packages/slides/src/view/canvas/shapes/freeform.ts` (new)
- [x] `buildFreeformPath(size, path): Path2D` — scale normalized commands to
      frame px. Exported for tests + future PDF reuse.

### Renderer — `packages/slides/src/view/canvas/shape-renderer.ts`
- [x] Special-case `data.kind === 'freeform'` in `drawShape` (before the
      `PATH_BUILDERS` lookup, like action buttons): build path from
      `data.path`, fill (nonzero) + stroke with the shared logic. Missing
      `data.path` → placeholder rect fallback.

### Parser — `packages/slides/src/import/pptx/freeform.ts` (new)
- [x] `parseCustGeomPath(custGeom): FreeformPath | undefined` — read
      `<a:pathLst>/<a:path w h>`, normalize each `<a:pt>` by that path's
      `w`/`h`, map `moveTo`/`lnTo`/`quadBezTo`/`cubicBezTo`/`arcTo`/`close`.
      Concatenate multiple `<a:path>` elements.

### Dispatch — `packages/slides/src/import/pptx/shape.ts`
- [x] Add a `custGeom` branch after `prstGeom`: build a `freeform`
      ShapeElement (reuse `parseShapeFill` / `parseShapeStroke`), fold in
      `txBody` text + `placeholderRef` exactly like the prstGeom branch.

### Tests (TDD — write failing first)
- [x] `test/import/pptx/freeform.test.ts` — parse a custGeom path → normalized
      commands; dispatch keeps a solid-fill freeform (no longer dropped).
- [x] renderer test — `drawShape` on a freeform issues fill/stroke (extend
      existing shape-renderer test harness).

### Verify
- [x] `pnpm verify:fast`
- [x] Re-run the dispatch simulation against the user's slide 1: 0 dropped.
- [x] Manual smoke in `pnpm dev` if practical.

## Non-Goals (v1)
- Freeform drawing UI / shape picker entry / drag-handle editing.
- arcTo exactness beyond elliptical-arc approximation.
- PDF export (slides PDF export is not yet in source).
- Path fill-rule attrs (`<a:path fill="...">`), gradient/pattern fills.

## Review

Shipped as #373 (`accaa2f4`), executing the plan as scoped:

- **Model** — added `'freeform'` to the `ShapeKind` union plus
  `FreeformPath` / `FreeformCommand` types (commands normalized to
  `[0,1]` of the path viewBox) and `path?: FreeformPath` on
  `ShapeElement['data']` (`model/element.ts`).
- **Path builder** — new `view/canvas/shapes/freeform.ts` with
  `buildFreeformPath(size, path)` scaling normalized commands to frame
  px, exported for tests + future PDF reuse.
- **Renderer** — `shape-renderer.ts` special-cases `kind === 'freeform'`
  before the `PATH_BUILDERS` lookup, fill (nonzero) + stroke via the
  shared logic, placeholder-rect fallback when `data.path` is missing.
- **Parser + dispatch** — new `import/pptx/freeform.ts`
  (`parseCustGeomPath`) reads `<a:pathLst>/<a:path>` and normalizes
  every `<a:pt>`; `import/pptx/shape.ts` gained a `custGeom` branch
  after `prstGeom` that folds in fill/stroke/txBody/placeholderRef.
- **Tests** — `test/import/pptx/freeform.test.ts` (parse + dispatch no
  longer drops a solid-fill freeform) and a `shape-renderer.test.ts`
  case asserting fill/stroke issuance.

Custom-geometry shapes that PPTX import previously dropped now round-trip
and render. `pnpm verify:fast` green. Import-only for v1 per Non-Goals
(no drawing/editing UI, no PDF export path yet).
