---
title: Documents and folders
description: Endpoints to list, create, rename, copy, file, trash, and restore documents, manage folders, and upload files and images.
type: reference
---

# Documents and folders

Endpoints to list, create, rename, copy, file, trash, and restore documents, manage folders, and upload files and images.

Paths are relative to `$WFB_API/workspaces/$WS`. Authentication, scopes, and error shapes are on the [REST API overview](/developers/api/). The same actions are in the CLI as [`wafflebase docs`](/developers/cli/documents#manage-any-document) and [`wafflebase folders`](/developers/cli/documents#folders).

## Who can do what

Any workspace member can list, read, create, rename, and copy documents, and create and rename folders. *Managing* a document or folder needs more:

| Action | Who can do it |
|---|---|
| Move a document to another folder, trash it, restore it, or delete it permanently | The workspace owner, or the member who created the document |
| Move or delete a folder | The workspace owner, or the member who created the folder |

An API key has its creator's role. Anyone else gets `403`, for example `Only the workspace owner or document owner can delete this document`.

## Documents

A document row looks like this:

```json
{
  "id": "4b1f0c7e-2d9a-4c1e-9f5b-8a6d3e2c1b0a",
  "title": "Q1 Sales",
  "type": "sheet",
  "fileId": null,
  "fileSize": null,
  "mimeType": null,
  "authorID": 12,
  "workspaceId": "a8e2...",
  "folderId": null,
  "deletedAt": null,
  "createdAt": "2026-11-02T09:14:03.120Z",
  "updatedAt": "2026-11-02T09:20:45.000Z"
}
```

`type` decides which editor opens the document:

| `type` | Document |
|---|---|
| `sheet` | Spreadsheet |
| `doc` | Text document |
| `slides` | Presentation |
| `note` | Markdown note |
| `board` | Board |
| `pdf` | Uploaded PDF |
| `image` | Uploaded PNG, JPEG, GIF, or WebP image |
| `file` | Any other uploaded file |

`folderId` is `null` for a document at the workspace root. `deletedAt` is set while a document is in the trash.

### List documents

`GET /documents`

Returns every document in the workspace, in all folders, as an array of document rows. Trashed documents are left out. A document someone has open in an editor also carries an `editors` array of `{ username, photo?, email? }`.

```bash
curl -s -H "Authorization: Bearer $WFB_KEY" "$WFB_API/workspaces/$WS/documents"
```

### Create a document

`POST /documents`

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | 1 to 200 characters |
| `type` | string | No | `doc`, `slides`, `note`, or `board`. Any other value, or none, creates a `sheet` |

```bash
curl -s -X POST \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"title": "Launch plan", "type": "doc"}' \
  "$WFB_API/workspaces/$WS/documents"
```

This creates an empty doc at the workspace root and returns its row. The caller is the author.

- Any other field, such as `folderId`, is a `400 property <name> should not exist`. To file the new document, [update it](#update-a-document) afterwards.
- PDFs, images, and other files are created by [uploading them](#upload-a-file).

### Get a document

`GET /documents/<documentId>`

Returns one document row. A document in the trash is `404`.

### Update a document

`PATCH /documents/<documentId>`

Send only the fields you change:

| Field | Type | Description |
|---|---|---|
| `title` | string | New title, 1 to 200 characters. Any member can rename |
| `folderId` | string or `null` | Move the document to this folder in the same workspace. `null` moves it to the root. Needs a manager |

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"title": "Launch plan (final)", "folderId": "9c3e5a12-7b44-4f0e-8d1a-2f6b9e0c4d77"}' \
  "$WFB_API/workspaces/$WS/documents/$DOC"
```

This renames the document and moves it into a folder.

- `folderId` must be a folder ID (a UUID) or `null`. A folder in another workspace is `400 Folder must belong to the same workspace`.
- Any other field is a `400`, including `type`, `createdAt`, and `editors`. Do not send a whole document row back.
- An empty body `{}` changes nothing and does not bump `updatedAt`.

### Copy a document

`POST /documents/<documentId>/copy`

Creates a copy in the same folder, titled `<title> (copy)`, then `<title> (copy 2)` and so on. Any member can copy. The caller is the copy's author. Comments, share links, and version history are not copied.

Returns the new document row.

### Move a document to the trash

`DELETE /documents/<documentId>`

Moves the document to the trash and returns its row with `deletedAt` set. A trashed document disappears from lists and from every other endpoint until you restore it. Needs a manager.

### Restore a document

`POST /documents/<documentId>/restore`

Takes a document out of the trash and returns its row. A document that is not in the trash is `404 Document not found in trash`. Needs a manager.

### Delete a document permanently

`DELETE /documents/<documentId>?permanent=true`

Deletes a document that is already in the trash, together with its uploaded file. A document that is not in the trash is `404`, so trash it first. Needs a manager.

::: danger
A permanent delete cannot be undone. The document, its content, and its uploaded file are gone.
:::

There is no API to list the trash. See [Trash](/collaborate/trash) to find and restore documents in the browser.

## Folders

Folders organize documents. They do not change who can open a document. A folder row has `id`, `name`, `workspaceId`, `parentId` (`null` at the root), `authorID`, and `createdAt`.

### List folders

`GET /folders`

Returns every folder in the workspace as a flat array sorted by name. Build the tree from `parentId`.

### Create a folder

`POST /folders`

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | 1 to 200 characters |
| `parentId` | string | No | Parent folder ID. Omit it to create the folder at the root |

```bash
curl -s -X POST \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"name": "Reports"}' \
  "$WFB_API/workspaces/$WS/folders"
```

This creates a root folder named `Reports` and returns it. A `parentId` in another workspace is `400 Folder must belong to the same workspace`.

### Update a folder

`PATCH /folders/<folderId>`

| Field | Type | Description |
|---|---|---|
| `name` | string | New name, 1 to 200 characters. Any member can rename |
| `parentId` | string or `null` | New parent folder. `null` moves it to the root. Needs a manager |

Moving a folder into itself or into one of its own subfolders is `400 Cannot move a folder into itself or one of its descendants`.

### Delete a folder

`DELETE /folders/<folderId>`

Deletes the folder and all of its subfolders. The documents in them are not deleted; they move to the workspace root. Needs a manager. Returns the deleted folder.

A folder in another workspace is `404 Folder not found` on every folder route.

## Files and images

Two kinds of upload exist:

- **Files** become documents of type `pdf`, `image`, or `file`, and show in the documents list.
- **Images** are stored for embedding in sheets, docs, slides, and boards. They are not documents.

### Upload a file

`POST /files`

Send `multipart/form-data`:

| Field | Required | Description |
|---|---|---|
| `file` | Yes | The file |
| `title` | No | Up to 200 characters. Omitted or blank, it is the file name, extension included |
| `folderId` | No | Folder to put the document in |

```bash
curl -s -X POST \
  -H "Authorization: Bearer $WFB_KEY" \
  -F "file=@q1-report.pdf" -F "title=Q1 report" \
  "$WFB_API/workspaces/$WS/files"
```

This uploads a PDF as a new `pdf` document and returns its row.

- The type comes from the file extension: `.pdf` is `pdf`; `.png`, `.jpg`, `.jpeg`, `.gif`, and `.webp` are `image`; anything else is `file`.
- Files are stored as they are. An uploaded `.xlsx` or `.docx` stays a `file`; to convert one, use [`wafflebase docs import`](/developers/cli/documents#import-a-word-file) or [Import and export](/files/import-export) in the browser.
- The limit is 50 MB, or 25 MB when the file name or type says it is an image. A larger file is `413`, or `400 File too large (max 25 MB)` for an image between 25 and 50 MB.
- A request without `file` is `400 No file uploaded`.
- `title` and `folderId` are checked before the file is stored, so a bad value costs no upload.

### Download a file

`GET /files/<documentId>`

Returns the uploaded bytes. PDFs and PNG, JPEG, GIF, or WebP images are served inline with their own content type; every other file is served as `application/octet-stream` with `Content-Disposition: attachment`. The download is named after the document title. A document with no uploaded file is `404 Document has no file`.

```bash
curl -s -H "Authorization: Bearer $WFB_KEY" -o q1-report.pdf \
  "$WFB_API/workspaces/$WS/files/$DOC"
```

### Upload an image

`POST /images`

Send `multipart/form-data` with the image in `file`. PNG, JPEG, GIF, and WebP up to 10 MB are accepted. Another type is `400 Unsupported file type: <type>`; a larger file is `413`.

```bash
curl -s -X POST \
  -H "Authorization: Bearer $WFB_KEY" \
  -F "file=@logo.png" \
  "$WFB_API/workspaces/$WS/images"
```

The response gives the image ID and the URL to embed:

```json
{ "id": "0f6c2b8e-5d1a-4e7b-9c3f-1a2b3c4d5e6f.png", "url": "/api/v1/workspaces/a8e2.../images/0f6c2b8e-5d1a-4e7b-9c3f-1a2b3c4d5e6f.png" }
```

Use `url` as the `src` of an image in a [sheet](/developers/api/sheets#floating-images) or in [document content](/developers/api/content).

### Read an image

`GET /images/<imageId>`

Returns the image bytes. Any workspace member or workspace API key can read it. Without either, add `?token=<shareToken>` with a share link to any document in the same workspace.

| Status | Meaning |
|---|---|
| `400 Invalid image id` | The ID is not `<uuid>.<png\|jpg\|jpeg\|gif\|webp>` |
| `403 Not allowed to read this image` | No credential, a non-member, or a share link from another workspace |
| `404 Share link not found` / `410 Share link has expired` | The `token` is unknown or expired |
| `404 Image not found` | No such image |

### Delete an image

`DELETE /images/<imageId>`

Deletes the image and returns `{ "deleted": true }`. A document that still embeds it shows a broken image.

### Upload an image with a share link

`POST /shared/images?token=<shareToken>`

This path is not under a workspace. It uploads an image with an **editor** share link instead of an API key, into the workspace of the shared document. It takes the same `file` field and limits as [Upload an image](#upload-an-image), and is limited to 30 requests per minute.

| Status | Meaning |
|---|---|
| `403 A share token is required` | No `token` |
| `403 This share link is read-only` | The link has the viewer role |
| `404` / `410` | The link is unknown or expired |

## Related

- [Organize documents in folders](/collaborate/folders) in the browser.
- [Trash](/collaborate/trash) to restore what a script deleted.
- [Upload files](/files/upload) for the file types the viewers open.
- [Document content](/developers/api/content) to write inside a doc, deck, note, or board.
