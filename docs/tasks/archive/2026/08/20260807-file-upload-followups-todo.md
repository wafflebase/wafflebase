# Generic file upload — production follow-ups

Three findings from exercising the shipped v0.6.3 CLI against the production
workspace (the first real end-to-end run of this path; `generic-file-upload`
had to skip its manual round-trip for lack of a database). Two defects and one
gap, batched into one PR because they all live in the same upload path.

**Design doc:** [`docs/design/generic-file-upload.md`](../../design/generic-file-upload.md)

## What was observed

Five uploads via `wafflebase files upload` — `.zip`, `.c++`, `.pdf`, `.png`,
and an extension-less file. All five round-tripped **byte-identical**, and the
serving rule held per type. Then:

1. **Titles lose their extension.** `wb063-test.zip`, `wb063-test.c++`,
   `wb063-test.pdf` and `wb063-test.png` all list as `wb063-test` — four
   different files, indistinguishable in the documents list.
2. **`+`-bearing extensions are lost on round trip.** Uploading
   `wb063-test.c++` downloads back as `wb063-test`, with no extension, and the
   `Content-Disposition` filename has none either. Contents are intact.
3. **No way to upload into a folder.** Neither the CLI nor the v1 endpoint
   accepts one; every upload lands at the workspace root.

## Root cause

Defects 1 and 2 are the same bug seen from two sides, not two bugs.

`defaultTitle()` (`api/v1/files.controller.ts`) deliberately strips the
extension, and `attachmentFilename()` (`document/file-response.util.ts`)
re-appends it **from the storage key**, whose extension has been through
`safeExtension()`'s `^[a-z0-9]{1,12}$` sanitizer. The sanitizer rejects `c++`
(the `+`), so that blob is stored under a bare uuid — confirmed in production:
the `.zip` doc's `fileId` is `f6049875-….zip` while the `.c++` doc's is
`e36631b4-…` with no suffix. With nothing in the key, there is nothing to
re-append, and the extension is gone for good.

So the extension survives only if it passes a sanitizer that exists to keep
untrusted input out of an S3 key. That is the wrong place to source a *display*
name from.

**Fix:** stop stripping. A blob document *is* the file, so its title should be
the filename, extension included. Then the title carries the extension
independently of what the key holds, and defect 2 disappears with defect 1.

Widening `safeExtension` to allow `+` was considered and rejected: it loosens
the untrusted-input-into-object-key boundary to solve a display problem, and
would still fail for the next character it does not cover.

Note the distinction the fix must preserve: `upload-queue.ts` strips for
**converted** uploads (`.xlsx` -> sheet, `.docx` -> doc, `.pptx` -> slides),
which is correct — an imported spreadsheet is a native document named
"Budget", not "Budget.xlsx". Only the **blob** branch (`file`/`pdf`/`image`)
should keep the extension.

## Goals / Non-Goals

**Goals:** blob titles keep their extension on both upload paths; the download
filename no longer depends on the sanitizer; `folderId` accepted by the v1
upload endpoint and exposed as `--folder` on the CLI; docs updated.

**Non-Goals:** changing `safeExtension`; renaming existing documents (the fix
is forward-only, and `attachmentFilename`'s re-append stays for rows already
stored with a stripped title); a CLI `docs move` command; folder *creation*
from the CLI.

## Plan

### Task 1 — blob titles keep their extension

- [x] Failing test first: `api/v1/files.controller.spec.ts` — uploading
      `report.zip` with no explicit `--title` yields title `report.zip`;
      `archive.c++` yields `archive.c++`; an extension-less name is unchanged;
      an explicit title still wins; the 200-char cap and the `Untitled File`
      fallback still hold.
- [x] `defaultTitle()`: return the full basename rather than the stem. Keep
      the path-separator strip, the length cap, and the fallback.
- [x] Failing test first: `upload-queue` test — a `file`/`pdf`/`image` item
      keeps `item.fileName` verbatim, while an `xlsx`/`docx`/`pptx` item still
      strips.
- [x] `upload-queue.ts:395`: use the filename as-is for the blob branch; leave
      the three converted branches on `stripExt`.
- [x] `file-response.util.ts`: `attachmentFilename` keeps its re-append (older
      rows have stripped titles) — its idempotence guard already covers a
      title that now ends in the extension. Correct the comment, which asserts
      "the title itself never carries one".
- [x] `file-response.util.spec.ts`: cover a title that already carries the
      extension (no doubling), and a title with an extension the key lacks
      (`archive.c++` + bare-uuid key -> `archive.c++`).
