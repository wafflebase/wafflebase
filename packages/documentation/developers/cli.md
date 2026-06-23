# CLI

The Wafflebase CLI lets you manage spreadsheets, word-processor
documents, and slide decks from the terminal — read/write cells,
import/export CSV and JSON, render docs as Markdown or PDF, and
round-trip `.docx` and `.pptx` files through the same Yorkie-backed
store the editor uses.

## Installation

```bash
npm install -g @wafflebase/cli
```

## Authentication

### OAuth Login (recommended)

Log in via GitHub OAuth in the browser:

```bash
wafflebase login
```

The CLI opens your browser for GitHub authentication and stores the JWT session in `~/.wafflebase/session.json`. Tokens are automatically refreshed when they expire.

To log in to a different server:

```bash
wafflebase login --server https://api.example.com
```

### Check Status

```bash
wafflebase status
```

### Logout

```bash
wafflebase logout
```

### Workspace Context Switching

If you have access to multiple workspaces:

```bash
# List workspaces (* = active)
wafflebase ctx list

# Switch active workspace
wafflebase ctx switch "Team Workspace"
wafflebase ctx switch e98ff707
```

### API Key Auth (CI/scripts)

For non-interactive environments, use API keys:

```bash
wafflebase --api-key wfb_xxx docs list
# Or via environment variable:
export WAFFLEBASE_API_KEY=wfb_xxx
```

## Configuration

The CLI resolves auth in this order: **flag/env API key > session JWT > config file API key**.

Settings resolve as: **flags > environment variables > session > config file**.

### Config File

Location: `~/.wafflebase/config.yaml`

```yaml
profiles:
  default:
    server: http://localhost:3000
    api-key: wfb_your_api_key_here
    workspace: your-workspace-id
```

You can define multiple profiles and switch between them with `--profile`:

```bash
wafflebase --profile production docs list
```

### Environment Variables

```bash
export WAFFLEBASE_SERVER=http://localhost:3000
export WAFFLEBASE_API_KEY=wfb_your_api_key
export WAFFLEBASE_WORKSPACE=your-workspace-id
```

## Global Options

| Flag | Description | Default |
|------|-------------|---------|
| `--server <url>` | Server URL | `https://api.wafflebase.io` |
| `--api-key <key>` | API key | — |
| `--workspace <id>` | Workspace ID | — |
| `--profile <name>` | Config profile | `default` |
| `--format <fmt>` | Output format: `json`, `table`, `csv` (also `md` / `text` on `docs content` and `slides content`, `pdf` / `docx` on `docs export`, `pptx` on `slides export`) | `json` |
| `--quiet` | Suppress output | `false` |
| `--verbose` | Verbose output | `false` |
| `--dry-run` | Show request without executing | `false` |

## Namespace Layout

The command tree groups commands under plural namespaces:

- **`docs`** — manage and read both spreadsheet and word-processor documents
- **`sheets`** — spreadsheet-specific operations (tabs, cells, CSV/JSON import/export)
- **`slides`** — slide-deck operations (read content, import/export `.pptx`)
- **`api-keys`** — workspace API key management
- **`ctx`**, **`schema`**, **`login`/`logout`/`status`** — top-level utilities

Singular forms (`doc`, `sheet`, `tab`, `cell`, `api-key`) work as
aliases for back-compat with earlier scripts; new code should prefer
the plural canonical names.

## docs (aliases: doc, document, documents)

Manage documents and read their content. Works for both spreadsheets
(`type: sheet`) and word-processor docs (`type: doc`).

### Document management

```bash
# List all documents
wafflebase docs list
wafflebase docs list --type doc        # only word-processor docs
wafflebase docs list --type sheet      # only spreadsheets

# Create a new sheet (default)
wafflebase docs create "Q1 Report"

# Create a new word-processor document
wafflebase docs create "Meeting Notes" --type doc

# Get document metadata
wafflebase docs get <doc-id>

# Rename a document
wafflebase docs rename <doc-id> "New Title"

# Delete a document
wafflebase docs delete <doc-id>
```

| Option | Description | Default |
|--------|-------------|---------|
| `--type <type>` | Document type: `sheet` or `doc` (on `list`/`create`) | `sheet` (`create`) |

### docs content

Read a word-processor document as JSON, Markdown, or plain text.

