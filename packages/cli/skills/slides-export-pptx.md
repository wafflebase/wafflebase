---
name: slides-export-pptx
description: Export a Wafflebase slide deck to .pptx
safety: read-only
tools:
  - wafflebase slides export
---

# Export to PPTX

## When to Use

When the user wants a `.pptx` copy of a slide deck — for editing in
PowerPoint/Google Slides, archival, or downstream tools that accept
OOXML presentations.

## Commands

### Whole deck

```bash
wafflebase slides export <doc-id> output.pptx
```

Format is auto-detected from the `.pptx` extension. Pass
`--format pptx` explicitly for non-standard filenames.

### Pipe to stdout

```bash
wafflebase slides export <doc-id> - --format pptx > output.pptx
```

### Overwrite

```bash
wafflebase slides export <doc-id> output.pptx --force
```

Without `--force`, the CLI refuses to clobber an existing target.

## Round-Trip Fidelity

The exporter is the inverse of the PPTX importer: every element type
(text boxes, shapes, freeform paths, images, tables, connectors, groups)
and all theme/master/layout data survive a full import → export →
re-import cycle within the documented limitations below.

## Known Limitations (v1)

- **Inline href links** on text runs are not yet wired in the exporter;
  they are preserved in the JSON model but omitted from the `.pptx` XML.
- **Connector attached-endpoints** (snapped to a shape's connection site)
  are exported as free-floating connectors; the snap relationship is
  dropped.
- Only `.pptx` format is supported — there is no PDF export from this
  command (PDF export requires Canvas rasterization and remains deferred).

## Safety

`read-only` (server-side read). Local file writes refuse to overwrite
without `--force`.
