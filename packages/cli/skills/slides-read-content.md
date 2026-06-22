---
name: slides-read-content
description: Read a Wafflebase slide deck as JSON, Markdown, or plain text
safety: read-only
tools:
  - wafflebase slides content
---

# Read Slide Deck Content

## When to Use

When the user wants to inspect, summarize, or feed a slide deck into
another tool. Three output shapes:

- `json` — the full `SlidesDocument` (lossless: themes, layouts,
  masters, elements, geometry, styling all preserved)
- `md` — GitHub-Flavoured Markdown of the **text only**, one `## Slide N`
  section per slide (lossy: shapes, images, connectors, positioning,
  and theming are dropped — only text bodies are extracted)
- `text` — plain text of the extracted slide text, one block per line

## Commands

### Default JSON

```bash
wafflebase slides content <doc-id>
```

### Markdown (text extraction)

```bash
wafflebase slides content <doc-id> --format md
```

Text is pulled from text boxes, shape labels, and table cells, in
document order, per slide. Grouped elements are flattened so nested
text is included. The CLI emits a one-line `Lossy conversion: …` notice
on stderr for `md`/`text` — suppress it with `--quiet`.

### Plain text

```bash
wafflebase slides content <doc-id> --format text
```

### Include speaker notes (md / text only)

```bash
wafflebase slides content <doc-id> --format md --notes
```

Notes are emitted under a `### Notes` (md) / `Notes:` (text) subheading
after each slide's body. JSON output always carries notes verbatim on
each slide, so the flag affects only the linear-stream serializers.

### Save to a file

```bash
wafflebase slides content <doc-id> --format md --out deck.md
wafflebase slides content <doc-id> --format md --out deck.md --force   # overwrite
```

`--out -` writes to stdout (the default behavior anyway).

## Type Mismatch

If the document is a spreadsheet or word-processor doc, the backend
returns a `TYPE_MISMATCH` error directing you to the right namespace
(`sheets cells get` or `docs content`).

## Safety

`read-only`. Safe to execute without user confirmation.
