# Downscale an oversized image instead of rejecting it

Closes the remaining half of #815. Paste and drop shipped in #842; the two
other bullets of that issue did not:

- an image over the upload limit is rejected outright — the user has to leave
  the app, resize it somewhere else, and come back;
- the rejection reads `File too large (max 10 MB)`, which names the limit but
  not the size of the file the user actually picked, so there is no way to tell
  whether it missed by 200 KB or by 40 MB.

Both live in the shared helper `packages/frontend/src/app/spreadsheet/
image-upload.ts`, so the fix lands for notes, sheets, slides, and board at
once.

## Design decisions

- **Shrink pixels, not quality.** An image over 10 MB is a photo or a
  screenshot at device-pixel density; the longest side is capped at 4096 px
  first, then progressively smaller scale steps are tried until the encode
  lands under the limit. Quality stays fixed at 0.85 so the result is
  predictable rather than mushy.
- **Re-encode to WebP, except JPEG stays JPEG.** WebP keeps the alpha channel a
  PNG source may carry, and is in the backend's MIME allowlist already. JPEG
  sources stay JPEG because re-encoding a photo through a second lossy codec
  buys nothing.
- **An animated image is never downscaled.** A canvas re-encode keeps the first
  frame only, so a downscaled animation is a silently broken image. The MIME
  type does not answer "is this animated" — `image/webp` is as often a sticker
  as a photo, and `image/png` covers APNG — so the container is sniffed: the
  `VP8X` ANIM flag for WebP, an `acTL` chunk before the first `IDAT` for APNG,
  GIF assumed animated without reading. An unreadable file counts as animated,
  because refusing to shrink is recoverable and flattening is not.
- **Downscaling never throws.** `downscaleImageFile` returns the original file
  when decode or encode fails, and `uploadImageFile` — which owns the limit —
  re-checks the size and produces the error. One place decides "too large".
- **The codec is injectable.** jsdom has neither `createImageBitmap` nor a real
  2D context, so the browser decode/encode pair sits behind an `ImageCodec`
  parameter that tests substitute. Production callers never pass it.

## Tasks

- [x] `packages/frontend/src/app/spreadsheet/image-downscale.ts` — codec seam,
      dimension cap + scale steps, best-attempt tracking, animation opt-out
- [x] `packages/frontend/src/app/spreadsheet/image-upload.ts` — downscale before
      the size check; size error naming the limit, the original size, and the
      post-downscale size
- [x] `image-downscale.test.ts` — under-limit passthrough, animated
      GIF/WebP/APNG passthrough vs still WebP/PNG shrink, scale-step
      escalation, decode/encode failure passthrough, never-bigger-than-source,
      alpha-safe output type, filename extension follows the encoded type
- [x] `image-upload.test.ts` — oversized file uploads its downscaled bytes;
      both error message shapes; unsupported type still rejected first
- [x] `docs/design/notes/notes.md` — document the client-side downscale (the
      image-upload pipeline is described there, not in `image-viewer.md`,
      which covers the `image` *document type*)
- [x] `pnpm verify:fast` green
- [x] Self review over the branch diff — 1 finding, fixed (see Review)
- Not verified: manual smoke in `pnpm dev` (paste a >10 MB screenshot into a
  note). Code and unit tests are green; no human run was performed.

## Out of scope

- **Backend changes.** The 10 MB cap and the MIME allowlist stay as they are;
  this only changes what the client sends.
- **The docs editor's separate upload path.** `packages/frontend/src/app/docs/
  image-insert.ts` uploads through `docxImageUploader`, not this helper, and
  has no client-side size check at all — an oversized image there fails at the
  backend. Folding it into the shared helper is a wider refactor than #815.
- **Downscaling images that are already under the limit.** Storage economy is a
  separate concern from "the upload was refused".

## Review

### What the self-review caught

- **An animated WebP would have been flattened.** The first cut opted GIF out
  of the re-encode by MIME type, but `image/webp` is in the upload allowlist
  and is just as often an animated sticker — an oversized one would have
  uploaded successfully as a still first frame, with no error and nothing to
  recover from. The same held for APNG under `image/png`. MIME type cannot
  answer the question, so the container is sniffed instead (`VP8X` ANIM flag /
  `acTL` before `IDAT`), which also keeps *still* WebP and PNG downscalable
  rather than opting out two whole types to be safe.

### PR review (CodeRabbit, PR #856)

Two findings, both real, both fixed:

- **APNG detection scanned raw bytes.** Searching the first 64 KB for the
  letters `acTL` reads a still PNG whose `iTXt` metadata mentions them as an
  animation (harmless — it just refuses a downscale), but worse, it misses an
  `acTL` pushed past the window by a fat `iCCP` colour profile and flattens a
  real animation. The chain is now walked by its chunk length prefixes, and an
  answer that runs off the end of the window counts as animated rather than
  still.
- **A file a hair over the cap reported as the cap.** `formatBytes` rounded to
  the nearest tenth, so 10 MB + 1 byte read "Image is 10 MB, over the 10 MB
  limit". Sizes now round up.

### Test honesty

Every test was mutation-checked — the behavior it protects was broken in the
source and the test confirmed to fail. Eleven mutations, all caught: GIF opt-out
removed, dimension cap removed, best-attempt tracking removed, encoder-type
fallback ignored, WebP ANIM flag ignored, APNG `acTL` ignored, unreadable file
treated as still, all WebP opted out, chunk walk replaced by a byte scan,
undetermined chain treated as still, size rounded instead of ceilinged. One
test *did* start out vacuous — the
best-attempt tracking survived its mutation until a case was added where every
encode overshoots the source.

### Known limitations

- **The docs editor still rejects oversized images at the backend.** It uploads
  through `docxImageUploader`, not this helper (see Out of scope).
- **No progress feedback for a slow re-encode.** A 40 MB photo takes a beat to
  decode and encode on a phone; the notes ghost widget covers the upload but
  the encode happens before it appears.
- **`MAX_DIMENSION` is a fixed 4096 px.** Enough to stay inside old iOS Safari
  canvas-area limits, but a very wide panorama still loses more than it needs
  to.
