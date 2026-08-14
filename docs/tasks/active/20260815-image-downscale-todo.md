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
- **GIFs are never downscaled.** A canvas re-encode keeps the first frame only,
  so a downscaled animation is a silently broken image. An oversized GIF is
  rejected with the size message instead.
- **Downscaling never throws.** `downscaleImageFile` returns the original file
  when decode or encode fails, and `uploadImageFile` — which owns the limit —
  re-checks the size and produces the error. One place decides "too large".
- **The codec is injectable.** jsdom has neither `createImageBitmap` nor a real
  2D context, so the browser decode/encode pair sits behind an `ImageCodec`
  parameter that tests substitute. Production callers never pass it.

## Tasks

- [ ] `packages/frontend/src/app/spreadsheet/image-downscale.ts` — codec seam,
      dimension cap + scale steps, best-attempt tracking, GIF opt-out
- [ ] `packages/frontend/src/app/spreadsheet/image-upload.ts` — downscale before
      the size check; size error naming the limit, the original size, and the
      post-downscale size
- [ ] `image-downscale.test.ts` — under-limit passthrough, GIF passthrough,
      scale-step escalation, decode/encode failure passthrough, alpha-safe
      output type, filename extension follows the encoded type
- [ ] `image-upload.test.ts` — oversized file uploads its downscaled bytes;
      error message shape; unsupported type still rejected first
- [ ] `docs/design/image-viewer.md` — document the client-side downscale
- [ ] `pnpm verify:fast` green
- [ ] Self review over the branch diff
- [ ] Manual smoke in `pnpm dev` (paste a >10 MB screenshot into a note)

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

_(filled in after the self-review)_
