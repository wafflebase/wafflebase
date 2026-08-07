# CLI file upload

Give the `wafflebase` CLI the generic-file capability the documents list
already has: upload any file as a blob document, and download it back.

Design: [`docs/design/cli.md`](../../design/cli.md) §4 (`files` namespace),
building on [`docs/design/generic-file-upload.md`](../../design/generic-file-upload.md).

## Problem

`generic-file-upload.md` shipped the blob spine (`Document.fileId` /
`fileSize` / `mimeType`, the `file` document type, derived serving headers),
but only through JWT-gated routes the browser uses. The CLI cannot reach any
of it:

- `POST /files` (`file.controller.ts`) is `JwtAuthGuard` — an API-key CLI
  (the CI/agent mode) gets 401.
- `POST /api/v1/workspaces/:wid/documents` accepts only
  `doc|slides|note|board` (everything else falls back to `sheet`) and takes
  no `fileId`, so even an uploaded blob cannot be attached to a document.
- `GET /documents/:id/file` is `OptionalJwtAuthGuard` (JWT or share token),
  so API-key download is unavailable too.
- `HttpClient.request()` always JSON-serializes and pins
  `Content-Type: application/json` — the CLI has no multipart or binary
  response path at all.

## Decisions

1. **One round trip, not two.** The frontend uploads the blob and then
   creates the document, because its queue must survive a reload and resume
   without orphaning a second blob. A CLI invocation is one shot with no
   resumable state, so `POST /api/v1/workspaces/:wid/files` does both and
   deletes the blob if document creation fails — no orphan, no client-side
   two-phase protocol.
2. **`files upload` never parses.** `wafflebase files upload report.xlsx`
   stores the bytes verbatim as a `file` document; it does not become a
   spreadsheet. A stderr hint points at `sheets import` for the parseable
   extensions. Explicitness matters more than convenience in a CLI.
3. **…but it does route to the right viewer type.** Extension → document
   type on the server: `.pdf` → `pdf`, `png|jpg|jpeg|gif|webp` → `image`,
   everything else → `file`. Choosing a viewer is not parsing, and a PDF
   uploaded from the terminal should open in the PDF viewer exactly like one
   dropped on the documents list.
4. **Serving stays derived.** Download reuses `fileResponseHeaders()`, so
   the v1 route inherits the same "Content-Type from document type, never
   echoed from storage" rule. No second serving policy to keep in sync.

## Non-Goals

- Streaming / chunked upload. The 50 MB `MAX_FILE_UPLOAD_BYTES` cap and the
  buffered Multer path are unchanged; presigned direct-to-S3 stays the
  documented next step.
- Replacing a blob in place (`--replace`), folders, or bulk upload.
- A `files` viewer/preview concern of any kind; the CLI moves bytes.
- Comments/presence on `file` documents (still reserved-only).
- **Stdin (`files upload -`).** Every other `import` accepts it, but both the
  document type and the download extension come from the filename; accepting
  stdin would silently produce an untyped, extension-less blob. Rejected with
  an explicit `STDIN_UNSUPPORTED` error rather than half-supported.

## Plan

### Backend

- [x] `blobDocumentTypeFor(fileId)` → `'pdf' | 'image' | 'file'`. Landed in
      `document-file-id.util.ts` rather than a new file: that module already
      owns `FILE_ID_EXT`, so deriving and validating read off one table and
      cannot drift. Takes the *stored* id, not the client filename.
- [x] `ApiV1FilesController` (`api/v1/files.controller.ts`),
      `CombinedAuthGuard + WorkspaceScopeGuard`, throttle matching the images
      controller:
  - [x] `POST /api/v1/workspaces/:wid/files` — multipart `file`, optional
        `title`; upload blob → derive type → `assertFileIdAllowed` → create
        document with `fileId`/`fileSize`/`mimeType`; on create failure
        delete the blob and rethrow.
  - [x] `GET /api/v1/workspaces/:wid/files/:documentId` — workspace-scoped
        document lookup, `VALID_FILE_ID_PATTERN` check, `fileResponseHeaders()`.
- [x] Register in `api-v1.module.ts` (needs `FileModule`).
- [x] Controller spec: type derivation, blob cleanup on create failure,
      unknown/cross-workspace document id → 404, non-blob document → 404,
      title/mime length limits.

### CLI

