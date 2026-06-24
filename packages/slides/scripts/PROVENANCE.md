# Vendored reference data

## `presetShapeDefinitions.xml`

The ECMA-376 (ISO/IEC 29500) DrawingML **preset shape geometry** table — the
canonical definitions of every built-in autoshape's path and text `<rect>`.

- **Source:** the copy vendored by [docx4j](https://github.com/plutext/docx4j)
  (`org/docx4j/model/shapes/presetShapeDefinitions.xml`), itself derived from
  the ECMA-376 specification's `presetShapeDefinitions.xml`.
- **Used by:** `gen-shape-text-rects.mjs`, which evaluates each preset's
  `<rect>` guide formulas to generate
  `src/view/canvas/shapes/shape-text-rects.generated.ts`.
- **Do not hand-edit.** It is upstream reference data; regenerate the table with
  `pnpm slides gen:textrects` if this file is updated.

Known upstream quirks the generator absorbs: CRLF line endings; `upDownArrow`
defined twice; `pie`'s text rect collapses to zero width at the default
adjustment; `leftArrow`'s `gdLst` references an undefined guide (`dy`).
