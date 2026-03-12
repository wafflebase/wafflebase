---
name: write-cells
description: Write cell data to a Wafflebase spreadsheet
safety: write
tools:
  - wafflebase cell set
  - wafflebase cell batch
  - wafflebase cell delete
---

# Write Cells

## When to Use

When the user wants to write, update, or delete cell values in a spreadsheet.

## Commands

### Set a single cell

```bash
wafflebase cell set <doc-id> <ref> <value>
wafflebase cell set <doc-id> A1 "Hello"
wafflebase cell set <doc-id> B2 "=SUM(A1:A10)"
```

### Batch update multiple cells

From inline JSON:

```bash
wafflebase cell batch <doc-id> --data '{"A1":"Name","B1":"Score","A2":"Alice","B2":"95"}'
```

From stdin (pipe from file or other command):

```bash
cat updates.json | wafflebase cell batch <doc-id>
```

### Delete a cell

```bash
wafflebase cell delete <doc-id> A1
```

## Dry-Run

Always use `--dry-run` first for write operations to show intent before executing:

```bash
wafflebase cell set <doc-id> A1 "test" --dry-run
wafflebase cell batch <doc-id> --data '{"A1":"x"}' --dry-run
wafflebase cell delete <doc-id> A1 --dry-run
```

Dry-run prints the HTTP request details without sending it.

## Safety

- `cell.set` and `cell.batch` are **write** — confirm with user or use `--dry-run` first.
- `cell.delete` is **destructive** — always confirm with user before executing.
