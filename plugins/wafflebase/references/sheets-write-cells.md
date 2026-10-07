---
name: sheets-write-cells
description: Write cell data to a Wafflebase spreadsheet
safety: destructive
tools:
  - wafflebase sheets cells set
  - wafflebase sheets cells batch
  - wafflebase sheets cells delete
---

# Write Cells

## When to Use

When the user wants to write, update, or delete cell values in a spreadsheet.

## Commands

### Set a single cell

```bash
wafflebase sheets cells set <doc-id> <ref> <value>
wafflebase sheets cells set <doc-id> A1 "Hello"
wafflebase sheets cells set <doc-id> B2 "=SUM(A1:A10)" --formula
```

### Batch update multiple cells

From inline JSON:

```bash
wafflebase sheets cells batch <doc-id> --data '{"A1":"Name","B1":"Score","A2":"Alice","B2":"95"}'
```

From stdin (pipe from file or other command):

```bash
cat updates.json | wafflebase sheets cells batch <doc-id>
```

### Delete a cell

```bash
wafflebase sheets cells delete <doc-id> A1
```

## Dry-Run

Always use `--dry-run` first for write operations to show intent before executing:

```bash
wafflebase sheets cells set <doc-id> A1 "test" --dry-run
wafflebase sheets cells batch <doc-id> --data '{"A1":"x"}' --dry-run
wafflebase sheets cells delete <doc-id> A1 --dry-run
```

Dry-run prints the HTTP request details without sending it.

## Singular Aliases

`sheets cell set / batch / delete` (singular) is accepted for back-compat
with v0.3 scripts. Prefer the canonical plural form in new code.

## Safety

- `sheets.cells.set` and `sheets.cells.batch` are **write** — confirm with user or use `--dry-run` first.
- `sheets.cells.delete` is **destructive** — always confirm with user before executing.