```bash
# Default JSON
wafflebase docs content <doc-id>

# GitHub-Flavoured Markdown for human reading or LLM input
wafflebase docs content <doc-id> --format md

# Plain text (one block per line, no formatting)
wafflebase docs content <doc-id> --format text

# Slice by page range (1-based; clamps with stderr warning)
wafflebase docs content <doc-id> --pages 1-3,5

# Include header/footer regions (md/text only — JSON always includes them)
wafflebase docs content <doc-id> --format md --include-header-footer

# Inline data: image URLs (md only)
wafflebase docs content <doc-id> --format md --inline-images

# Save to a file (refuses to overwrite without --force)
wafflebase docs content <doc-id> --format md --out summary.md
wafflebase docs content <doc-id> --format md --out summary.md --force
```

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | `json`, `md`, `text` | `json` |
| `--pages <range>` | Page selection (e.g. `1-3,5`) | all pages |
| `--include-header-footer` | Emit header/footer in `md`/`text` | `false` |
| `--inline-images` | Emit `data:` image URLs verbatim (md only) | `false` |
| `--out <file>` | Write to file (`-` for stdout) | stdout |
| `--force` | Overwrite existing output file | `false` |

::: info
On a spreadsheet document, `docs content` returns a structured
`TYPE_MISMATCH` error pointing at `sheets cells get` instead.
:::

### docs export

Export a word-processor document to PDF or DOCX.

```bash
# Whole-document PDF (auto-detected from extension)
wafflebase docs export <doc-id> output.pdf

# PDF page subset (full PDF rendered, then non-selected pages dropped)
wafflebase docs export <doc-id> output.pdf --pages 1-3

# DOCX export (full document only — DOCX has no page concept)
wafflebase docs export <doc-id> output.docx

# Pipe binary to stdout
wafflebase docs export <doc-id> - --format pdf > out.pdf

# Overwrite an existing file
wafflebase docs export <doc-id> output.pdf --force
```

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | `pdf` or `docx`; auto-detected from filename extension | from extension |
| `--pages <range>` | Page selection (PDF only — DOCX warns + ignores) | all pages |
| `--include-header-footer` | Include header/footer regions | `true` |
| `--force` | Overwrite existing target file | `false` |

::: info
First-time PDF export on a Korean document downloads Noto Sans/Serif
KR (~5 MB per variant) once. The font is cached for subsequent runs.
:::

### docs import

Import a `.docx` as a new document or replace an existing one.

```bash
# Default — POST a new doc + PUT its content
wafflebase docs import draft.docx
wafflebase docs import draft.docx --title "Final Draft"

# Read from stdin
cat draft.docx | wafflebase docs import -

# Replace an existing doc (destructive — requires --yes on non-TTY)
wafflebase docs import revision.docx --replace <doc-id> --yes

# Preview the requests without executing
wafflebase docs import draft.docx --dry-run
wafflebase docs import revision.docx --replace <doc-id> --dry-run
```

| Option | Description | Default |
|--------|-------------|---------|
| `--title <title>` | New document title | file basename (or `Untitled` for stdin) |
| `--replace <doc-id>` | Existing document to overwrite | — |
| `--yes` | Skip the confirmation prompt under `--replace` | `false` |

`--replace` without `--yes` on a non-TTY shell exits 1 with
`{"error":{"code":"CONFIRMATION_REQ"}}`.

## sheets (aliases: sheet, spreadsheet, spreadsheets)

Spreadsheet-specific commands. The `tabs` and `cells` subcommands work
on documents of `type: sheet`; on a doc-typed document the backend
returns `TYPE_MISMATCH`.

### sheets tabs

```bash
# List tabs in a spreadsheet
wafflebase sheets tabs list <doc-id>
```

### sheets cells

```bash
# Get all cells (default tab)
wafflebase sheets cells get <doc-id>

# Get a specific cell
wafflebase sheets cells get <doc-id> A1

# Get a range
wafflebase sheets cells get <doc-id> A1:C10

# Specify a tab
wafflebase sheets cells get <doc-id> A1:C10 --tab tab-2

# Set a cell value
wafflebase sheets cells set <doc-id> A1 "Revenue"

# Set a formula
wafflebase sheets cells set <doc-id> B2 "=SUM(A1:A10)" --formula

# Delete a cell
wafflebase sheets cells delete <doc-id> A1

# Batch update (inline JSON)
wafflebase sheets cells batch <doc-id> \
  --data '{"A1": {"value": "Name"}, "B1": {"value": "Score"}}'

# Batch update (from stdin)
echo '{"A1": {"value": "1"}, "A2": {"value": "2"}}' | \
  wafflebase sheets cells batch <doc-id>
```

