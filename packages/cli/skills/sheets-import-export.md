---
name: sheets-import-export
description: Import and export spreadsheet data as CSV or JSON files
safety: write (import), read-only (export)
tools:
  - wafflebase sheets import
  - wafflebase sheets export
---

# Import / Export (Sheets)

## When to Use

When the user wants to load data from a file into a spreadsheet or save spreadsheet data to a file. Supports CSV and JSON formats, piping via stdin/stdout.

## Import

### Import a CSV file

```bash
wafflebase sheets import <doc-id> data.csv
```

### Import a JSON file

```bash
wafflebase sheets import <doc-id> data.json
```

JSON can be an array of arrays or an array of objects:

```json
[
  { "Name": "Alice", "Score": 95 },
  { "Name": "Bob", "Score": 87 }
]
```

### Import from stdin

```bash
cat data.csv | wafflebase sheets import <doc-id> -
```

### Options

- `--tab <tab-id>` — target tab (default: `tab-1`)
- `--file-format csv|json` — override auto-detection from file extension
- `--start <ref>` — top-left cell to begin import (default: `A1`)

### Import to a specific position

```bash
wafflebase sheets import <doc-id> data.csv --start C5
```

### Dry-run import

```bash
wafflebase sheets import <doc-id> data.csv --dry-run
```

## Export

### Export to a CSV file

```bash
wafflebase sheets export <doc-id> output.csv
```

### Export to JSON

```bash
wafflebase sheets export <doc-id> output.json
```

### Export a range

```bash
wafflebase sheets export <doc-id> output.csv --range A1:D100
```

### Export to stdout (pipe-friendly)

```bash
wafflebase sheets export <doc-id> - --file-format csv | head -20
```

### Options

- `--tab <tab-id>` — source tab (default: `tab-1`)
- `--range <range>` — cell range to export (default: all data)
- `--file-format csv|json` — override auto-detection from file extension

## Note

These commands operate on **spreadsheet** documents only. For
word-processor (`type: doc`) documents, use:

- `wafflebase docs export <doc-id> <file.pdf|docx>` — see `docs-export-pdf.md` / `docs-export-docx.md`
- `wafflebase docs import <file.docx>` — see `docs-import-docx.md`

## Safety

- **sheets import** is `write` — modifies cell data. Use `--dry-run` to preview.
- **sheets export** is `read-only` — no data is modified. Safe to execute without confirmation.
