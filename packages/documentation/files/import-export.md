---
title: Import and export files
description: Which file formats each Wafflebase editor imports and exports, what each conversion keeps, and the size limits.
type: reference
---

# Import and export files

This page lists the file formats each editor can bring in and take out, what each conversion keeps, and the limits that apply.

Importing always creates a new document; it never changes an open one. To import, [upload the file](/files/upload). Exporting downloads a file and leaves the document unchanged.

## Formats at a glance

| Editor | Import | Export in the app |
|---|---|---|
| [Sheets](/sheets/) | Excel (`.xlsx`), CSV (`.csv`), TSV (`.tsv`), JSON (`.json`, `.jsonl`, `.ndjson`), Parquet (`.parquet`) | None. Use the [CLI](/developers/cli/sheets) for CSV or JSON. |
| [Docs](/docs-editor/) | Word (`.docx`) | Word (`.docx`), PDF (`.pdf`), Markdown (`.md`), plain text (`.txt`) |
| [Slides](/slides/) | PowerPoint (`.pptx`) | PowerPoint (`.pptx`), PDF (`.pdf`) |
| [Notes](/notes/) | None. Use the [CLI](/developers/cli/documents#notes) for Markdown. | None. Use the [CLI](/developers/cli/documents#notes) for Markdown. |
| [Board](/board/) | A Miro board, with **New > Import from Miro…** | PNG, PDF (whole board or selection) |
| [PDF](/files/pdfs) | `.pdf`, stored as-is | Download the original |
| [Image](/files/images) | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, stored as-is | Download the original |
| Other files | Any other extension, stored as-is | Download the original |

A Markdown (`.md`) upload is stored as a file. It does not become a note.

## Where to export

| Document | How to export |
|---|---|
| Doc | Click the download icon (**Export**) in the header, then choose a format. |
| Presentation | Click the download icon (**Export**) in the header, then choose a format. It is unavailable while the deck has no slides. |
| Board | Click the download icon (**Download**) in the top-right corner of the canvas. |
| PDF, image, or other file | Click the download icon in the header (**Download PDF**, **Download image**, or **Download file**). |

On a phone, a doc or presentation lists its formats under **Export** in the ⋮ menu (**More**) in the header. The board's **Download** button stays on the canvas.

Docs and presentations export from the editor in your workspace, not from a share link. Anyone who can open a board, including a viewer, can download it.

## Limits

| Limit | Value |
|---|---|
| Any uploaded file | 100 MB |
| Image file (including types stored as plain files, such as HEIC) | 25 MB |
| Each image inside an imported `.docx` or `.pptx` | 10 MB |
| CSV or TSV import | 40,000 cells, plus an overall size limit |
| Parquet import | 40,000 cells |
| Excel or JSON import | No cell limit |

A CSV or TSV file over its limit is cut short rather than rejected. The sheet keeps the rows that fit, and the upload shows `Only the first N rows were imported.` If even the first row is too large, the upload fails with a message such as `This file has too many columns to import`.

A Parquet file over 40,000 cells is rejected before anything is imported.

## What import keeps

| File | Kept |
|---|---|
| `.xlsx` | Every worksheet as a tab, with values, formulas, merged cells, column widths, row heights, hidden rows and columns, and cell formatting: fill, borders, bold, italic, underline, strikethrough, text color, alignment, and number format |
| `.csv`, `.tsv` | The values, in one tab named after the file. A `.csv` can use a comma, semicolon, tab, or pipe between values; the separator is detected for you. |
| `.json`, `.jsonl`, `.ndjson` | One row per object, with the keys as a bold header row. A file can hold one object, an array of objects, or one object per line. |
| `.parquet` | The rows, in one tab, with the column names as a bold header row |
| `.docx` | Paragraphs, headings, lists, tables, images, inline formatting, headers and footers, and page size and margins |
| `.pptx` | Slides, text boxes, shapes, images, tables, charts, groups, theme colors, transitions, and animations |

When a `.pptx` needs fallbacks, the upload shows a warning that counts them, for example `Imported with 2 image(s) skipped.` Charts that can't be read appear as placeholders.

Excel font family, font size, hyperlinks, and conditional formatting are not imported.

## What export keeps

| Export | Kept |
|---|---|
| Word (`.docx`) | The full document, including tables, headers, and footers |
| Doc PDF (`.pdf`) | Paginated pages that match the page layout on screen |
| Markdown (`.md`) | Headings, lists, tables, links, images, bold, italic, and strikethrough |
| Plain text (`.txt`) | Text only, one paragraph per line, with table cells separated by tabs and images shown as `[image]` |
| PowerPoint (`.pptx`) | An editable deck with slides, shapes, text, images, tables, and the theme |
| Slides PDF (`.pdf`) | One slide per page |
| Board PNG or PDF | The whole board, or only the selected items |

Markdown export drops alignment, indents, line spacing, color, font and size, underline, superscript and subscript, merged and nested table cells, and headers and footers. A link that is not an ordinary web address is dropped, and its text stays. An image that is neither a web address nor embedded image data becomes the text `[image]`.

## Fidelity notes

- `.docx` and `.pptx` import is best effort. Rare features, such as embedded objects, macros, audio, and video, may be simplified or dropped.
- If an imported file uses a font that Wafflebase doesn't have, a close substitute is shown.
- Exporting a file you imported keeps its structure and content, but the file is not identical to the original.

## Related

- [Upload files](/files/upload) to import a file.
- [Board export and import](/board/export-and-import) to download a board or bring one in from Miro.
- [Documents and notes on the CLI](/developers/cli/documents#notes) to import and export notes as Markdown.
- [Sheets on the CLI](/developers/cli/sheets) to export a tab as CSV or JSON.