### sheets import

Import CSV or JSON data into a spreadsheet tab.

```bash
# Import a CSV file
wafflebase sheets import <doc-id> data.csv

# Import a JSON file
wafflebase sheets import <doc-id> data.json

# Import from stdin
cat data.csv | wafflebase sheets import <doc-id> -

# Import starting at a specific cell
wafflebase sheets import <doc-id> data.csv --start C5

# Target a specific tab
wafflebase sheets import <doc-id> data.csv --tab tab-2

# Preview without writing
wafflebase sheets import <doc-id> data.csv --dry-run
```

| Option | Description | Default |
|--------|-------------|---------|
| `--tab <tab-id>` | Target tab | `tab-1` |
| `--file-format <fmt>` | File format (`csv`, `json`) | auto-detected |
| `--start <ref>` | Top-left cell for import | `A1` |

JSON input accepts an array of arrays or an array of objects:

```json
[
  { "Name": "Alice", "Score": 95 },
  { "Name": "Bob", "Score": 87 }
]
```

### sheets export

Export tab data to a CSV or JSON file.

```bash
# Export to CSV
wafflebase sheets export <doc-id> output.csv

# Export to JSON
wafflebase sheets export <doc-id> output.json

# Export a specific range
wafflebase sheets export <doc-id> output.csv --range A1:D100

# Export to stdout (pipe-friendly)
wafflebase sheets export <doc-id> - --file-format csv | head -20
```

| Option | Description | Default |
|--------|-------------|---------|
| `--tab <tab-id>` | Source tab | `tab-1` |
| `--range <range>` | Cell range to export | all data |
| `--file-format <fmt>` | File format (`csv`, `json`) | auto-detected |

## slides (aliases: slide, deck)

Manage slide decks (`type: slides`) and read or convert their content.

### Deck management

```bash
# List slide decks (filtered to type=slides)
wafflebase slides list

# Create a new deck
wafflebase slides create "Kickoff Deck"

# Get deck metadata
wafflebase slides get <doc-id>

# Rename a deck
wafflebase slides rename <doc-id> "New Title"

# Delete a deck
wafflebase slides delete <doc-id>
```

### slides content

Read a deck as JSON, Markdown, or plain text. `json` returns the raw
`SlidesDocument`; `md`/`text` extract per-slide text (text boxes, shape
labels, table cells, flattened groups).

```bash
# Default JSON (raw SlidesDocument)
wafflebase slides content <doc-id>

# Markdown / plain text — one section per slide
wafflebase slides content <doc-id> --format md
wafflebase slides content <doc-id> --format text

# Include speaker notes (md/text only)
wafflebase slides content <doc-id> --format md --notes

# Save to a file (refuses to overwrite without --force)
wafflebase slides content <doc-id> --format md --out deck.md --force
```

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | `json`, `md`, `text` | `json` |
| `--notes` | Include speaker notes in `md`/`text` | `false` |
| `--out <file>` | Write to file (`-` for stdout) | stdout |
| `--force` | Overwrite existing output file | `false` |

::: info
On a non-slides document, `slides content` surfaces a structured
`TYPE_MISMATCH` error on stderr, so agents reading the `code` field
can route to `docs content` or `sheets cells get` instead.
:::

### slides export

Export a deck to PPTX. The writer is the inverse of the PPTX importer
and covers text, shapes (preset + freeform), images (crop/recolor/
opacity/brightness), tables, connectors, nested groups, drop-shadow/
reflection effects, theme/master/layout, speaker notes, and best-effort
transitions + object animations.

```bash
# Auto-detected from the .pptx extension
wafflebase slides export <doc-id> deck.pptx

# Explicit format (only "pptx" is supported)
wafflebase slides export <doc-id> out --format pptx

# Pipe binary to stdout
wafflebase slides export <doc-id> - --format pptx > deck.pptx

# Overwrite an existing file
wafflebase slides export <doc-id> deck.pptx --force
```

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | Only `pptx`; auto-detected from a `.pptx` extension | from extension |
| `--force` | Overwrite existing target file | `false` |

### slides import

Import a `.pptx` as a new deck or replace an existing one.

```bash
# Default — create a new deck from the .pptx
wafflebase slides import deck.pptx
wafflebase slides import deck.pptx --title "Roadmap"

# Replace an existing deck (destructive — requires --yes on non-TTY)
wafflebase slides import revision.pptx --replace <doc-id> --yes

# Preview the requests without executing
wafflebase slides import deck.pptx --dry-run
```

