# Wafflebase CLI Skills

Skills are Markdown files that serve as self-contained instruction sets for
AI agents. Each skill describes a focused capability with command syntax,
examples, and safety notes.

## Conventions

- **Frontmatter**: Every skill has YAML frontmatter with `name`, `description`,
  `safety`, and `tools` fields.
- **Safety levels**: `read-only` (no confirmation needed), `write` (confirm or
  dry-run first), `destructive` (always confirm with user).
- **Recipes** are prefixed with `recipe-` and compose multiple skills into
  multi-step workflows.
- **Naming**: skills are namespace-prefixed (`docs-…`, `sheets-…`) so the
  filename alone tells the agent which command tree the skill targets.

## Sheets Skills

| File | Safety | Description |
|------|--------|-------------|
| [sheets-read-cells.md](sheets-read-cells.md) | read-only | Read cell data from spreadsheets |
| [sheets-write-cells.md](sheets-write-cells.md) | write / destructive | Write or delete cell values |
| [sheets-import-export.md](sheets-import-export.md) | write / read-only | Import and export spreadsheet data as CSV or JSON |

## Docs Skills

| File | Safety | Description |
|------|--------|-------------|
| [docs-manage.md](docs-manage.md) | write / destructive | Create, list, get, rename, delete documents (both types) |
| [docs-read-content.md](docs-read-content.md) | read-only | Read word-processor docs as JSON, Markdown, or plain text |
| [docs-export-pdf.md](docs-export-pdf.md) | read-only | Export a doc to PDF (with `--pages` subset) |
| [docs-export-docx.md](docs-export-docx.md) | read-only | Export a doc to .docx (full document only) |
| [docs-import-docx.md](docs-import-docx.md) | write / destructive | Import a .docx as a new or replacement doc |

## Slides Skills

| File | Safety | Description |
|------|--------|-------------|
| [slides-manage.md](slides-manage.md) | write / destructive | Create, list, get, rename, delete slide decks |
| [slides-read-content.md](slides-read-content.md) | read-only | Read a deck as JSON, Markdown, or plain text |
| [slides-import-pptx.md](slides-import-pptx.md) | write / destructive | Import a .pptx as a new or replacement deck |
| [slides-export-pptx.md](slides-export-pptx.md) | read-only | Export a deck to .pptx |

## Recipes

| File | Safety | Description |
|------|--------|-------------|
| [recipe-csv-pipeline.md](recipe-csv-pipeline.md) | write | CSV import → formula analysis → export (sheets) |
| [recipe-data-collect.md](recipe-data-collect.md) | read-only | Collect and compare data across spreadsheet documents |
| [recipe-docx-to-pdf.md](recipe-docx-to-pdf.md) | write | Round-trip a .docx through Wafflebase to produce a PDF |
| [recipe-doc-to-markdown.md](recipe-doc-to-markdown.md) | read-only | Pull a doc as Markdown and pipe it to an LLM |

## How Agents Use Skills

1. Load the relevant skill file based on the user's intent
2. Read frontmatter to understand safety level and available tools
3. Use `wafflebase schema <command>` for parameter details — both plural
   canonical names (`docs.content`, `sheets.cells.get`) and v0.3 singular
   aliases (`doc.list`, `cell.get`) resolve to the same entry
4. For write operations, run with `--dry-run` first to show intent
5. Execute commands and parse JSON output
6. On error, parse the JSON error response to decide next action
