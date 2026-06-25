# Callout OOXML geometry fidelity

Make the 14 slides callout `ShapeKind`s render faithfully against
ECMA-376 `presetShapeDefinitions.xml` (verified via the ONLYOFFICE
`core` C++ preset encodings). The callouts previously used freehand
approximations that read "awkward" versus PowerPoint / Google Slides.

## Background

Investigation against the authoritative OOXML presets found three
classes of divergence: thin-needle wedge tails (vs fixed quarter-side
wide wedges), border callouts drawn as box+filled-wedge with the wrong
adjustment count (vs full box + `fill="none"` leader, 4/6/8 adj), and
arrow head depth measured against `w`/`h` instead of `ss = min(w,h)`.
See `docs/design/slides/slides-shapes.md` → *Callout geometry fidelity*.

## Checklist

- [x] `callouts/ooxml-math.ts` — OOXML guide operators (`pin`, `ifPos`,
      `cat2`, `sat2`, `mod3`, `at2`, `arcTo`, angle constants).
- [x] `LEADER_BUILDERS` map + renderer stroke pass for border leaders.
- [x] Wedge callouts (rect / roundRect / ellipse) — fixed wide wedge,
      diagonal-slope edge selection; shared `wedge-common.ts`.
- [x] Border callouts (1/2/3) — full-frame box + N-point leader,
      re-aligned to the OOXML 4/6/8 `(y,x)` adjustment schema with
      per-pair drag handles; shared `border-common.ts`.
- [x] Arrow callouts — head depth → `ss` basis for
      right/left/up/down/leftRight/upDown (builders + handles); quad
      rewritten with rectangular body + full pin chain.
- [x] Cloud callout — bubble radii + tip-anchored centres.
- [x] Per-builder `isPointInPath` unit tests updated to the new geometry;
      shape-registry Path2D snapshot regenerated.
- [x] `docs/design/slides/slides-shapes.md` callout-fidelity subsection.
**Deferred (not done — optional polish):** authored-adjustment visual
scenario for one wedge + one border + one arrow. The catalog scenario
already renders all 14 callouts at defaults on every theme; the snapshot
test covers geometry precisely, so this is optional regression polish,
deferred to avoid scenario-id lockstep churn. Pick up under the
`ooxml-shape-parity` umbrella if/when prioritized.

## Verification

- `pnpm verify:fast` green on each family commit.
- Per-builder unit tests + registry snapshot updated and green.
- PPTX `<a:avLst>` values round-trip unchanged through the generic
  `import/pptx/shape.ts:parseAdjustments` (no callout-specific casing);
  border callouts now surface the correct 4/6/8 values.

## Review

Landed as four `verify:fast`-green commits on `callout-ooxml-fidelity`:
wedge port, border box+leader port, arrow head-depth fix, cloud bubbles
+ docs. All 14 callouts now transcribe their preset `gdLst`/`pathLst`.
