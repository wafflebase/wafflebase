---
name: docs-manage
description: Create, list, rename, and delete Wafflebase documents (both spreadsheets and word-processor docs)
safety: destructive
tools:
  - wafflebase docs list
  - wafflebase docs create
  - wafflebase docs get
  - wafflebase docs rename
  - wafflebase docs delete
---

# Manage Documents

## When to Use

When the user wants to create, list, inspect, rename, or delete documents — both spreadsheets (`type: sheet`) and word-processor docs (`type: doc`) live under the same `docs` namespace.

## Commands

### List all documents

```bash
wafflebase docs list
wafflebase docs list --type doc      # only word-processor docs
wafflebase docs list --type sheet    # only spreadsheets
```

### Create a document

```bash
wafflebase docs create "Q1 Report"             # default --type sheet
wafflebase docs create "Meeting Notes" --type doc
```

### Get document metadata

```bash
wafflebase docs get <doc-id>
```

### Rename a document

```bash
wafflebase docs rename <doc-id> "New Title"
```

### Delete a document

```bash
wafflebase docs delete <doc-id>
```

## Dry-Run

Use `--dry-run` for write and destructive operations:

```bash
wafflebase docs create "Test" --dry-run
wafflebase docs rename <doc-id> "New" --dry-run
wafflebase docs delete <doc-id> --dry-run
```

## Common Patterns

Create a spreadsheet and immediately populate it:

```bash
DOC_ID=$(wafflebase docs create "Report" --format json | jq -r '.id')
wafflebase sheets cells batch "$DOC_ID" --data '{"A1":"Header1","B1":"Header2"}'
```

Create a word-processor doc and import a .docx:

```bash
wafflebase docs import draft.docx --title "Final Draft"
```

## Singular Aliases

`wafflebase doc list / create / get / rename / delete` (singular)
remains accepted for back-compat with v0.3 scripts.

## Safety

- `docs.list` and `docs.get` are **read-only** — safe to execute freely.
- `docs.create` and `docs.rename` are **write** — confirm or dry-run first.
- `docs.delete` is **destructive** — always confirm with user before executing.
