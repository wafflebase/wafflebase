# CLI

The Wafflebase CLI lets you manage spreadsheets, word-processor
documents, slide decks, markdown notes, and stored files from the
terminal — read/write cells, format and restructure worksheets,
import/export CSV and JSON, render docs as Markdown or PDF, and
round-trip `.docx`, `.pptx` and `.md` files through the same
Yorkie-backed store the editor uses.

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

#### Logging in to a server older than nonce-bound login

Each login generates a per-attempt nonce, carries it through the OAuth
round trip, and accepts the loopback callback only when it comes back as
`state`. That binding is what stops a web page you happen to be visiting
from hitting `http://127.0.0.1:<port>/callback?code=…` during the wait
window and leaving the CLI holding *its* session.

A backend that predates the echo redirects with no `state` at all, and the
callback is refused. `--allow-unbound-callback` accepts that stateless
shape:

```bash
wafflebase login --server https://old.example.com --allow-unbound-callback
```

| Flag | Description | Default |
|------|-------------|---------|
| `--allow-unbound-callback` | Accept a login callback that carries no state (server predates nonce-bound CLI login) | off |

Reach for it only when a current CLI has to log into a server you know is
older, and never as a habit — it prints a warning, and while it is on, any
local process that reaches the callback port can complete the login. A
*mismatched* `state` is still refused either way, since only an attacker
sends one. The fix is upgrading the server.

### Check Status

Prints the auth state as JSON — `loggedIn` tells a script or agent
whether a login prompt is needed.

```bash
wafflebase status
wafflebase status --format table   # human-readable key/value
```

### Logout

```bash
wafflebase logout
```

### Workspace Context Switching

If you have access to multiple workspaces:

```bash
# List workspaces as [{ id, name, active }]
wafflebase ctx list

# Human-readable table instead of JSON
wafflebase ctx list --format table

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

Location: `~/.wafflebase/config.yaml` (override the whole path with
`WAFFLEBASE_CONFIG`)

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
export WAFFLEBASE_CONFIG=/etc/wafflebase/ci.yaml
```

`WAFFLEBASE_CONFIG` is the one that is not a setting but a *location*: it
replaces the config-file path outright, ahead of `~/.wafflebase/config.yaml`
and ahead of the one-time migration from the older
`~/.config/wafflebase/config.yaml`. Useful for pinning a CI job to a checked-in
profile file without writing into `$HOME`.

## Global Options

| Flag | Description | Default |
|------|-------------|---------|
| `--server <url>` | Server URL | `https://api.wafflebase.io` |
| `--api-key <key>` | API key | — |
| `--workspace <id>` | Workspace ID | — |
| `--profile <name>` | Config profile | `default` |
| `--format <fmt>` | Output format: `json`, `table`, `csv`, `yaml` (also `md` / `text` on `docs content`, `slides content` and `notes content`, `pdf` / `docx` on `docs export`, `pptx` on `slides export`, `md` on `notes export`) | `json` |
| `--quiet` | Suppress progress notices; the result body and the JSON error envelope are always emitted | `false` |
| `--verbose` | Verbose output | `false` |
| `--dry-run` | Show request without executing | `false` |

## Namespace Layout

The command tree groups commands under plural namespaces:

- **`docs`** — manage and read both spreadsheet and word-processor documents
- **`sheets`** — spreadsheet-specific operations (tabs, cells, CSV/JSON import/export)
- **`slides`** — slide-deck operations (read content, import/export `.pptx`)
- **`notes`** — markdown note operations
- **`files`** — upload and download any file stored as a document
- **`images`** — the workspace image bucket the editors embed images from
- **`api-keys`** — workspace API key management
- **`ctx`**, **`schema`**, **`login`/`logout`/`status`** — top-level utilities

Singular forms work as aliases for back-compat with earlier scripts; new
code should prefer the plural canonical names. Every namespace and
sub-namespace that has one:

