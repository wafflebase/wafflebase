# Import & Export

Wafflebase reads and writes the file formats your team already uses, so you
can bring existing work in and take finished work out. Nothing is locked to
the platform.

## At a glance

| Product | Import | Export |
|---------|--------|--------|
| **Sheets** | Excel (`.xlsx`) | — *(CSV/JSON via [CLI](../developers/cli))* |
| **Docs** | Word (`.docx`) | Word (`.docx`), PDF (`.pdf`) |
| **Slides** | PowerPoint (`.pptx`) | PowerPoint (`.pptx`), PDF (`.pdf`) |

Import always creates a **new** document; it never overwrites an open one.
Export downloads a file from the document you are editing.

## Importing files

From your workspace, open the **New** menu and choose an import option:

- **Import XLSX** — creates a new spreadsheet from an Excel workbook. Each
  sheet in the workbook becomes a tab. Values, formulas, and basic cell
  formatting are brought across.
- **Import DOCX** — creates a new document from a Word file, mapping
  paragraphs, headings, lists, tables, and inline formatting into the editor.
- **Import PPTX** — creates a new deck from a PowerPoint file: slides,
  text boxes, shapes, images, tables, and theme colors are converted to
  native Wafflebase elements.

Large files show a progress indicator while they are parsed and any embedded
images are uploaded into your workspace.

## Exporting files

### Docs

In the document editor, open the **Export** menu (the download icon in the
header) and choose:

- **Word (`.docx`)** — the full document, including tables and headers/footers.
- **PDF (`.pdf`)** — a paginated, print-ready PDF that mirrors the on-screen
  page layout.

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
`slides export`, `slides import`, and the `sheets` cell import/export
commands — useful for batch conversions and pipelines.