- [x] **Blast radius, found by re-reading the diff:** the frontend's
      `download-file.ts` has a second, *guessing* fallback the server does not
      — a MIME→extension map. It was safe only because titles never had an
      extension. With titles carrying one it could disagree and double:
      `image/jpeg` maps to `jpg`, turning `photo.jpeg` into `photo.jpeg.jpg`.
      Reproduced as a failing test, then fixed by skipping the MIME guess when
      the title already ends in an extension. The `fileId` fallback needs no
      such guard — it came from this same filename — and the legacy
      stripped-title path is unchanged.

### Task 2 — upload into a folder

- [x] Failing test first: `files.controller.spec.ts` — `folderId` in the
      multipart body is passed through to `createDocument`; a folder from
      another workspace is rejected; an absent `folderId` still creates at the
      root.
- [x] `files.controller.ts`: accept `folderId` in the body, gate it with the
      existing `folderService.assertSameWorkspace(folderId, workspaceId)` (the
      same call `document.controller.ts:129` uses), and connect the folder.
      Reject **before** storing the blob, so a bad folder does not cost an
      upload — matching how the title is resolved first today.
- [x] Failing test first: CLI `files upload --folder <id>` sends `folderId`.
- [x] CLI: `--folder <id>` option on `files upload`, threaded through
      `runFilesUpload`.

### Task 3 — docs

- [x] `packages/documentation/developers/cli.md`: document `--folder`, and
      correct the `--title` default (it is the filename, not the stem).
- [x] `packages/backend/README.md`: the v1 files upload row gains `folderId`.
- [x] `docs/design/generic-file-upload.md`: record that blob titles keep the
      extension and that the download filename no longer depends on
      `safeExtension`.

### Wrap-up

- [x] `pnpm verify:fast` green.
- [x] Re-run the round trip that found this — **against a local full stack,
      not production.** Production runs v0.6.3, which is the build these fixes
      change, so it cannot confirm them; that has to wait for the next
      release. Local: backend on the docker-compose Postgres/MinIO with
      seeded workspace/folder/API-key fixtures, exercised through the built
      CLI. Fixtures and documents deleted afterwards.
- Self code review over the branch diff before pushing — **not run**, the
  session was configured not to dispatch review agents unasked. Recorded as
  a known gap rather than a pending item; the branch shipped and was reviewed
  on the PR instead.
- [x] PR: title <= 70 chars, body = Summary + Test plan. Shipped as #709.

## Risks

- **Existing documents keep their stripped titles.** The fix is forward-only.
  `attachmentFilename`'s key-based re-append is what keeps their downloads
  correct, which is why it stays rather than being replaced.
- ~~**Titles are now longer** and can hit the 200-char cap sooner. A truncated
  title could lose the extension for a pathologically long filename; the cap
  is applied after, so this is accepted rather than special-cased.~~
  **Overturned in review.** Accepting this was wrong: the contract this task
  establishes is that the extension survives, and a carve-out at the cap
  breaks it for exactly the reason the original bug did — and for a
  sanitizer-rejected extension the title is the only copy, so the loss is
  permanent. Truncation now reserves the extension's length, falling back to a
  plain cut only when the extension itself cannot fit inside the cap.

## Verification

Run end-to-end against a local stack (docker-compose Postgres + MinIO, backend
from this branch, the built CLI), with a seeded workspace, two folders in
*different* workspaces, and a read+write API key:

| Case | Before | After |
| --- | --- | --- |
| `upload wb063-test.zip` | title `wb063-test` | title `wb063-test.zip` |
| `upload wb063-test.c++` | title `wb063-test` | title `wb063-test.c++`, key still bare `8fb13820-…` |
| `upload wb063-test.pdf --folder folder-fixture` | no such option | `folderId: folder-fixture`, `type: pdf` |
| `upload --folder <other workspace's folder>` | no such option | 400 "Folder must belong to the same workspace", nothing stored |
| `download` the `.c++` doc | `wb063-test` (extension lost) | `wb063-test.c++`, sha256 matches the original |
| `download` the `.zip` doc | `wb063-test.zip` | `wb063-test.zip` — not doubled |

The `.c++` case is the one that matters: its storage key still has no
extension (the sanitizer is unchanged, by design), so the download filename is
now coming from the title. That is the whole point of the fix.

While setting this up, `WorkspaceScopeGuard` was read to confirm the folder
check is sound: it rewrites `request.params.workspaceId` to the resolved
canonical id before the handler runs, so `assertSameWorkspace` compares a
folder's `workspaceId` against an id and never against a slug.

## Review

_Filled in after merge._