| Canonical | Aliases |
|-----------|---------|
| `docs` | `doc`, `document`, `documents` |
| `sheets` | `sheet`, `spreadsheet`, `spreadsheets` |
| `slides` | `slide`, `deck` |
| `notes` | `note` |
| `files` | `file` |
| `images` | `image` |
| `api-keys` | `api-key` |
| `sheets tabs` | `sheets tab` |
| `sheets cells` | `sheets cell` |
| `sheets styles` | `sheets style`, `sheets range-styles` |
| `sheets column-styles` / `row-styles` | `sheets column-style` / `row-style` |
| `sheets column-widths` / `row-heights` | `sheets column-width` / `row-height` |
| `sheets merges` | `sheets merge` |
| `sheets charts` | `sheets chart` |
| `sheets conditional-formats` | `sheets conditional-format` |
| `sheets data-validations` | `sheets data-validation` |

`sheets sheet-style`, `sheets freeze`, `sheets hidden`, `sheets filter`
and `sheets pivot` have no alias — their names are already singular.

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
`{"error":{"code":"CONFIRMATION_REQ"}}`. `--dry-run` is exempt — a
preview writes nothing, so it neither prompts nor needs `--yes`.

### docs set-content

::: danger Destructive — replaces the whole document
`set-content` overwrites a document's *entire* content with the JSON you
give it. There is no merge, no range, and no `--yes` prompt to catch a
mistake: whatever the document held is gone the moment the request lands.
Read it back with `docs content` first, and preview the write with
`--dry-run`.
:::

The write half of `docs content`. Reads JSON from `--data` or stdin and
`PUT`s it verbatim.

```bash
# From a file
wafflebase docs set-content <doc-id> < document.json

# Inline
wafflebase docs set-content <doc-id> --data '{"blocks":[]}'

# Round-trip through an edit step
wafflebase docs content <doc-id> | jq '…' | \
  wafflebase docs set-content <doc-id>

# Preview the request without writing
wafflebase docs set-content <doc-id> --data '{"blocks":[]}' --dry-run
```

| Option | Description | Default |
|--------|-------------|---------|
| `--data <json>` | Content as a JSON string | read from stdin |

The backend picks the writer from the document's **stored** type, not
from the command you typed, so a payload whose shape does not match comes
back as a `400` naming both shapes, and a spreadsheet as a `409`
`TYPE_MISMATCH`. The response is the stored content echoed back.
`wafflebase schema docs.set-content` reports it as `destructive`.

## sheets (aliases: sheet, spreadsheet, spreadsheets)

Spreadsheet-specific commands. The `tabs` and `cells` subcommands work
on documents of `type: sheet`; on a doc-typed document the backend
returns `TYPE_MISMATCH`.

### sheets tabs

```bash
# List tabs in a spreadsheet
wafflebase sheets tabs list <doc-id>

# Create a tab; the name is optional and defaults to the next SheetN
wafflebase sheets tabs create <doc-id>
wafflebase sheets tabs create <doc-id> "Q2"

# Rename a tab
wafflebase sheets tabs rename <doc-id> <tab-id> "Q2 Actuals"
```

**`sheets tabs create` options**

| Option | Description | Default |
|--------|-------------|---------|
| `--type <type>` | Tab type — only `sheet` is supported | `sheet` |

Anything other than `--type sheet` is refused locally, before the request
and before `--dry-run` prints anything: a preview of a body the server
would reject is worse than no preview. `rename` returns `404` for a
missing tab, `400` for a blank name and `409` for one already taken.

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

# Export for re-import: keep formulas as formulas
wafflebase sheets export <doc-id> output.csv --raw
```

| Option | Description | Default |
|--------|-------------|---------|
| `--tab <tab-id>` | Source tab | `tab-1` |
| `--range <range>` | Cell range to export | all data |
| `--file-format <fmt>` | File format (`csv`, `json`) | auto-detected |
| `--raw` | CSV only: write cell text verbatim | off |

CSV export prefixes anything a spreadsheet would evaluate (`=`, `+`,
`-`, `@`, with or without leading whitespace) with `'`, so opening the
file cannot execute a formula another workspace member put in a cell.
Plain numbers are untouched. `--raw` turns the guard off, which is what
you want when the file is going straight back into `sheets import`:
that command recognizes the `ref,value,formula[,style]` header this
export writes and re-imports by reference, sending each formula as a
formula rather than as text.

