---
name: docs-read-content
description: Read a Wafflebase word-processor document as JSON, Markdown, or plain text
safety: read-only
tools:
  - wafflebase docs content
---

# Read Document Content

## When to Use

When the user wants to inspect, summarize, or feed a word-processor document into another tool. Three output shapes:

- `json` — full structural fidelity; preserves blocks, inlines, styles, tables, page metadata
- `md` — GitHub-Flavoured Markdown for human reading or LLM input (lossy: alignment, color, font, sup/sub, underline are dropped)
- `text` — plain text, one block per line (drops all formatting and table structure)

## Commands

### Default JSON

```bash
wafflebase docs content <doc-id>
```

### Markdown for analysis

```bash
wafflebase docs content <doc-id> --format md
```

The CLI emits a one-line `Lossy conversion: …` notice on stderr when
`--format md` is used. Suppress it with `--quiet` when piping to
another command.

### Plain text

```bash
wafflebase docs content <doc-id> --format text
```

### Read only specific pages

```bash
wafflebase docs content <doc-id> --pages 1-3,5
```

`--pages` paginates with the CLI's fontkit measurer (no Canvas
required) and slices blocks whose lines intersect any requested page.
A spanning block appears once. Out-of-range pages clamp with a stderr
warning.

### Include header/footer (Markdown / text only)

```bash
wafflebase docs content <doc-id> --format md --include-header-footer
```

JSON output always includes the document's `header`/`footer` regions
verbatim — the flag affects only the linear-stream serializers.

### Inline image data (Markdown only)

```bash
wafflebase docs content <doc-id> --format md --inline-images
```

Without `--inline-images`, `data:` image URLs render as `[image]` to
keep the Markdown terminal-friendly.

### Save to a file

```bash
wafflebase docs content <doc-id> --format md --out summary.md
wafflebase docs content <doc-id> --format md --out summary.md --force   # overwrite
```

`--out -` writes to stdout (the default behavior anyway).

## Type Mismatch

If the document is a spreadsheet (`type: sheet`), the backend returns:

```json
{ "error": { "code": "TYPE_MISMATCH", "message": "Use 'sheets cells get' for spreadsheet documents" } }
```

Switch to `wafflebase sheets cells get <doc-id>` in that case.

## Safety

`read-only`. Safe to execute without user confirmation.
