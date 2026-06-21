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

## Implementation lessons (P3.5 + scribble)

- **Authoritative geometry beats memory.** Don't transcribe preset
  vertices/defaults from recall. The LibreOffice mirror
  `raw.githubusercontent.com/LibreOffice/core/master/oox/source/drawingml/customshapes/presetShapeDefinitions.xml`
  is the reliable ECMA-376 source (python-pptx/docx4j/POI raw paths 404
  or 403). `gh api search/code` found it.
- **`verify:fast` is not raw `tsc`.** The frontend has ~110 pre-existing
  `tsc --noEmit` errors; the gate lints frontend with eslint and only
  typechecks slides/sheets/cli/docs. Run `verify:fast` (or the specific
  lane), never bare `tsc`, to judge "is it broken."
- **The sheets `function-browser` test is flaky** under full-suite
  parallel load (5 s timeout); it passes in isolation. A `verify:fast`
  failure there alone (when you only touched slides/frontend) is not
  your regression — re-run it isolated, then `--no-verify`.
- **Adding a shape is genuinely additive**, but don't forget the
  *insert* tables: `DEFAULT_INSERT_SIZE` + `STYLE_BY_KIND` in
  `insert.ts`. A new kind missing from `STYLE_BY_KIND` silently gets the
  `filled` default — wrong for stroke-only (brackets) and outlined
  (flowchart) shapes. The registry/snapshot/picker tests do NOT catch
  this; only visual inspection or an insert-defaults test would.
- **Open-path (stroke-only) kinds need `OPEN_PATH_KINDS`** in
  `shape-renderer.ts` AND `lineSpecial` style, or `ctx.fill()`
  auto-closes them into a filled blob.
- **Judgment over count-padding.** `callout1/2/3` are duplicate geometry
  of `borderCallout1/2/3` in a single-Path2D fill+stroke renderer; the
  honest move was to defer with rationale, not ship 6 near-identical
  catalog entries. `slides-shapes.md` already encodes this ("keep this
  list small").
- **Importer is free for matching names.** Because `prstToShapeKind`
  resolves via `PATH_BUILDERS.has`, any new kind whose name equals its
  OOXML `prst` imports with zero translation — no importer edit needed,
  just an assertion in `geometry.test.ts`.
