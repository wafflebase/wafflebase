---
name: manage-docs
description: Create, list, rename, and delete Wafflebase documents
safety: write
tools:
  - wafflebase doc list
  - wafflebase doc create
  - wafflebase doc get
  - wafflebase doc rename
  - wafflebase doc delete
---

# Manage Documents

## When to Use

When the user wants to create, list, inspect, rename, or delete spreadsheet documents.

## Commands

### List all documents

```bash
wafflebase doc list
```

### Create a document

```bash
wafflebase doc create "Q1 Report"
```

### Get document details

```bash
wafflebase doc get <doc-id>
```

### Rename a document

```bash
wafflebase doc rename <doc-id> "New Title"
```

### Delete a document

```bash
wafflebase doc delete <doc-id>
```

## Dry-Run

Use `--dry-run` for write and destructive operations:

```bash
wafflebase doc create "Test" --dry-run
wafflebase doc rename <doc-id> "New" --dry-run
wafflebase doc delete <doc-id> --dry-run
```

## Common Patterns

Create a document and immediately populate it:

```bash
DOC_ID=$(wafflebase doc create "Report" --format json | jq -r '.id')
wafflebase cell batch "$DOC_ID" --data '{"A1":"Header1","B1":"Header2"}'
```

## Safety

- `doc.list` and `doc.get` are **read-only** — safe to execute freely.
- `doc.create` and `doc.rename` are **write** — confirm or dry-run first.
- `doc.delete` is **destructive** — always confirm with user before executing.
