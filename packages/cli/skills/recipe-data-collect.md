---
name: recipe-data-collect
description: Collect and compare data across multiple Wafflebase documents
safety: read-only
---

# Collect Data Across Documents

## When to Use

When the user wants to gather, compare, or aggregate data from multiple
spreadsheet documents into a single view.

## Steps

### 1. List available documents

```bash
wafflebase doc list
```

### 2. Inspect each document's tabs

```bash
wafflebase tab list <doc-id-1>
wafflebase tab list <doc-id-2>
```

### 3. Read target ranges from each document

```bash
wafflebase cell get <doc-id-1> A1:D50 --format json > /tmp/doc1.json
wafflebase cell get <doc-id-2> A1:D50 --format json > /tmp/doc2.json
```

### 4. Combine and analyze

Use `jq` or any scripting tool to merge the results:

```bash
jq -s '.[0] + .[1]' /tmp/doc1.json /tmp/doc2.json > /tmp/combined.json
```

### 5. Optionally write aggregated results to a new document

```bash
DOC_ID=$(wafflebase doc create "Combined Report" --format json | jq -r '.id')
# Convert combined data to batch format and write
wafflebase cell batch "$DOC_ID" --data "$(cat /tmp/batch.json)"
```

## Notes

- All read operations are read-only and safe to execute without confirmation.
- Writing combined results to a new document requires write confirmation.
- For large documents, read specific ranges rather than all cells.
