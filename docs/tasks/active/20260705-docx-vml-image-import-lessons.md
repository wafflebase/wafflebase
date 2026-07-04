# DOCX VML image import — lessons

## What broke

`alice-in-wonderland.docx` imported with **zero** of its 42 images. The DOCX
parser only recognized modern DrawingML images (`<w:drawing>` → `<wp:inline>`
→ `<a:blip r:embed>`). This document — like many older Word / Google-Docs
exports — embeds every image with **legacy VML** instead:

```xml
<w:pict><v:shape style="width:108pt;height:155.25pt">
  <v:imagedata r:id="rId13"/>
</v:shape></w:pict>
```

## Diagnosis notes

- `grep -o '<w:drawing>' document.xml | wc -l` → 0, vs `<w:pict>` → 44. The
  fastest signal for "which image encoding does this file use" is counting
  the two element families directly in the unzipped `word/document.xml`.
- The image **bytes were already uploaded** — `uploadImages` walks every
  `image`-typed relationship keyed by rId regardless of how the document
  references it. The bug was purely on the *placement* side (parser), so the
  media was uploaded-but-orphaned. Splitting "upload" from "reference" this
  way meant the fix touched only the parser.

## VML vs DrawingML gotchas

- rId lives in `<v:imagedata r:id>` (namespaced `id`), **not** `r:embed`.
- Size comes from the shape's CSS `style` in **points** (`72pt`), not a
  `<wp:extent cx/cy>` EMU pair. Convert pt→EMU (1pt = 12700 EMU) so the
  existing `emusToPx` resolution path is reused unchanged. VML lengths can
  also be `in`/`cm`/`mm`/`px`; handle them or the image falls back to its
  (possibly huge) natural size.

## Review findings that mattered

- **Early `continue` = data loss.** The first cut did `if (pict) { …; continue }`
  unconditionally. A `<w:pict>` is not always an image (VML rule, watermark,
  textbox) and can share a run with `<w:t>` text — the blanket continue
  swallowed that text. Fix: only skip the run's text when an inline image was
  *actually emitted* (helper returns a boolean).
- **Match the sibling path's gating.** DrawingML imports only `<wp:inline>`
  and ignores floating `<wp:anchor>`. The VML branch must likewise skip
  `position:absolute` shapes, or watermarks land as giant inline images.
- **Deduplicate the placeholder contract.** Both branches emit the same
  `￼` + `__pending__:<rId>` inline; a shared `pushPendingImage` keeps the
  two image paths from silently desyncing.

## Known limitations (accepted, symmetric with DrawingML)

- Only the first `<v:imagedata>` per run is read (DrawingML also reads only
  the first drawing/blip). Multi-image single runs are rare in real exports.
- `getElementsByTagNameNS` is recursive, so an image nested in a VML textbox
  would be matched against the outer run. We don't handle VML textboxes at
  all, so this is out of scope.
