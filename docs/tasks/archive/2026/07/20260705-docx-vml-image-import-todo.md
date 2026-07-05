# DOCX VML image import

## Problem

Importing `alice-in-wonderland.docx` drops all 42 images. The parser only
detects modern DrawingML images (`<w:drawing>` → `<wp:inline>` →
`<a:blip r:embed>`). This document embeds every image with **legacy VML**
markup instead:

```xml
<w:pict>
  <v:shape style="width:108pt;height:155.25pt">
    <v:imagedata r:id="rId13" r:href="rId14"/>
  </v:shape>
</w:pict>
```

Because `parseParagraph` has no `<w:pict>` branch, no `imageRef`/placeholder
inline is created and the run yields nothing. The image bytes are still
uploaded by `uploadImages` (keyed by rId) but end up orphaned.

## Fix

Add a VML branch to `parseParagraph` (`docx-parser.ts`) that mirrors the
DrawingML branch:

- Read rId from `<v:imagedata r:id>` (namespaced `id`, not `r:embed`).
- Parse size from the shape's CSS `style="width:..pt;height:..pt"` and
  convert pt → EMU so the existing `convertParagraph` emusToPx path is reused.
- Push `{ rId, cx, cy }` into `imageRefs` and emit the `￼`
  `__pending__:rId` placeholder inline — identical downstream contract.

Add `pointsToEmus` helper to `units.ts` (1pt = 12700 EMU).

## Tasks

- [x] Add `pointsToEmus` to `units.ts`
- [x] Add VML `<w:pict>`/`<v:imagedata>` branch to `parseParagraph`
- [x] Failing test: VML image imports with correct src + pt→px dimensions
- [x] `pnpm --filter @wafflebase/docs test` green
- [x] `pnpm verify:fast`

## Review follow-ups (high-effort code review)

- [x] #1 Only skip run text when an image was emitted (non-image `<w:pict>`
      with sibling text no longer drops the text) — `tryImportVmlImage` returns bool
- [x] #2 Skip floating `position:absolute` VML shapes (match DrawingML inline-only)
- [x] #5 Support `in`/`cm`/`mm`/`px` VML CSS units, not just `pt`
- [x] #6 Extract shared `pushPendingImage` helper (both image branches)
- [x] #7 Add paired `-lessons.md`
- [x] #3/#4 first-imagedata-only + recursive lookup — accepted as known
      limitations (symmetric with DrawingML); see lessons

## Notes

- Shared importer → fixes both web (`pending-imports.ts`) and CLI.
- VML namespaces: `v = urn:schemas-microsoft-com:vml`.
- Verified end-to-end on the real file: **0 → 43 images placed** (43
  `<v:imagedata>` refs, 42 unique media).
