---
name: read-cells
description: Read cell data from a Wafflebase spreadsheet
safety: read-only
tools:
  - wafflebase cell get
  - wafflebase tab list
---

# Read Cells

## When to Use

When the user wants to read, inspect, or analyze spreadsheet data.

## Commands

### List tabs in a document

```bash
wafflebase tab list <doc-id>
```

### Read all cells

```bash
wafflebase cell get <doc-id>
```

### Read a specific range

```bash
wafflebase cell get <doc-id> A1:C10
wafflebase cell get <doc-id> A1:C10 --tab <tab-id>
```

## Output Format

Returns a JSON array of cell objects:

```json
[
  { "ref": "A1", "value": "Name", "formula": null, "style": null },
  { "ref": "B1", "value": "42", "formula": "=SUM(B2:B10)", "style": { "bold": true } }
]
```

## Examples

Read the header row:

```bash
wafflebase cell get abc123 A1:Z1
```

Read a data range from a specific tab:

```bash
wafflebase tab list abc123           # find the tab ID
wafflebase cell get abc123 A1:D100 --tab tab-2
```

## Safety

read-only — no data is modified. Safe to execute without user confirmation.