- [x] `HttpClient`: `uploadFileDocument()` (FormData; must not set
      `Content-Type`) and `downloadFileDocument()` (binary + parsed
      `Content-Disposition` filename), both sharing the existing auth
      headers and 401-refresh path — extracted into one `send()` helper.
- [x] `commands/files.ts` — `files` namespace (alias `file`):
      `upload`, `download`, `list`, `get`, `rename`, `delete`.
- [x] `files/upload.ts` orchestrator: size pre-check, `--title` default from
      basename, parseable-extension hint, stdin rejected.
- [x] Register in `bin.ts`; add schema registry entries with safety levels.
- [x] Tests: `namespaces.test.ts` additions, upload orchestrator unit tests
      (size cap, title default, hint), download filename resolution.

### Docs

- [x] `docs/design/cli.md` — command tree, `files` prose section, directory
      structure, safety table, usage examples, bump `target-version`.
- [x] `docs/design/rest-api.md` + `packages/backend/README.md` — the two new
      endpoints.
- [x] `packages/cli/skills/files-upload-download.md` agent skill.

### Verify

- [x] `pnpm verify:fast`
- [x] Manual end-to-end against the local stack (backend + MinIO + Postgres),
      21 assertions: upload/download round-trip for `.zip` / `.png` / `.pdf` /
      `Makefile` / `.html` / `.xlsx`, derived types and titles, serving
      headers, `--force`, list filters, delete-removes-blob.
- [x] Self code review over the branch diff.

## Review

Two defects surfaced during the work, both in code this change extends rather
than in the new code itself:

1. **`DELETE /api/v1/.../documents/:did` leaked its blob.** The JWT delete
   cleans up the stored object; the v1 delete never did. It was reachable
   before (deleting a browser-uploaded PDF through the API) but became routine
   the moment this surface could *create* blob documents, so it is fixed here
   with the same best-effort cleanup and a regression test.

2. **`Content-Disposition: inline` carried no filename.** `pdf` and `image`
   documents returned a bare `inline`, so `files download` had nothing to name
   the output by and fell back to the document uuid. Caught by the manual
   end-to-end run, not by any unit test — the CLI-side tests all stub the
   header. Fixed in `fileResponseHeaders` for every disposition, which also
   improves "Save as" in the browser (an inline PDF used to save as the uuid).

Deliberate deviations from the plan:

- No stdin form (see Non-Goals).
- The multipart path has no DTO, so `CreateDocumentDto`'s `@Length(1, 200)`
  title and `@Length(1, 255)` mime limits are applied by hand. An explicit
  over-long `title` is rejected; an over-long *filename*-derived title is
  truncated — the title is a display label, and refusing an upload over a long
  filename would be user-hostile.
- `files upload` deliberately never parses. `.xlsx`/`.docx`/`.pptx`/`.csv`/`.md`
  print a one-line stderr hint naming the namespace that would parse them, then
  upload as bytes anyway.

### Review round 1 (CodeRabbit)

Three findings accepted, all valid:

- **`POST /files` did not check the API key's `write` scope.** I had originally
  left this alone on consistency grounds — no v1 write endpoint except
  `documents.delete` checks it. That reasoning was wrong: the consistency being
  preserved was consistency with a hole, `scopes` exists precisely to stop a
  read-scoped key from writing, and no existing client depends on the new
  endpoint's old behavior. Now enforced before the blob is stored.
- **The Files skill advertised `write / read-only`** while containing
  `files delete`, which the schema registry marks `destructive`. Agents pick
  their confirmation behavior off that metadata, so an under-stated safety
  level is a real defect. Fixed in the frontmatter and the skill index.
- **`io.readBytes` failures escaped the JSON error envelope.** `sizeOf`
  succeeding does not mean the bytes are readable — a directory stats fine and
  then fails with `EISDIR`. Now reported as `FILE_READ_FAILED` with the
  underlying message.

Plus a prettier/`no-unsafe-*` cleanup in the new backend files: **`verify:fast`
does not lint the backend** (only `backend lint:arch` runs), so these never
surfaced locally. See the lessons file.

Known limitations: no streaming/resumable upload, no in-place blob replace, and
the *other* v1 write endpoints (`documents.create`/`update`, `cells.*`,
`docs-content` PUT) still do not check the `write` scope. That is a real
pre-existing hole, but fixing it changes the behavior of keys already in use
and belongs in its own change.