### sheets clear / insert / delete / move

Structural edits on a tab: empty a range, and insert, delete or move whole
rows and columns. All four take their request body as JSON from `--data`
or stdin — the endpoints *are* their bodies, so spelling the fields out as
flags would only give the CLI a copy to keep in step with the server's
parser.

```bash
# Empty a range, keeping its rows and columns
wafflebase sheets clear <doc-id> --data '{"range": "A1:C10"}'

# Insert 3 rows above row 2
wafflebase sheets insert <doc-id> --data '{"axis": "row", "index": 2, "count": 3}'

# Delete 2 columns starting at column B
wafflebase sheets delete <doc-id> --data '{"axis": "column", "index": 2, "count": 2}'

# Move one row from 2 to 5
wafflebase sheets move <doc-id> \
  --data '{"axis": "row", "srcIndex": 2, "count": 1, "dstIndex": 5}'

# Bodies pipe in from stdin, like cells batch
echo '{"axis": "row", "index": 1, "count": 1}' | \
  wafflebase sheets insert <doc-id> --tab tab-2
```

| Verb | Body | Notes |
|------|------|-------|
| `clear` | `{ range }` | Non-empty A1 range, e.g. `A1:C10` |
| `insert` | `{ axis, index, count }` | |
| `delete` | `{ axis, index, count }` | `count` is positive on the wire; the engine's negative-count convention is applied server-side |
| `move` | `{ axis, srcIndex, count, dstIndex }` | `409` if the move would split a merged range |

All four share these options:

| Option | Description | Default |
|--------|-------------|---------|
| `--tab <tab-id>` | Target tab | `tab-1` |
| `--data <json>` | Request body as JSON | read from stdin |

`axis` is `"row"` or `"column"`, and every index and count is a 1-based
positive integer — checked locally, ahead of `--dry-run`, so a preview is
never a request the server would reject. The *limits* are not checked
locally: the grid bounds and the server's `MaxAxisEntries` cap depend on
how long the axis already is, which only the backend can see, so they
arrive as its `400`.

::: warning Formula caches are cleared, not recalculated
The backend runs the same engine helpers the editor does, so formulas,
merges, styles, validations, chart ranges and comment anchors all follow
the edit — but cached formula *values* are dropped. A following
`sheets cells get` reports `value: null` for formula cells until an editor
session recalculates them.
:::

### Worksheet formatting, view state and analysis

Formatting and view state are a family of `get` / `set` pairs with one
shape: `get <doc-id> [--tab]` reads, `set <doc-id> [--tab] [--data]`
writes.

```bash
# Read
wafflebase sheets styles get <doc-id>
wafflebase sheets column-widths get <doc-id> --tab tab-2
wafflebase sheets merges get <doc-id>

# Write, inline or from stdin
wafflebase sheets sheet-style set <doc-id> --data '{"bold": true}'
wafflebase sheets freeze set <doc-id> --data '{"rows": 1, "cols": 0}'
wafflebase sheets hidden set <doc-id> --data '{"rows": [3], "columns": []}'
wafflebase sheets column-widths set <doc-id> --data '{"1": 160, "2": null}'
wafflebase sheets charts set <doc-id> < charts.json

# get | set round-trips: set accepts the envelope get prints
wafflebase sheets styles get <doc-id> | wafflebase sheets styles set <doc-id>
```

