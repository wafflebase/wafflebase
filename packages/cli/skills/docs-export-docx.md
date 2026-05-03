---
name: docs-export-docx
description: Export a Wafflebase word-processor document to .docx
safety: read-only
tools:
  - wafflebase docs export
---

# Export to DOCX

## When to Use

When the user wants a `.docx` copy of a word-processor document — for
editing in Word/Google Docs, archival, or downstream tools that accept
OOXML.

## Commands

### Whole document

```bash
wafflebase docs export <doc-id> output.docx
```

Format is auto-detected from the `.docx` extension. Pass
`--format docx` explicitly for non-standard filenames.

### Pipe to stdout

```bash
wafflebase docs export <doc-id> - --format docx > output.docx
```

### Overwrite

```bash
wafflebase docs export <doc-id> output.docx --force
```

Without `--force`, the CLI refuses to clobber an existing target.

## `--pages` Note

DOCX has no native page concept — Word repaginates on every open
based on the user's printer/system fonts. The CLI prints a stderr
warning ("DOCX has no page concept — exporting full document, --pages
ignored.") and exports the whole document.

To get exact page subsets, export to PDF instead — see
`docs-export-pdf.md`.

## Header / Footer

DOCX always includes the document's `header` / `footer` regions when
they exist. The `--include-header-footer` flag is accepted for parity
with the JSON/Markdown commands but does not change DOCX output.

## Safety

`read-only` (server-side). Local file writes refuse to overwrite
without `--force`.
