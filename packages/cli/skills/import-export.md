---
name: import-export
description: Import and export spreadsheet data as CSV or JSON files
safety: write (import), read-only (export)
tools:
  - wafflebase import
  - wafflebase export
---

# Import / Export

## When to Use

When the user wants to load data from a file into a spreadsheet or save spreadsheet data to a file. Supports CSV and JSON formats, piping via stdin/stdout.

## Import

### Import a CSV file

```bash
wafflebase import <doc-id> data.csv
```

### Import a JSON file

```bash
wafflebase import <doc-id> data.json
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
cat data.csv | wafflebase import <doc-id> -
```

### Options

- `--tab <tab-id>` — target tab (default: `tab-1`)
- `--format csv|json` — override auto-detection from file extension
- `--no-header` — treat the first row as data, not a header (CSV only)
- `--start <ref>` — top-left cell to begin import (default: `A1`)

### Import to a specific position

```bash
wafflebase import <doc-id> data.csv --start C5
```

### Dry-run import

```bash
wafflebase import <doc-id> data.csv --dry-run
```

## Export

### Export to a CSV file

```bash
wafflebase export <doc-id> output.csv
```

### Export to JSON

```bash
wafflebase export <doc-id> output.json
```

### Export a range

```bash
wafflebase export <doc-id> output.csv --range A1:D100
```

### Export to stdout (pipe-friendly)

```bash
wafflebase export <doc-id> - --format csv | head -20
```

### Options

- `--tab <tab-id>` — source tab (default: `tab-1`)
- `--range <range>` — cell range to export (default: all data)
- `--format csv|json` — override auto-detection from file extension

## Safety

- **import** is `write` — modifies cell data. Use `--dry-run` to preview.
- **export** is `read-only` — no data is modified. Safe to execute without confirmation.
