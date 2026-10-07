---
name: wafflebase-sheets
description: Use for Wafflebase spreadsheet work — reading ranges, analyzing or summarizing sheet data, writing cells and formulas, styles, rows/columns, tabs, charts, filters, pivots, CSV/JSON import and export, and recurring data loads into a sheet. Load the core `wafflebase` skill first for setup, links and the write protocol.
---

# Wafflebase Sheets

Follow the core `wafflebase` skill's read and write protocol; this skill
adds what is specific to spreadsheets. Exact flags: `wafflebase schema
sheets.<command>`.

## Read the shape before the data

```bash
wafflebase sheets tabs list <doc-id>                    # tab ids and names
wafflebase sheets cells get <doc-id> A1:H20 --tab <tab-id>   # a header + sample
```

`--tab` defaults to `tab-1`; on any document with more than one tab, pass
the tab id from `tabs list`. Read a header row and a sample before a
whole column, and a column before the whole sheet. Large exports go to a
file, not into context:

```bash
wafflebase sheets export <doc-id> data.csv --tab <tab-id> [--range A1:D500]
```

Formula cells report their cached value; a value of `null` right after an
API structural edit means the editor has not recalculated yet, not that
the result is empty.

## Writing cells

```bash
wafflebase sheets cells set <doc-id> B2 "Revenue" --tab <tab-id>
wafflebase sheets cells set <doc-id> C10 "=SUM(C2:C9)" --formula --tab <tab-id>
wafflebase sheets cells batch <doc-id> --tab <tab-id> --data '{"A1":"Name","B1":"=TODAY()","C1":null}'
```

In a batch, a bare value is a value, a leading `=` makes it a formula,
and `null` deletes the cell. Prefer one batch over many `set` calls: it
is one confirmation for the user and one change in the document.

## Structure, styles and rules

Rows/columns (`sheets insert | delete | move | clear`), tabs (`sheets
tabs …`), styles (`sheets styles | column-styles | row-styles |
sheet-style`), sizes (`column-widths`, `row-heights`), view (`freeze`,
`hidden`, `filter`), `merges`, `conditional-formats`,
`data-validations`, `charts`, `pivot`, `images`.

Several `… set` commands **replace the whole collection** (range styles,
merges, conditional formats, data validations, charts, sheet images):
whatever the payload omits is deleted. Always read-modify-write:

```bash
wafflebase sheets styles get <doc-id> --tab <tab-id>   # current layer
# … add or change entries in that JSON …
wafflebase sheets styles set <doc-id> --tab <tab-id> --data '<the whole edited array>'
```

`wafflebase schema sheets.<name>.set` says which ones replace and which
merge.

## Import and recurring loads

```bash
wafflebase docs create "Q3 metrics"                     # new sheet (default type)
wafflebase sheets import <doc-id> data.csv --tab <tab-id>
```

For "every week, load this CSV into that sheet", write a small script in
the user's repository that calls these commands, and show it to them —
do not schedule anything yourself.

## References

- [references/sheets-read-cells.md](../../references/sheets-read-cells.md)
- [references/sheets-write-cells.md](../../references/sheets-write-cells.md)
- [references/sheets-import-export.md](../../references/sheets-import-export.md)
- [references/recipe-csv-pipeline.md](../../references/recipe-csv-pipeline.md) — import → formulas → export
- [references/recipe-data-collect.md](../../references/recipe-data-collect.md) — compare data across sheets