| Command | Payload | Write semantics |
|---------|---------|-----------------|
| `styles` | Array of `{ range, style }` patches (or `{ rangeStyles: [...] }`) | Replaces the layer — an omitted patch is deleted |
| `sheet-style` | One style object, or `null` (or `{ style: … }`) | Merged onto the stored sheet-wide style; `null` clears it |
| `column-styles` / `row-styles` | Map of 1-based index → style, or `null` | Merged per index; a `null` value clears that index |
| `column-widths` / `row-heights` | Map of 1-based index → number, or `null` | Merged per index; a `null` value reverts that index to the tab default |
| `freeze` | `{ rows, cols }` | Replaces both; an **omitted key resets to 0** |
| `hidden` | `{ rows: [...], columns: [...] }`, 1-based | Replaces the whole set |
| `merges` | Map of anchor ref → `{ rs, cs }` (or `{ merges: … }`) | Replaces every merge — an omitted one is removed |
| `conditional-formats` | Array of rules (or `{ rules: [...] }`) | Replaces the whole array |
| `data-validations` | Array of rules (or `{ rules: [...] }`) | Replaces the whole array |
| `charts` | Array of charts (or `{ charts: [...] }`) | Replaces every chart — an omitted one is deleted |
| `filter` | The filter object, or `null` (or `{ filter: … }`) | Replaces it; `null` clears |
| `pivot` | The pivot definition, or `null` (or `{ pivot: … }`) | Replaces it; `null` clears |

Every one of them takes the same two options on `set` (and `--tab` alone
on `get`):

| Option | Description | Default |
|--------|-------------|---------|
| `--tab <tab-id>` | Target tab | `tab-1` |
| `--data <json>` | Payload as a JSON string | read from stdin |

Each `set` accepts **either** the bare value or the same envelope its
matching `get` prints, which is what makes
`… get <doc> | … set <doc>` a round trip rather than a double-wrapped
`400`. Payload shape is validated locally, before the `--dry-run` branch,
so a preview is always the body that would actually go on the wire.

::: warning "Set" replaces more than it looks like
Several of these are whole-collection writes: `styles`, `merges`,
`charts`, `conditional-formats`, `data-validations` and `hidden` replace
what is stored rather than merging into it, so anything missing from your
payload is deleted. `wafflebase schema sheets.charts.set` (and its
siblings) reports the safety level for each. Read with the matching `get`
first.
:::

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

### slides set-content

::: danger Destructive — replaces the whole deck
`set-content` overwrites the deck's *entire* `SlidesDocument`. No merge,
no per-slide targeting, no confirmation prompt. Read it back with
`slides content` first and preview with `--dry-run`.
:::

```bash
wafflebase slides set-content <doc-id> < deck.json
wafflebase slides set-content <doc-id> --data '{"slides":[]}'
wafflebase slides content <doc-id> | jq '…' | \
  wafflebase slides set-content <doc-id>
```

| Option | Description | Default |
|--------|-------------|---------|
| `--data <json>` | Content as a JSON string | read from stdin |

Same `PUT /documents/:id/content` as `docs set-content`, and the backend
still picks the writer from the document's stored type — so pointing this
at a word-processor doc is a `400` naming both shapes, and at a
spreadsheet a `409` `TYPE_MISMATCH`.

## notes (alias: note)

Markdown notes (`type: note`). A note's content *is* one markdown string,
so nothing here converts between formats — `md` and `text` print that
string verbatim and `json` wraps it as `{ "content": "…" }`.

### Note management

```bash
# List notes (the workspace list, filtered to type=note client-side)
wafflebase notes list

# Create a new note
wafflebase notes create "Standup log"

# Get note metadata
wafflebase notes get <doc-id>

# Rename a note
wafflebase notes rename <doc-id> "New Title"

# Delete a note
wafflebase notes delete <doc-id>
```

### notes content

```bash
# Default JSON — { "content": "…" }
wafflebase notes content <doc-id>

# The markdown itself
wafflebase notes content <doc-id> --format md
wafflebase notes content <doc-id> --format text

# Save to a file (refuses to overwrite without --force)
wafflebase notes content <doc-id> --format md --out note.md --force
```

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | `json`, `md`, `text` | `json` |
| `--out <file>` | Write to file (`-` for stdout) | stdout |
| `--force` | Overwrite existing output file | `false` |

