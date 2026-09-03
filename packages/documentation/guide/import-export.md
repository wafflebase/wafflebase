# Import & Export

Wafflebase reads and writes the file formats your team already uses, so you
can bring existing work in and take finished work out. Nothing is locked to
the platform.

## At a glance

| Product | Import | Export |
|---------|--------|--------|
| **Sheets** | Excel (`.xlsx`), CSV/TSV, JSON/JSONL, Parquet | — *(CSV/JSON via [CLI](../developers/cli))* |
| **Docs** | Word (`.docx`) | Word (`.docx`), PDF (`.pdf`), Markdown (`.md`), plain text (`.txt`) |
| **Slides** | PowerPoint (`.pptx`) | PowerPoint (`.pptx`), PDF (`.pdf`) |
| **Notes** | — *(Markdown via [CLI](../developers/cli))* | — *(Markdown via [CLI](../developers/cli))* |
| **Board** | Miro board *(via **Import from Miro…**)* | — |
| **PDF** | Upload (`.pdf`) | — *(view-only)* |

Import always creates a **new** document; it never overwrites an open one.
Export downloads a file from the document you are editing. Notes have no
in-app import or export — a note's content *is* its Markdown, and it moves in
and out through `wafflebase notes import` / `notes export`.

## Importing files

There is one entry for every format. From your workspace, open the **New** menu
and choose **Upload files…**, or drag files straight onto the documents list.
You can select several at once; each file is read and turned into the matching
document type based on its extension:

| You upload | You get |
|------------|---------|
| `.xlsx` | A spreadsheet — each sheet in the workbook becomes a tab. Values, formulas, and basic cell formatting are brought across. |
| `.csv`, `.tsv`, `.json`, `.jsonl`, `.ndjson`, `.parquet` | A spreadsheet with a single tab holding the parsed rows. |
| `.docx` | A document, mapping paragraphs, headings, lists, tables, and inline formatting into the editor. |
| `.pptx` | A deck: slides, text boxes, shapes, images, tables, and theme colors become native Wafflebase elements. |
| `.pdf` | A PDF document you can read and comment on. The file is kept intact and viewed as-is rather than converted — see [Viewing PDFs](../pdf/viewing-pdfs). |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | An image document you can view and download again — see [Viewing Images](../pdf/viewing-images). |
| anything else | A stored file with no preview, which you can download again from its header. |

A panel in the bottom-right corner shows per-file progress while each file is
parsed and any embedded images are uploaded into your workspace. Uploads are
capped at 50 MB per file, and 25 MB for images.

A very large `.csv` or `.tsv` stops at an import budget rather than failing:
the sheet is created from the rows that arrived and the panel reports how many
that was.

The **Import from Miro…** entry in the same menu is separate — it reads a Miro
board through Miro's API rather than a file on disk, and creates a
[board](../board/using-the-board) from it.

## Exporting files

### Docs

In the document editor, open the **Export** menu (the download icon in the
header) and choose:

- **Word (`.docx`)** — the full document, including tables and headers/footers.
- **PDF (`.pdf`)** — a paginated, print-ready PDF that mirrors the on-screen
  page layout.
- **Markdown (`.md`)** — GitHub-Flavoured Markdown. Deliberately lossy:
  headings, lists, tables, links, images, bold, italic and strikethrough
  survive; alignment, indent, line spacing, colour, font choice and size,
  underline, super/subscript, merged and nested table cells, and
  headers/footers do not. Link and image targets are checked on the way out —
  anything that is not an ordinary web address (or, for an image, embedded
  image data) is dropped, leaving the text it wrapped behind.
- **Plain text (`.txt`)** — the text only, one block per line, with table rows
  tab-separated. All formatting is dropped.

### Slides

In the presentation editor, open the **Export** menu and choose:

- **PowerPoint (`.pptx`)** — an editable deck with slides, shapes, text,
  images, tables, and the theme preserved as DrawingML.
- **PDF (`.pdf`)** — one slide per page, ready to share or print.

### Sheets

Spreadsheets export to CSV or JSON through the
[command-line tool](../developers/cli) (`wafflebase sheets …`). A built-in
download menu in the grid editor is on the roadmap.

## Fidelity notes

Wafflebase aims for a faithful round-trip, but the source formats are large
and some constructs have no exact equivalent:

- **PPTX/DOCX import is best-effort.** Common content — text, lists, tables,
  shapes, images, and theme colors — converts cleanly. Rare or
  application-specific features (embedded objects, macros, exotic effects) may
  be simplified or dropped.
- **Fonts** referenced by an imported file must be available in Wafflebase to
  render identically; otherwise a close fallback is substituted.
- **Re-exporting** a file you imported will not be byte-identical to the
  original, but preserves the structure and content faithfully.

## Automating with the CLI

Every import/export path above is also scriptable. See the
[CLI reference](../developers/cli) for `docs export`, `docs import`,
`slides export`, `slides import`, `notes export`, `notes import`, and the
`sheets` cell import/export commands — useful for batch conversions and
pipelines.
