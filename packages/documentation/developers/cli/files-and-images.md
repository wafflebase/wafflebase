---
title: Files and images
description: Command reference for storing any file as a document and managing the workspace images that documents embed, with the wafflebase CLI.
type: reference
---

# Files and images

Reference for the `files` and `images` commands.

The two namespaces store different things:

- `files` stores a file as a document in the workspace list. PDFs and images open in a viewer; other files can be downloaded. See [Upload files](/files/upload).
- `images` stores a picture that a sheet, deck, board, or doc shows. It doesn't appear in the document list.

Every write accepts `--dry-run`.

## Upload a file

```bash
wafflebase files upload report.pdf
wafflebase files upload backup.zip --title "Q3 backup" --folder <folder-id>
```

| Flag | Description | Default |
|---|---|---|
| `--title <title>` | Document title | the file name, extension included |
| `--folder <id>` | Folder to upload into | the workspace root |

The file is stored as is. Its extension sets the document type:

| Extension | Type | Opens in |
|---|---|---|
| `.pdf` | `pdf` | The PDF viewer |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | `image` | The image viewer |
| Anything else | `file` | Download only |

A file can be up to 50 MB, and an image up to 25 MB. The CLI checks the size before it uploads. `files upload` needs a real file path; it doesn't read standard input (`STDIN_UNSUPPORTED`).

Uploading a `.docx`, `.pptx`, `.md`, `.markdown`, `.csv`, or `.xlsx` file stores the bytes and prints a hint. To get a document you can edit, import it instead with [`docs import`](/developers/cli/documents#import-a-word-file), [`slides import`](/developers/cli/slides-and-board#import-a-powerpoint-file), [`notes import`](/developers/cli/documents#import-a-markdown-file), or [`sheets import`](/developers/cli/sheets#import-and-export-csv-or-json) for CSV. The CLI can't convert an `.xlsx` file into a sheet; import it in the web app instead (see [Import and export](/files/import-export)).

## Download a file

```bash
wafflebase files download <doc-id>
wafflebase files download <doc-id> ./q3-backup.zip --force
wafflebase files download <doc-id> - > report.pdf
```

Without an output path, the file is saved under its own file name. `-` writes the bytes to standard output. `--force` overwrites an existing file.

## Manage stored files

```bash
wafflebase files list --type pdf --format table
wafflebase files get <doc-id>
wafflebase files rename <doc-id> "Q3 board report.pdf"
wafflebase files delete <doc-id>
```

| Command | What it does |
|---|---|
| `files list` | Lists PDF, image, and file documents. `--type` keeps one: `file`, `pdf`, or `image`. |
| `files get <doc-id>` | Prints the document's metadata. |
| `files rename <doc-id> <title>` | Renames the document. Keep the extension in the title so people can tell files apart. |
| `files delete <doc-id>` | Moves the document to the trash. See [Trash](/collaborate/trash). |

## Workspace images

Images are stored per workspace, not per document, so these commands take an image ID instead of a document ID.

```bash
wafflebase images upload logo.png
wafflebase images get <image-id> ./logo.png
wafflebase images get <image-id> - > logo.png
wafflebase images delete <image-id>
```

| Command | What it does |
|---|---|
| `images upload <file>` | Uploads a PNG, JPEG, GIF, or WebP image of up to 10 MB. This is tighter than the 25 MB an image document allows. Prints its `id` and `url`. |
| `images get <image-id> [out]` | Downloads the image. Without an output path, the file is named after the image ID. `--force` overwrites. |
| `images delete <image-id>` | Deletes the image for good. Documents that show it can no longer load it. |

`images upload` checks the type and size before uploading and doesn't read standard input.

## Put an image on a sheet

1. Upload the image and note its `url`:

   ```bash
   wafflebase images upload chart-logo.png
   ```

   The output looks like `{ "id": "3f2a…", "url": "/api/v1/workspaces/<workspace-id>/images/3f2a…" }`.
2. Read the images already on the tab, so you keep them:

   ```bash
   wafflebase sheets images get <doc-id> > images.json
   ```

3. Add an entry to the `images` array in `images.json`, with the `url` as `src`:

   ```json
   {
     "images": [
       {
         "id": "logo",
         "src": "/api/v1/workspaces/<workspace-id>/images/3f2a…",
         "anchor": "E2",
         "offsetX": 0,
         "offsetY": 0,
         "width": 160,
         "height": 48,
         "alt": "Company logo"
       }
     ]
   }
   ```

4. Write the list back:

   ```bash
   wafflebase sheets images set <doc-id> < images.json
   ```

The image appears with its top-left corner at cell **E2**. `sheets images set` replaces every image on the tab, so an image missing from the file is removed. Each image needs a unique `id`.

## Related

- [Sheets](/developers/cli/sheets) for the other `get` and `set` commands on a tab.
- [Documents and notes](/developers/cli/documents) to move or copy a stored file.
- [Upload files](/files/upload) for uploading from the browser.
- [PDFs](/files/pdfs) for viewing and commenting on a PDF.