### notes export

Export a note to Markdown. `md` is the only format — the target is
required and `-` writes to stdout.

```bash
wafflebase notes export <doc-id> note.md
wafflebase notes export <doc-id> note.md --force
wafflebase notes export <doc-id> - | less
wafflebase notes export <doc-id> out --format md
```

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | Only `md` or `markdown` (both accepted, though the rejection message names just `md`); otherwise inferred from a `.md` / `.markdown` extension | from extension |
| `--force` | Overwrite existing target file | `false` |

A filename with neither a markdown extension nor an explicit `--format md` /
`--format markdown` is refused rather than guessed at.

### notes import

Import a Markdown file as a new note or replace an existing one.

```bash
# Create a new note from a file
wafflebase notes import log.md
wafflebase notes import log.md --title "Standup log"

# Read from stdin
cat log.md | wafflebase notes import -

# Replace an existing note (destructive — requires --yes on non-TTY)
wafflebase notes import log.md --replace <doc-id> --yes

# Preview the requests without executing
wafflebase notes import log.md --dry-run
```

| Option | Description | Default |
|--------|-------------|---------|
| `--title <title>` | New note title | file basename without extension (`Untitled` for stdin) |
| `--replace <doc-id>` | Existing note to overwrite | — |
| `--yes` | Skip the confirmation prompt under `--replace` | `false` |

As with `docs import`, `--replace` without `--yes` on a non-TTY shell
exits 1 with `{"error":{"code":"CONFIRMATION_REQ"}}`, and `--dry-run` is
exempt.

### notes set-content

::: danger Destructive — replaces the whole note
`set-content` overwrites the note's *entire* content. No merge, no
confirmation prompt. Read it back with `notes content` first and preview
with `--dry-run`.
:::

```bash
wafflebase notes set-content <doc-id> --data '{"content": "# New\n"}'
wafflebase notes set-content <doc-id> < note.json
```

| Option | Description | Default |
|--------|-------------|---------|
| `--data <json>` | Content as a JSON string | read from stdin |

The payload is the JSON `{ "content": "…" }` shape, not raw Markdown — to
push a `.md` file at an existing note, use `notes import --replace`.

## files (alias: file)

Store **any** file as a document. Unlike the `import` commands, nothing is
parsed — the bytes are stored verbatim and served back unchanged.

The document `type` is derived from the file's extension and decides which
viewer opens it: `.pdf` → `pdf`, `png/jpg/jpeg/gif/webp` → `image`, and
everything else → `file`, a blob with no dedicated viewer.

```bash
# Upload any file
wafflebase files upload report.pdf
wafflebase files upload archive.zip --title "Q3 backup"

# Upload into a folder
wafflebase files upload archive.zip --folder 08485320-7bf9-465e-964e-19aa9f1c7f11

# List blob documents, optionally by type
wafflebase files list
wafflebase files list --type image

# Download (defaults to the document's filename; `-` writes to stdout)
wafflebase files download <doc-id>
wafflebase files download <doc-id> ./out.zip --force

# Metadata, rename, delete
wafflebase files get <doc-id>
wafflebase files rename <doc-id> "Better name"
wafflebase files delete <doc-id>
```

**`files upload` options**

| Option | Description | Default |
|--------|-------------|---------|
| `--title <title>` | Document title | the filename, **extension included** |
| `--folder <id>` | Folder to upload into | the workspace root |

**`files download` options**

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Overwrite an existing output file | `false` |

**`files list` options**

| Option | Description | Default |
|--------|-------------|---------|
| `--type <type>` | Filter to one of `file`, `pdf`, `image` | all three |

::: tip Titles keep the extension
A blob document *is* the file, so `report.zip` is titled `report.zip` — not
`report`. This is what keeps `report.zip`, `report.pdf` and `report.png`
distinguishable in the documents list, and it is the only place an extension
survives when the storage-key sanitizer rejects it (`.c++`, for instance).
:::

