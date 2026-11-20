---
title: Upload files
description: Upload any file to a workspace and see what each file type becomes.
type: how-to
---

# Upload files

Upload files from your computer to a workspace, and each one becomes a document you can open, share, and organize.

Wafflebase picks the document type from the file extension. Spreadsheets, Word documents, and PowerPoint decks are converted so you can edit them. PDFs and images open in a viewer. Any other file is stored as-is so you can download it again.

::: info Before you start
- You need to be a member of the workspace.
- Each file can be up to 100 MB. Image files are limited to 25 MB.
- Uploads go into the folder you have open. To upload to the workspace root, go back to the top of the list first.
:::

## Upload from the New menu

1. Open your workspace, or the folder you want the files in.
2. Click **New** in the top right.
3. Select **Upload files…**.
4. Choose one or more files and confirm.

An **Uploads** panel opens in the bottom-right corner and shows each file's progress. When a file is done, its row shows an **Open** link.

![New menu open with Upload files… and Import from Miro… below the create entries](/images/files/upload-new-menu.png)

### Drag files into the window

Drag files from your computer anywhere onto the documents list. The page shows **Drop files to upload**. Release to start the upload.

### On a phone

Tap **New**, then **Upload files…**. Your phone's file picker opens, so you can choose from files, photos, or other apps. Dragging files is not available on a phone.

## What each file becomes

| You upload | You get |
|---|---|
| `.xlsx` | A [sheet](/sheets/). Each worksheet becomes a tab. |
| `.csv`, `.tsv` | A sheet with one tab. |
| `.json`, `.jsonl`, `.ndjson` | A sheet with one tab. Object keys become a bold header row. |
| `.parquet` | A sheet with one tab. |
| `.docx` | A [doc](/docs-editor/). |
| `.pptx` | A [presentation](/slides/). |
| `.pdf` | A [PDF](/files/pdfs) you can read and comment on. The file is not converted. |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | An [image](/files/images) you can view and download. |
| Anything else | A stored file with no preview. You can download it again. |

A converted document is named after the file without its extension, so `budget.xlsx` becomes **budget**. A PDF, image, or other stored file keeps its full file name, such as `report.pdf`.

Uploading a Markdown (`.md`) file stores it as a file. It does not create a [note](/notes/). To turn a Markdown file into a note, use `wafflebase notes import` in the [command-line tool](/developers/cli/documents#notes).

For what each conversion keeps and the size and row limits, see [Import and export](/files/import-export).

## Track and retry uploads

The **Uploads** panel lists every file in the current batch:

- A spinner shows a file that is still being read or uploaded.
- **Open** goes to a finished document.
- An amber warning means the document was created with something left out, for example a large CSV that was cut short.
- A red message means the upload failed. If a retry icon appears next to the file name, click it to try again.
- The **X** at the end of a finished or failed row removes it from the panel.

Click the arrow icon in the panel header to collapse the panel, or the **X** beside it (**Clear finished uploads**) to remove every finished row. Failed rows stay until you remove them.

You can open other documents while files upload; the panel stays in the corner. Keep the tab open until every file finishes, because closing or reloading the tab stops any upload that has not finished.

![Uploads panel with one finished file showing Open and one failed file showing the 100 MB size-limit message](/images/files/upload-panel-failed.png)

### Fix a failed upload

| Message | What to do |
|---|---|
| `File is larger than the 100 MB limit` (or `25 MB` for an image) | Make the file smaller, or split it, and upload it again. |
| `Couldn't upload this file. Check your connection and retry.` | Check your connection, then click the retry icon. |
| `Couldn't load the importer. Reload the page, then retry.` | Reload the page, then upload the file again. |
| `This file has too many columns to import` | The first row of the CSV or TSV is too wide. Split the columns into several files. |
| `This file does not contain any data.` | The CSV or TSV file is empty. Check the file and upload it again. |

## Import a Miro board

1. Open your workspace or folder. The entry is not shown on the list of all documents across workspaces.
2. Click **New** and select **Import from Miro…**.
3. Paste your Miro **Access token** and the **Board URL**.
4. Click **Import**.

The import continues in the background and shows its progress in the **Uploads** panel. A failed Miro import has no retry icon; start the import again from the **New** menu. When it finishes, the board appears in your list. The access token is used only for this import and is not stored. For what comes across from Miro, see [Board export and import](/board/export-and-import).

## Open a file with no preview

A file that is not a sheet, doc, presentation, PDF, or image opens as a card with its file type, size, and upload date, and the note **No preview available**.

1. Open the file from the documents list.
2. Click the download icon (**Download file**) in the header.

The original file downloads to your computer. You can rename the file by clicking its title in the header, and [share it](/collaborate/share) like any other document.

## Known limitations

- Every upload creates a new document. To update an uploaded PDF, image, or file, upload the new version and move the old one to the [trash](/collaborate/trash).
- Self-hosted deployments need file storage configured before uploads work. See [Configuration](/developers/self-hosting/configuration).

## Related

- [Import and export](/files/import-export) for the formats, limits, and what each conversion keeps.
- [Read and comment on PDFs](/files/pdfs) after you upload one.
- [Folders](/collaborate/folders) to organize what you uploaded.
- [Files and images on the CLI](/developers/cli/files-and-images) to upload from a script.