| Option | Description | Default |
|--------|-------------|---------|
| `--title <title>` | New deck title | file basename |
| `--replace <doc-id>` | Existing deck to overwrite | — |
| `--yes` | Skip the confirmation prompt under `--replace` | `false` |

## api-keys (alias: api-key)

Manage API keys for programmatic access.

```bash
# Create a new API key (printed once — copy it now)
wafflebase api-keys create "My Integration"

# List API keys (raw key never re-shown)
wafflebase api-keys list

# Revoke an API key
wafflebase api-keys revoke <key-id>
```

## schema

Inspect available commands and their parameters. Aliases resolve to
the canonical plural name.

```bash
# List all commands
wafflebase schema

# Describe a specific command
wafflebase schema docs.content
wafflebase schema sheets.cells.get
wafflebase schema slides.export

# Singular aliases also resolve
wafflebase schema cell.get        # → sheets.cells.get
wafflebase schema doc.list        # → docs.list
```

`docs.import` exposes a `variants` field that spells out the safety
split — `default → write` (creates a new doc), `--replace given →
destructive` (overwrites in place) — so AI agents know when to
prompt for extra confirmation.

## Output Formats

### JSON (default)

```bash
$ wafflebase docs list
[
  {"id": "abc-123", "title": "Q1 Report", "type": "sheet"},
  {"id": "def-456", "title": "Meeting Notes", "type": "doc"}
]
```

### Table

```bash
$ wafflebase --format table docs list
┌─────────┬───────────────┬───────┐
│ ID      │ Title         │ Type  │
├─────────┼───────────────┼───────┤
│ abc-123 │ Q1 Report     │ sheet │
│ def-456 │ Meeting Notes │ doc   │
└─────────┴───────────────┴───────┘
```

### CSV

```bash
$ wafflebase --format csv sheets cells get abc-123 A1:B3
A1,Revenue
A2,1000
B1,Expenses
B2,500
```

## Examples

### Import CSV, add formulas, export results

```bash
# Import raw data
wafflebase sheets import abc-123 sales.csv

# Add a SUM formula
wafflebase sheets cells set abc-123 C1 "=SUM(B2:B100)" --formula

# Export results
wafflebase sheets export abc-123 report.csv --range A1:C100
```

### DOCX → Wafflebase → PDF round-trip

```bash
# Import .docx as a new document, capture id
DOC_ID=$(wafflebase docs import draft.docx --format json | jq -r '.id')

# Optional: eyeball the imported content as Markdown
wafflebase docs content "$DOC_ID" --format md

# Render to PDF (consistent fonts, regardless of local Word install)
wafflebase docs export "$DOC_ID" final.pdf
```

### Doc → Markdown → LLM analysis

```bash
wafflebase docs content <doc-id> --format md --quiet > /tmp/doc.md
cat /tmp/doc.md | claude "Summarize this in 5 bullet points"
```

### Script: populate a sheet from inline data

```bash
wafflebase sheets cells batch abc-123 --data '{
  "A1": {"value": "Name"},
  "B1": {"value": "Email"},
  "A2": {"value": "Alice"},
  "B2": {"value": "alice@example.com"}
}'
```

### Dry-run mode

```bash
$ wafflebase --dry-run sheets cells set abc-123 A1 "Hello"
{
  "dry_run": true,
  "method": "PUT",
  "url": "http://localhost:3000/api/v1/workspaces/.../tabs/tab-1/cells/A1",
  "body": { "value": "Hello" }
}
```

## Skills (for AI Agents)

The CLI ships namespace-prefixed skill files in
`packages/cli/skills/` so AI agents (Claude Code, Cursor, etc.) can
discover commands by intent: `sheets-read-cells.md`,
`sheets-write-cells.md`, `docs-manage.md`, `docs-read-content.md`,
`docs-export-pdf.md`, `docs-export-docx.md`, `docs-import-docx.md`,
`slides-manage.md`, `slides-read-content.md`, `slides-export-pptx.md`,
`slides-import-pptx.md`, plus recipes (`recipe-csv-pipeline.md`,
`recipe-docx-to-pdf.md`, `recipe-doc-to-markdown.md`, …). See
`skills/SKILL.md` for the index
and how the safety levels (`read-only` / `write` / `destructive`) map
to agent confirmation behavior.
