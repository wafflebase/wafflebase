# Share-link image upload (issue #1037)

An anonymous visitor holding an **editor** share link to a Docs document
cannot insert an image: `POST /images` carries a bare `JwtAuthGuard`, so the
request is a 401, and `fetchWithAuth` turns that 401 into
`logout()` + `redirectTo("/login")` — ejecting the visitor from the document
they were editing.

## Acceptance criteria

- [x] An anonymous **editor**-role share-link visitor can insert an image into
      a shared Docs document.
- [x] A **viewer**-role link cannot upload (403, role checked server-side).
- [x] No authorization failure inside a shared document redirects to `/login`.
- [x] An anonymously inserted image reads back for the author (workspace
      member) and for other share-link visitors.

## Plan

### Backend — a write-capable share-token image route

- [x] `ApiV1ShareImageUploadController` at `POST /api/v1/shared/images?token=`
      (`packages/backend/src/api/v1/image-share-upload.controller.ts`).
  - [x] `assertCanWrite(token)` resolves the link via
        `ShareLinkService.findByToken` and requires `link.role === 'editor'`
        (mirrors `yorkie-auth.controller.ts`; the read-side precedents ignore
        role on purpose and copying them would let a viewer upload).
  - [x] The S3 key prefix is `link.document.workspaceId` — derived from the
        token, never from a client-supplied path segment. `WorkspaceScopeGuard`
        cannot help here: it calls `assertMember(user.id)` and there is no user.
  - [x] Reuse `IMAGE_UPLOAD_MULTER_LIMIT_BYTES` + `ALLOWED_IMAGE_MIME_TYPES`
        rather than re-deriving the blob bounds.
  - [x] `@Throttle` tighter than the read routes' 600/min — this is an
        unauthenticated write.
  - [x] `ApiV1ImagesController`'s strict class-level guard stack is left alone.
- [x] Register the controller in `api-v1.module.ts`.
- [x] Unit spec: editor uploads, viewer 403, missing token 403, workspace taken
      from the link.

### Docs engine — an image-URL resolver seam

- [x] `setImageUrlResolver` in `packages/docs/src/view/image-cache.ts`, applied
      wherever a `src` becomes a cache key (same shape as slides / notes /
      sheets), exported from `packages/docs/src/index.ts`.

### Frontend

- [x] `postShareTokenImage` in `api/images.ts`, using plain `fetch` — **not**
      `fetchWithAuth`, or a legitimate 403 still triggers the logout redirect.
- [x] `shareTokenImageUploader(token)` in `app/docs/image-insert.ts`;
      `insertImageFromFile` takes the uploader as a parameter, defaulting to
      today's owner-route uploader.
- [x] Thread `uploadImage` through `DocsView` and `DocsFormattingToolbar` so
      the toolbar pick, the mobile menu, and the drop/paste path all use it.
- [x] `SharedDocsLayout` builds the uploader from its share token.
- [x] `["doc", setDocsImageUrlResolver]` in `IMAGE_RESOLVER_INSTALLERS`, so an
      anonymously inserted (workspace-scoped) image loads for every viewer.
- [x] The token is never baked into the stored `src`; it is appended per-viewer
      at render time by `appendShareTokenToImageUrl`, whose origin gate is
      reused as-is.
- [x] Measure the inserted image's pixel size from the local file, not by
      re-fetching the uploaded URL — that second read carries no token and
      403s, losing the insert after a successful upload (found in self-review).
- [x] Frontend spec `app/docs/image-insert.test.ts`: the share route + token
      encoding, never `fetchWithAuth`, the server's message in the thrown
      error, and a guard that only `blob:` is ever probed during an insert.

## Deliberately out of scope

- **The owner Docs route stays on `/images`.** The issue observes that docs is
  on the wrong image spine to begin with. Migrating it is a separate change
  (it moves read-back for every existing owner flow — DOCX export's fetcher,
  PDF export's own `Image()`, thumbnail capture) and none of the acceptance
  criteria need it. The two spines coexist per document: the resolver leaves a
  root-bucket `/images/:id` URL untouched, because
  `isTrustedWorkspaceImageUrl` only matches the workspace path.
- **Slides / board / sheets share-link image insert.** The issue notes the
  same root cause dead-ends those three surfaces. Opening them needs
  `workspaceId` (or an uploader) threaded into three more shared layouts and
  is not part of this issue's acceptance criteria.
- Cumulative upload quota per token — matches the repo-wide deferral in
  `docs/design/generic-file-upload.md`.
