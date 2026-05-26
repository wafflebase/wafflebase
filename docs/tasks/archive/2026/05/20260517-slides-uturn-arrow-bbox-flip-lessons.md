---
title: Slides — uturnArrow bbox clamp + flipH/flipV lessons
date: 2026-05-17
owner: hackerwins
---

# Lessons — slides uturnArrow bbox clamp + flipH/flipV

## What surprised us

- The original `buildUturnArrow` had been live since Phase 5b's shape
  library and passed every shape test, but every shape test used a
  square `w=h=200` fixture. The width-vs-height assumption only
  exploded on landscape PPTX imports — easily a year of latent damage
  that any one realistic deck would surface immediately.
- `parseXfrm` ignored `<a:xfrm flipH/flipV>` for plain `<p:sp>` shapes,
  only handling them on `<p:cxnSp>` connectors. The asymmetry was
  there from the original slides MVP and survived several rounds of
  PPTX-import work, again because the in-tree test fixtures never
  exercised it.
- `polylineArc` excludes its start angle and includes its end angle.
  Rewriting the U-turn as two quarter arcs joined by an explicit
  `lineTo` introduces a zero-length segment at the join — geometrically
  invisible but it shifts the path-op snapshot and surfaced in the
  registry test diff. Worth knowing the next time we split an arc.

## Recurring mistakes to avoid

- **Shape path-builders quietly assume portrait orientation.** Any new
  builder that derives a radius from one axis (`w` or `h`) must clamp
  to the other, or assert the aspect ratio invariant. Add a landscape
  test (`w = 10 × h`) to the per-shape suite before signing off.
  **Why:** the v0 uturn case painted 6× outside the bbox before the
  180° rotation flipped it across the slide.
  **How to apply:** when a path-builder includes a `Math.min(w, h)` or
  derives a radius from arm separation, mentally substitute extreme
  aspect ratios and write a regression for the worst case before
  shipping.
- **OOXML preset adjustments are positional and contiguous.** PPTX
  decks list `<a:gd name="adjN">` in order — our parser reads them by
  index, not by `name`. When we model only the first 2 of an OOXML
  preset's 5 adjustments, drop them silently (no warning) and the
  visual fidelity degrades imperceptibly.
  **Why:** the user's slide 6 carries `adj4=0, adj5=100000`; we still
  ignore those. The fix lands the shape inside its bbox but the
  arrowhead width is still off compared to PowerPoint.
  **How to apply:** when a preset has more `<gd>` entries than our
  spec models, log a `report.unknownPresetAdjustments` row in the
  importer so future regressions are visible at audit time.

## Decisions worth remembering

- **`Frame.flipH` / `flipV` are optional fields, not required.**
  Keeping them optional means absent ⇒ false, which preserves the
  existing JSON shape for every Yorkie document already in flight.
  No migration is needed; reads from old state continue to work.
  **Why:** schema migrations on an in-use collaborative store are
  expensive; favour additive optionals when the absence value is
  meaningful.
  **How to apply:** new `Frame`-level fields should land as optional
  with a documented absence-default, and the import path should omit
  them when false to keep snapshots byte-stable.
- **`adj3` default is 50000, not OOXML's 25000.** The clamp picks
  `(outerRightX − outerLeftX) / 2` for square / portrait shapes at
  this default, so the two outer corners share a centre and the path
  traces a single semicircle — visually identical to the v0
  appearance. PPTX imports always carry their own `adj3` (25000 in
  most decks), so OOXML fidelity is unaffected.
  **Why:** existing editor-inserted `uturnArrow` shapes saved without
  an explicit `adj3` would otherwise render with a flat-top-with-
  corners look on reload, a silent visual regression for stored
  documents.
  **How to apply:** when introducing a new adjustment into an
  existing preset, pick a default that maps to the previous
  appearance for legacy serialized state, even if OOXML would
  prefer a smaller value.

## Open follow-ups

- Model OOXML `adj4` (arm-segment-before-bend length) and `adj5`
  (arrowhead width) for `uturnArrow`.
- Add a drag handle for the `Bend radius` adjustment.
- Audit other arrow builders (`bentArrow`, `bentUpArrow`,
  `swooshArrow`, `circularArrow`, the four `curved*Arrow`s) for the
  same width-vs-height assumption.
- Use `name` attribute on `<a:gd>` to disambiguate adjustments when
  PPTX lists them out of declaration order.
