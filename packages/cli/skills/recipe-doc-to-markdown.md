---
name: recipe-doc-to-markdown
description: Pull a Wafflebase document as Markdown and pipe it to an LLM or downstream tool
safety: read-only
---

# Doc → Markdown → LLM Analysis

## When to Use

When the user wants to summarize, classify, or otherwise analyze a
word-processor document with an LLM. Markdown is the right
representation for this — it preserves structure (headings, lists,
tables) without being verbose like JSON.

## Steps

### 1. Pull the doc as Markdown

```bash
wafflebase docs content <doc-id> --format md > /tmp/doc.md
```

The CLI prints a one-line `Lossy conversion: …` notice on stderr —
use `--quiet` if you're piping further and need a clean signal.

### 2. Pipe to your LLM tool of choice

Examples (adapt to whichever CLI you have installed):

```bash
# Anthropic Claude CLI
cat /tmp/doc.md | claude "Summarize this in 5 bullet points"

# OpenAI CLI (hypothetical)
cat /tmp/doc.md | openai chat "Extract action items"

# Custom script
python analyze.py /tmp/doc.md
```

### 3. (Optional) Limit to specific pages

For very long documents, slice before piping:

```bash
wafflebase docs content <doc-id> --format md --pages 1-5 > /tmp/doc.md
```

### 4. (Optional) Include header/footer for full-page context

```bash
wafflebase docs content <doc-id> --format md --include-header-footer > /tmp/doc.md
```

## Notes

- Markdown drops alignment, color, font choice, sup/sub, underline,
  table merges, and nested tables. If those matter for your analysis,
  use `--format json` instead and walk the structured output.
- Page-number markers (e.g., `#`) survive the conversion — see the
  full mapping table in `docs/design/docs-cli.md` § 5.1.

## Safety

`read-only`. Safe to run unattended in pipelines.
