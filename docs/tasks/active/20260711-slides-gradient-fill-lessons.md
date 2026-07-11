# Lessons — Slides gradient fill

## What worked

- **Let the compiler find the consumers.** Widening `ShapeElement.data.fill`
  from `ThemeColor` to a discriminated `Fill = ThemeColor | GradientFill`
  turned every `resolveColor(data.fill)` into a type error, so no fill site
  was silently missed. Pairing that with an upfront Explore-agent consumer map
  (render, export, PDF, frontend picker, migration, format-paint) meant zero
  surprises.
- **Mirror the existing precedent.** Import/render/export all had a solid-fill
  path already; gradient slotted in as a parallel branch (`parseGradientFill`,
  `resolveFillStyle`, `gradFillXml`/`fillXml`) rather than a new subsystem.
- **PDF export was free** — it rasterizes `drawSlide()`, so fixing the canvas
  renderer fixed PDF with no extra code. Confirm the raster-reuse before
  assuming a separate PDF path exists.

## Gotchas

- **Frontend TS isn't CI-gated** ([[project_frontend_ts_not_gated]]): the
  `data.fill` widening didn't error the frontend build. Had to fix
  `readShapeFill` (coerce gradient → `representativeColor`) by construction and
  rebuild slides `dist` so the frontend saw the new export.
- **Degenerate gradients need consistent handling in three places.** A `<2`-stop
  or zero-axis gradient must degrade to the representative solid in the renderer
  AND the exporter (a lone `<a:gs>` is schema-invalid — PowerPoint rejects the
  file). Keep the collapse rule identical across render/export or they diverge.
- **Radial ≠ linear.** A radial (`<a:path>`) gradient painted along a linear
  axis looks wrong; collapse it to its first stop (→ solid) instead. Keep the
  code and every doc (design, README, task) saying the *same* fallback — an
  earlier draft said "linear approx" in one doc and "first-stop" in another,
  which the PR review caught.
- **Commit subject ≤70 chars** is a hard `commit-msg` hook; a 71-char subject
  bounced the commit even though `verify:fast` had already passed.