::: warning Size limits
50 MB per file, except images at 25 MB. The cap is checked locally before
the bytes go over the wire.
:::

Uploading a format another namespace can parse (`.xlsx`, `.docx`, `.pptx`,
`.csv`, `.md`) still stores it as raw bytes and prints a one-line hint
pointing at the matching `import` command. The CLI does what the command
says rather than redirecting.

## images (alias: image)

The workspace image bucket — the blobs the slides, board and docs
renderers fetch embedded images from. Workspace-scoped rather than
document-scoped: an image blob carries no link back to whatever embeds it
(that reference lives in the CRDT), so there is no document id and no
`--tab` anywhere in this namespace.

```bash
# Upload an image; the response carries its id and URL
wafflebase images upload logo.png

# Download by id (defaults to writing a file named after the id)
wafflebase images get <image-id>
wafflebase images get <image-id> ./logo.png --force
wafflebase images get <image-id> - > logo.png

# Delete from the bucket
wafflebase images delete <image-id>
```

**`images get` options**

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Overwrite an existing output file | `false` |

`upload` takes no options. `get` takes only the one above and does **not** read
`--format`, since its result is bytes that are written verbatim and there is
nothing for the formatter to render. `delete` does read `--format` — its result
is a JSON envelope like any other mutation's.

::: warning Four formats, 10 MB, and no stdin
`upload` accepts `png`, `jpeg`, `gif` and `webp` only, capped at 10 MB,
both checked locally from the filename before any bytes go over the wire —
so `--dry-run` refuses to preview a request the server would reject. That
10 MB is the *image bucket's* limit and is deliberately tighter than the
25 MB `files upload` allows for an image **document**. A path of `-` is
refused (`STDIN_UNSUPPORTED`): the multipart part is named after the file
and its content type comes from the extension, and stdin has neither.
:::

The image read route sends no filename of its own, so an `images get` with
no output path writes a file named after the image id. Pick your own name
by passing one.

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
wafflebase schema notes.import
wafflebase schema images.upload

# Singular aliases also resolve
wafflebase schema cell.get        # → sheets.cells.get
wafflebase schema doc.list        # → docs.list
```

`docs.import` exposes a `variants` field that spells out the safety
split — `default → write` (creates a new doc), `--replace given →
destructive` (overwrites in place) — so AI agents know when to
prompt for extra confirmation. `slides.import` and `notes.import` carry
the same split, and so do the worksheet `set` pairs whose payload can be
`null` (`sheets.sheet-style.set`, `sheets.filter.set`,
`sheets.pivot.set`, the per-index style/width/height maps): writing a
value is `write`, clearing one is `destructive`.

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

### YAML

```bash
$ wafflebase --format yaml docs list
- id: abc-123
  title: Q1 Report
  type: sheet
- id: def-456
  title: Meeting Notes
  type: doc
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
discover commands by intent:

- **Sheets** — `sheets-read-cells.md`, `sheets-write-cells.md`,
  `sheets-import-export.md`
- **Docs** — `docs-manage.md`, `docs-read-content.md`,
  `docs-export-pdf.md`, `docs-export-docx.md`, `docs-import-docx.md`
- **Slides** — `slides-manage.md`, `slides-read-content.md`,
  `slides-export-pptx.md`, `slides-import-pptx.md`
- **Files** — `files-upload-download.md`
- **Recipes** — `recipe-csv-pipeline.md`, `recipe-data-collect.md`,
  `recipe-docx-to-pdf.md`, `recipe-doc-to-markdown.md`

See `skills/SKILL.md` for the index and how the safety levels
(`read-only` / `write` / `destructive`) map to agent confirmation
behavior.

::: info No skills for `notes` or `images` yet
Both namespaces ship as commands but have no skill file, so an agent
working from the skills alone will not discover them. Reach for
`wafflebase schema notes.import` / `wafflebase schema images.upload`
in the meantime — every command in both namespaces is in the schema
registry, aliases included.
:::
