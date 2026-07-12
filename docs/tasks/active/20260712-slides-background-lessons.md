# Slides Background — Lessons

Task: expand the slides right-side "Background Color" control into a full
"Background" (Color / Image / Gradient), per
`docs/design/slides/slides-background.md` and the paired todo file.

Capture lessons here as implementation proceeds (surprises, review
feedback patterns, gotchas). Known gotchas identified during planning:

- `resolveColor` (solid-only) vs `resolveFillStyle` (Fill-aware) — the
  background path deliberately used the solid sibling; the whole task is
  swapping each solid-only helper for its `Fill`-aware sibling.
- `backgroundToXml` (`export/pptx/slide.ts:85`) declares a local
  `const fillXml = solidFillXml(...)` that shadows the importable
  `fillXml`; rename the local when wiring gradient export.
- `parseGradientFill` (`import/pptx/shape.ts:940`) is not exported yet.
- Pass the LOGICAL slide size (`SLIDE_WIDTH × slideH`), not the
  DPR-scaled bitmap, to `resolveFillStyle` so the gradient axis maps to
  the slide.
