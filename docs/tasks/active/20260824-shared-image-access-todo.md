# Shared-link image access — todo

## Problem

Images embedded in slides / board / docs are served from the
workspace-scoped, auth-gated endpoint `GET /api/v1/workspaces/:wid/images/:id`
(`CombinedAuthGuard` + `WorkspaceScopeGuard`). An anonymous share-link viewer
(incognito, `/shared/:token`) has no JWT session and no workspace membership,
so every image request 401/403s. The slides/board/docs canvas renderer then
paints the "Image unavailable" placeholder (`isImageFailed(src)` →
`drawImageFailurePlaceholder`). Text and other CRDT data still show because
they flow through Yorkie with the share token; only image *bytes* go over a
separate HTTP request that carries no share credential.

Precedent: blob file serving already solved this — `document-file.controller.ts`
uses `OptionalJwtAuthGuard` + a manual `assertCanRead` that accepts a JWT
workspace member OR a valid `?token=` share link. We mirror that for images.

## Design (approved, bounded)

### Backend (one change fixes slides + docs + board authorization)
- [ ] Split the image **read** route out of the JWT-gated `ApiV1ImagesController`
      into a dual-path controller (mirror `DocumentFileController`):
      `OptionalJwtAuthGuard` + manual authorize.
  - JWT workspace member → allow (preserve existing behavior)
  - else `?token=` → `shareLinkService.findByToken(token)`; allow iff
    `link.document.workspaceId === resolved :wid`
  - preserve API-key GET (workspace-scoped key) if any consumer relies on it
  - else 403
- [ ] Keep upload (POST) + delete on the existing guarded controller.
- [ ] Register the new controller in the module.
- [ ] Backend tests (mirror `document-file.controller.spec`): anon+valid token
      pass / anon+no token 403 / token for another workspace 403 / JWT member
      pass / bad image id 400.

### Frontend (append share token at render time in shared mounts)
- [x] `packages/slides/src/view/canvas/image-cache.ts`: module-level
      `setImageUrlResolver(fn)` seam applied inside `getOrLoadImage`
      (covers `drawImage` + `drawCropPreview`) AND `isImageFailed` (keyed on
      the resolved URL so the failure placeholder still resolves). Default =
      identity; reset in `clearImageCacheForTests`.
- [x] Shared helper `appendShareTokenToImageUrl(src, token)` — appends
      `?token=` ONLY to `/api/v1/workspaces/.../images/...` URLs; leaves
      data:/external URLs untouched; idempotent; hash-safe.
- [x] Wire the resolver in the shared slides + board mount
      (`useSharedImageTokenResolver`), set **synchronously during render** (not
      an effect — the slides canvas child draws before a parent effect runs, so
      an effect install would fire one un-tokened 403 per image first), cleared
      on unmount. Editor mounts never set it.
- [x] Frontend + slides unit tests for the resolver/helper.

### Scope correction (from code review)
- **docs is NOT affected** — docs images upload to the legacy *unauthenticated*
  `POST /images` → `/images/<id>` route (`docs/image-insert.ts` →
  `docsImageUploader`), which anonymous viewers can already read. The docs
  `setImageUrlResolver` seam was dead code (its URL never matches the
  workspace-image regex) and has been **reverted**.
- **sheets floating images and notes** DO use the workspace-scoped upload and
  are also broken for anonymous viewers, but through different render surfaces
  (sheets: `spreadsheet/image-cache.ts`; notes: markdown `<img>`). The backend
  fix already covers their *authorization*; wiring the frontend token-append
  for those surfaces is a deferred follow-up (per scope decision: slides+board
  only for this PR).

## Verify
- [ ] `pnpm verify:fast`
- [ ] Manual smoke: open `/shared/:token` in a fresh incognito profile, confirm
      images on an image-heavy slide load.
- [ ] Self-review over branch diff (code-review skill).
- [ ] Lessons + archive.

## Notes / decisions
- Authorization granularity: token → workspace (not token → specific document),
  because there is no DB link from an image blob to the document that embeds it
  (the reference lives in the CRDT). Image ids are unguessable UUIDs, so the
  effective exposure is the images a viewer can already discover through docs
  they can open — same unguessable-URL model as the legacy public `/images/:id`
  route, now additionally gated behind a valid workspace share token.
