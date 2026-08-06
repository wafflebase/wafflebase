---
name: files-upload-download
description: Store any file in a Wafflebase workspace and download its bytes back
safety: write / read-only
tools:
  - wafflebase files upload
  - wafflebase files download
  - wafflebase files list
  - wafflebase files delete
---

# Upload and Download Files

## When to Use

When the user wants a file to *live in* a workspace rather than be turned
into an editable document — a `.zip`, a log, a video, a build artifact, a
PDF, an image. Any extension is accepted, including none.

Do **not** use this to import a spreadsheet, document, or deck the user
wants to edit; see the routing rule below.

## Routing: upload vs import

`files upload` stores bytes verbatim and never parses. If the user wants an
editable document, use the parsing namespace instead:

| File | To edit it | To store it as-is |
|------|-----------|-------------------|
| `.xlsx`, `.csv` | `wafflebase sheets import` | `wafflebase files upload` |
| `.docx` | `wafflebase docs import` | `wafflebase files upload` |
| `.pptx` | `wafflebase slides import` | `wafflebase files upload` |
| `.md` | `wafflebase notes import` | `wafflebase files upload` |
| anything else | — | `wafflebase files upload` |

Uploading a parseable extension prints a hint to stderr and proceeds. That
is not an error — if the user asked to store the file, the upload is right.

## Commands

### Upload

```bash
wafflebase files upload archive.zip
wafflebase files upload diagram.png --title "Architecture v2"
```

The document type is chosen from the extension: `.pdf` → `pdf`,
`png|jpg|jpeg|gif|webp` → `image`, everything else → `file`. The `pdf` and
`image` types get a real in-app viewer; a `file` document offers download
only.

Without `--title` the document is named after the file, minus its extension
(`report.zip` → "report"). The extension is re-attached on download, so the
user gets `report.zip` back.

There is **no stdin form** — `files upload -` is an error. Both the type and
the download extension come from the filename.

Response:

```json
{ "id": "…", "title": "archive", "type": "file", "fileSize": 20418, "mimeType": "application/octet-stream" }
```

### Download

```bash
wafflebase files download <doc-id>                    # → ./archive.zip
wafflebase files download <doc-id> out/archive.zip    # explicit path
wafflebase files download <doc-id> - | shasum         # bytes to stdout
wafflebase files download <doc-id> archive.zip --force
```

With no output argument the CLI uses the filename the server advertises.
Without `--force` it refuses to overwrite an existing file.

### List and inspect

```bash
wafflebase files list                  # all blob documents
wafflebase files list --type image     # one type
wafflebase files list --format table
wafflebase files get <doc-id>
```

### Rename and delete

```bash
wafflebase files rename <doc-id> "Q3 archive"
wafflebase files delete <doc-id>       # destructive: also deletes the bytes
```

## Limits

- 50 MB per file; 25 MB for image extensions. Checked before upload, so an
  oversized file fails immediately with `FILE_TOO_LARGE` rather than after a
  long transfer.
- No streaming, resumable, or in-place replacement upload. Replacing a file
  means uploading a new document and deleting the old one.

## Safety

`files upload` and `files rename` are `write`. `files download`, `list`, and
`get` are `read-only` (local writes still refuse to clobber without
`--force`). `files delete` is `destructive` and unrecoverable — it removes
the stored bytes along with the document. Always confirm with the user
first.
