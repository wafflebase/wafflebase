---
title: Slides — uturnArrow bbox clamp + flipH/flipV import & render
target-version: 0.2.x
date: 2026-05-17
owner: hackerwins
---

# Slides — uturnArrow bbox clamp + flipH/flipV import & render

**Single PR.** Fix the bug where landscape-aspect `uturnArrow` shapes
imported from PPTX paint outside their bounding box (path extends far
above the shape, looking like a "connector to the top"), and add the
missing `flipH`/`flipV` support that the same case relies on for
correct arrowhead orientation.

**Origin:** Slide 6 of `Yorkie, 캐즘 뛰어넘기.pptx`
(`https://wafflebase.io/shared/5df3643d-9ad8-458c-9e96-33b07def0d57`).
Two bottom-row `uturnArrow` shapes (`w/h ≈ 13.7 : 1`,
`flipH=1 rot=180°`) paint U-arms that reach the upper third of the
slide instead of fitting inside their `406200 EMU` bbox.

## Root causes (recap)

1. **`buildUturnArrow` derives `outerR` from width, not height**
   (`packages/slides/src/view/canvas/shapes/arrows/uturn-arrow.ts:38-40`).
   When `w > h`, `outerR ≈ w/2` and `turnCy = outerR ≫ h`, so the
   arms trace from `y=h` *down* to `y=outerR`, then the arc reaches
   `y=0`. Path range becomes `[0, outerR]` instead of `[0, h]`.
   The renderer applies no clip, so the path paints wherever it lands;
   the 180° frame rotation then reflects the overhang above the bbox.
2. **`parseXfrm` drops `flipH`/`flipV`**
   (`packages/slides/src/import/pptx/geometry.ts:56-72`). Only
   `parseCxnSp` reads them today, and `Frame` itself has no flip
   field. So `flipH=1 + rot=180°` (= `flipV`) loses the `flipH` half.

The OOXML 5-adjustment exact-match (`adj3..adj5`) for `uturnArrow` is
out of scope for this PR — tracked separately.

## Scope (single PR)

### Geometry fix

- [x] `buildUturnArrow`: replace the single half-ellipse top with the
      OOXML flat-top + corner-radius geometry. Three adjustments:
      `adj1` (shaft thickness), `adj2` (head length), and the new
      `adj3` (corner radius). Path is guaranteed to stay inside
      `(w, h)` for any aspect ratio via three clamps on the outer
      bend radius. When the requested radius forces both corners to
      share a centre, the path degenerates to a single semicircle
      (legacy v0 appearance) so square/portrait shapes stay close to
      what they used to render.
- [x] Verify the existing 200×200 path still fillable (regression).
- [x] Regenerate the shape-registry snapshot (intentional geometry
      change).
- [ ] Optional follow-up: also model OOXML `adj4` (arm-segment-before-
      bend length) and `adj5` (arrowhead width).

### Frame model

- [ ] Extend `Frame` with optional `flipH?: boolean; flipV?: boolean`
      in `packages/slides/src/model/element.ts`. Optional so existing
      serialized state is forward-compatible (absent ⇒ `false`).
- [ ] Audit constructors/updaters of `Frame` for places that copy the
      shape with `{ ...frame, ... }` — none should need changes
      (additive optional field).

### PPTX import

- [ ] `parseXfrm`: read `flipH` / `flipV` attributes and surface them
      on the returned `Frame`. Omit the fields when both are false to
      keep the existing JSON shape stable.
- [ ] `parseCxnSp`: keep its current local flipH/flipV reads
      (connector endpoint resolution); also propagate them onto
      `frame` for consistency.

### Renderer

- [ ] `element-renderer.ts`: after `ctx.rotate(frame.rotation)`,
      apply `ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)` and a
      compensating translate so the flip happens around the frame
      centre (same anchor as rotation). Connector path stays
      unchanged (connectors paint in world coords already).
- [ ] Confirm hit-test / selection box math doesn't regress — flip
      is purely a paint-time mirror; the frame rect is unchanged.

### Tests

- [ ] Unit (uturn-arrow): `buildUturnArrow({ w: 1173, h: 85 })` —
      sample path against a 2D canvas and assert no path point lies
      outside `y ∈ [0, h]` (and that the U is still a fillable
      closed shape). Add a second case at `w=600, h=200`.
- [ ] Import: `parseXfrm` with `flipH="1"` sets `frame.flipH=true`;
      with neither flag, neither field is set.
- [ ] Renderer: snapshot or op-trace test that flipH applies a
      `scale(-1, 1)` around the frame centre.
- [ ] PPTX fixture: add a small fixture mirroring slide 6's
      `uturnArrow` (landscape + flipH + rot180) and assert the
      element-renderer output stays within the slide bounds.

### Manual verification

- [ ] Local: import `Yorkie, 캐즘 뛰어넘기.pptx`, open slide 6 in
      `pnpm dev`. Confirm both bottom-row uturn arrows render inside
      the lower band (no stray paint reaching the upper portion of
      the slide). Confirm arrowhead orientation matches the PPTX
      (visual diff vs. PowerPoint screenshot of the same slide).

## Out of scope (follow-ups)

- Remaining OOXML `uturnArrow` adjustments: `adj4` (arm-segment-before-
  bend length) and `adj5` (arrowhead width). The user's slide carries
  these (`adj4=0`, `adj5=100000`) but our painter still uses the v0
  defaults — visible as a slightly narrower arrowhead than PowerPoint.
- A drag handle for the new `Bend radius` adjustment (UI affordance).
- Generalising the bbox-clamp pattern to other arrow builders
  (`bentArrow`, `bentUpArrow`, …) — audit separately if needed.

## Risks

- Adding `flipH`/`flipV` to `Frame` changes any code path that pattern-
  matches on the exact `Frame` shape. Mitigation: keep fields
  optional, omit when false, run `pnpm verify:fast` and
  `pnpm verify:self` before pushing.
- Hit-test and adjustment-handle positioning rely on the path
  geometry; verify the uturn-arrow handle test still passes with the
  clamped `outerR`.

## Verification checklist

- [ ] `pnpm verify:fast` green.
- [ ] `pnpm verify:self` green.
- [ ] Manual browser smoke on slide 6.
- [ ] Self code-review (`superpowers:requesting-code-review` or
      `/code-review`) over the branch diff.

## Branch & PR

- Branch: `fix/slides-uturn-arrow-bbox-flip`
- PR title (≤70 chars): `Clamp uturnArrow path to bbox + flipH/flipV import`
- PR body: Summary (3 bullets covering geometry / flip / tests) +
  Test plan checklist (unit + manual on slide 6).
