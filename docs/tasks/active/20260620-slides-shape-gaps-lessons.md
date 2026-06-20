# Lessons — Slides Shape Gaps Review

- The `slides-shapes.md` design doc tracks an *intended* count (128
  closed-path builders); always cross-check against the live `ShapeKind`
  union in `packages/slides/src/model/element.ts` before quoting numbers —
  the union also carries import-only kinds (`freeform`) that are not
  user-drawable.
- Lines/arrows moved out of `ShapeKind` into a dedicated `ConnectorElement`
  (`model/connector.ts`) with `straight | elbow | curved` routing. Don't
  count them as shape-picker entries.
- Adding a closed-path shape is genuinely additive: one builder file +
  `PATH_BUILDERS.set()` + a `SHAPE_PICKER_CATEGORIES` entry. No Yorkie
  schema migration because `data.adjustments` is optional with per-builder
  defaults.
- Google Slides has **no Flowchart category**; flowchart shapes are a
  PowerPoint-only parity concern and should be prioritized accordingly.
