---
name: sheets-read-cells
description: Read cell data from a Wafflebase spreadsheet
safety: read-only
tools:
  - wafflebase sheets cells get
  - wafflebase sheets tabs list
---

# Read Cells

## When to Use

When the user wants to read, inspect, or analyze spreadsheet data.

## Commands

### List tabs in a document

```bash
wafflebase sheets tabs list <doc-id>
```

### Read all cells

```bash
wafflebase sheets cells get <doc-id>
```

### Read a specific range

```bash
wafflebase sheets cells get <doc-id> A1:C10
wafflebase sheets cells get <doc-id> A1:C10 --tab <tab-id>
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
wafflebase sheets cells get abc123 A1:Z1
```

Read a data range from a specific tab:

```bash
wafflebase sheets tabs list abc123              # find the tab ID
wafflebase sheets cells get abc123 A1:D100 --tab tab-2
```

## Singular Aliases

The plural namespaces accept singular aliases for back-compat with v0.3
scripts: `sheets cell get` works the same as `sheets cells get`,
`sheet tab list` the same as `sheets tabs list`. Prefer the canonical
plural form in new code — it matches what `wafflebase --help` and
`wafflebase schema` print.

## Safety

read-only — no data is modified. Safe to execute without user confirmation.
