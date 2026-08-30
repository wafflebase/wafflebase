# Shared-link images: finish the token-append for notes and sheets

## Problem

Images embedded in a **note** or a **sheet** do not render for an anonymous
share-link viewer. Reproduced on production against
`https://wafflebase.io/shared/304aa751-b0d9-46d7-838b-efa7f2d206ee` (a `note`):
all 8 `<img>` elements report `naturalWidth: 0`, and none of their `src` values
carry a `?token=`.

Fetching one of those URLs directly:

```
no token             → 403 {"message":"Not allowed to read this image"}
?token=<share token> → 200 image/png 265,303 bytes
```

So the backend is already correct. PR #955 ("Serve workspace images to
anonymous share-link viewers") split the read route into
`ApiV1ImageReadController` behind `OptionalCombinedAuthGuard`, which accepts a
share token — and it wired the *frontend* token-append for the slides engine
only. Its own commit message names this gap:

> sheets/notes share the route and are covered by the backend fix but their
> frontend token-append is a deferred follow-up.

## Root cause

`useSharedImageTokenResolver` (`packages/frontend/src/app/shared/shared-document.tsx`)
gates on `type === "slides" || type === "board"`. Its doc comment justifies
excluding `note` with "pdf/image/file/note don't paint through this engine" —
true but not sufficient: a note does not use the slides canvas, yet its
markdown preview paints workspace images through a plain `<img>`
(`packages/notes/src/view/preview.ts`, `md.renderer.rules.image`). Sheets has
the same shape via `packages/frontend/src/app/spreadsheet/image-object-layer.tsx`
(`getOrLoadImage(image.src)` plus an `<img src={image.src}>`).

The stored `src` lives in the CRDT and is shared across every viewer, so the
token cannot be baked in at upload time; it must be applied per-viewer at
render time. That is exactly the seam #955 built for slides.

`doc` is genuinely unaffected: it uploads through the unauthenticated legacy
`/images` route (`packages/frontend/src/app/docs/image-insert.ts`), which has
no workspace scope to gate.

## Plan

- [x] Reproduce and confirm the 403/200 split with and without the token
- [x] Confirm `doc` is out of scope (legacy route)
- [x] **notes** — add a module-level `setImageUrlResolver` seam mirroring
      `packages/slides/src/view/canvas/image-cache.ts`, applied in
      `md.renderer.rules.image`; export it from `@wafflebase/notes`
- [x] **sheets** — add the same seam to
      `packages/frontend/src/app/spreadsheet/image-cache.ts` and apply it at
      both use sites in `image-object-layer.tsx` (the cache key *and* the
      rendered `<img src>`, which must agree)
- [x] **shared mount** — widen `useSharedImageTokenResolver` to install all
      three resolvers by document type; reuse `appendShareTokenToImageUrl`
      unchanged (it already carries the origin check that keeps the token from
      leaking to a CRDT-supplied foreign host)
- [x] Failing tests first, per package
- [x] `pnpm verify:fast`
- [x] Self review over the branch diff
- [x] End-to-end check against the reported share link
- [ ] PR

## Review

### What changed

| File | Change |
| ---- | ------ |
| `packages/notes/src/view/preview.ts` | Module-level `setImageUrlResolver`; `md.renderer.rules.image` routes `src` through it |
| `packages/notes/src/index.ts` | Export the seam |
| `packages/frontend/src/app/spreadsheet/image-cache.ts` | Same seam + `resolveImageSrc`; `getOrLoadImage` now keys the cache by the **resolved** URL |
| `packages/frontend/src/app/spreadsheet/image-object-layer.tsx` | Render `resolveImageSrc(image.src)` so the `<img>` and the cache name one URL |
| `packages/frontend/src/app/shared/shared-document.tsx` | `useSharedImageTokenResolver` dispatches through a type → installer `Map` covering slides/board, note, sheet |

`appendShareTokenToImageUrl` is untouched — the origin check that stops a
CRDT-supplied foreign `src` from receiving the viewer's token is reused as-is.

### Verification

`pnpm verify:fast` green. New tests: 7 in
`packages/notes/src/view/preview-image-resolver.test.ts`, 6 in
`packages/frontend/src/app/spreadsheet/image-cache.test.ts`.

End-to-end against the reported link, with a local production build
(`VITE_BACKEND_API_URL=https://api.wafflebase.io`) driving the real backend:

| | images | loaded | `?token=` present |
| --- | --- | --- | --- |
| deployed `wafflebase.io` (before) | 8 | 0 | no |
| local build (after) | 8 | **8** | yes, on all |

Direct fetch of one of those image URLs: `403` without a token, `200 image/png`
(265,303 bytes) with it — confirming the backend half from #955 was already
correct and only the frontend append was missing.

### Known limitations

- The sheets half is covered by unit tests and by code inspection of the two
  call sites, not by an end-to-end run: no shared sheet containing images was
  available to test against. The mechanism is identical to the notes one,
  which *was* verified end to end.
- The installer map is keyed on the four types that render workspace images.
  An unrecognized `type` falls through to the sheet layout (as it does for the
  Yorkie doc key) but gets no resolver. The backend's type set is closed, so
  this is unreachable today.

## Constraints

- `appendShareTokenToImageUrl` is a security boundary — do not weaken or
  duplicate its origin check. Reuse it.
- The resolver must stay idempotent and leave `data:` / `blob:` / foreign URLs
  untouched, so cache keys stay stable across repaints.
- Install must happen before the first image request, and clear on unmount
  (StrictMode mount→cleanup→remount safe), like the slides resolver.

## Review

_(filled in after implementation)_
