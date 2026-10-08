---
name: docs-export-pdf
description: Export a Wafflebase word-processor document to PDF
safety: read-only
tools:
  - wafflebase docs export
---

# Export to PDF

## When to Use

When the user wants a PDF copy of a word-processor document — for
sharing, archiving, or printing. PDF preserves layout, fonts, images,
and page boundaries.

## Commands

### Whole document

```bash
wafflebase docs export <doc-id> output.pdf
```

The format is auto-detected from the `.pdf` extension. Pass
`--format pdf` explicitly if the filename has a different extension.

### Specific pages

```bash
wafflebase docs export <doc-id> output.pdf --pages 1-3,5
```

`--pages` produces an exact subset (the full PDF is rendered, then
non-selected pages are dropped via `pdf-lib`). Out-of-range entries
clamp with a stderr warning.

### Strip header/footer

```bash
wafflebase docs export <doc-id> output.pdf --no-include-header-footer
```

Defaults to `--include-header-footer=true`.

### Overwrite an existing file

```bash
wafflebase docs export <doc-id> output.pdf --force
```

Without `--force`, the CLI refuses to clobber an existing target.

### Pipe to stdout

```bash
wafflebase docs export <doc-id> - --format pdf | gzip > out.pdf.gz
```

`-` as the target writes binary bytes to stdout.

## Korean Text

Documents containing Korean characters trigger a one-time download of
Noto Sans/Serif KR (~5 MB each variant) on first export. The fonts are
cached for subsequent runs. No configuration needed — happens
automatically.

## Safety

`read-only` from the server's perspective (read-only fetch). Local
file writes refuse to overwrite without `--force`.
