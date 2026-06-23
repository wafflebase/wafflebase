# Lessons — PPTX text-box fill/border import

## Don't trust simplifying comments as invariants

The dropped-fill bug was guarded by a confident comment: "`txBox=1`
shapes have no fill/stroke and exist only as a host for `<p:txBody>`."
That is false for real exports — Google Slides emits labelled callout
boxes as `txBox="1"` with explicit `solidFill` + `ln`. When a branch
discards data based on an assumption, check the assumption against a real
file before trusting it.

## Verify on the real artifact, not just a synthetic test

The synthetic test used `srgbClr` for the fill and passed immediately
after the fix. The real `slide7.xml` uses `schemeClr val="lt1"`, which
takes a different code path (`clrMap` → `SCHEME_TO_ROLE`). Running the
fix against the actual file caught that my test's `clrMap` was malformed
(I mapped the scheme token to a hex string instead of a scheme slot
name). `clrMap` maps an OOXML scheme token → scheme slot name; an empty
map is the identity mapping. Always re-run the fix on the source file
that reproduced the bug.

## Check the whole round-trip before adding fields

Before threading fill/stroke through the importer I confirmed the model
already had `TextElement.data.fill`/`stroke`, the renderer painted them
(`text-renderer.ts:144-152`), and the exporter wrote them
(`textElementToXml`). The gap was import-only, so the fix stayed small
and the round-trip stayed symmetric — no new model fields, no migration.
