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

- [ ] Add `pointsToEmus` to `units.ts`
- [ ] Add VML `<w:pict>`/`<v:imagedata>` branch to `parseParagraph`
- [ ] Failing test: VML image imports with correct src + pt→px dimensions
- [ ] `pnpm --filter @wafflebase/docs test` green
- [ ] `pnpm verify:fast`

## Notes

- Shared importer → fixes both web (`pending-imports.ts`) and CLI.
- VML namespaces: `v = urn:schemas-microsoft-com:vml`.
