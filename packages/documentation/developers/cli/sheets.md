---
title: Sheets
description: Command reference for reading and writing sheet tabs, cells, rows and columns, formatting, charts, and images with the wafflebase CLI.
type: reference
---

# Sheets

Reference for the `sheets` commands: tabs, cells, CSV and JSON import and export, rows and columns, and everything else on a tab.

Conventions: create a sheet with `wafflebase docs create "<title>"` (see [Documents and notes](/developers/cli/documents#manage-any-document)). `<doc-id>` is the sheet's document ID. Commands that act on a tab take `--tab <tab-id>`, which defaults to `tab-1`, the first tab of a new sheet; get other tab IDs from `sheets tabs list`. Rows, columns, and tab positions are 1-based. Every write accepts `--dry-run`. On a document that isn't a sheet, these commands fail with `400`.

## Manage tabs

```bash
wafflebase sheets tabs list <doc-id>
wafflebase sheets tabs create <doc-id> "Q2"
wafflebase sheets tabs rename <doc-id> <tab-id> "Q2 actuals"
wafflebase sheets tabs move <doc-id> <tab-id> 1
wafflebase sheets tabs duplicate <doc-id> <tab-id> "Q2 forecast"
wafflebase sheets tabs delete <doc-id> <tab-id>
```

| Command | What it does |
|---|---|
| `tabs list <doc-id>` | Lists tabs with `id`, `name`, and `type`. |
| `tabs create <doc-id> [name]` | Adds a tab. Without a name it gets the next free `SheetN`, and a taken name is made unique. `--type` accepts only `sheet`. |
| `tabs rename <doc-id> <tab-id> <name>` | Renames a tab. Fails with `404` for a missing tab, `400` for a blank name, and `409` for a name already in use. |
| `tabs move <doc-id> <tab-id> <index>` | Moves the tab to a position in the tab bar. |
| `tabs duplicate <doc-id> <tab-id> [name]` | Copies the tab and its cells next to it, named `<tab> (copy)` by default. Comments are not copied. |
| `tabs delete <doc-id> <tab-id>` | Deletes the tab and its cells. You can't delete the last tab. |

## Read and write cells

```bash
wafflebase sheets cells get <doc-id>
wafflebase sheets cells get <doc-id> A1:C10 --tab tab-2
wafflebase sheets cells set <doc-id> A1 "Revenue"
wafflebase sheets cells set <doc-id> B12 "=SUM(B2:B11)" --formula
wafflebase sheets cells delete <doc-id> A1
```

`cells get` with no range returns every non-empty cell. Each cell has `ref`, `value`, `formula`, and `style`. With `--format csv` it prints a `ref,value,formula,style` header and one row per cell.

### Write many cells at once

`cells batch` takes a JSON map of cell references from `--data` or standard input. A value starting with `=` is a formula, and `null` deletes the cell.

```bash
wafflebase sheets cells batch <doc-id> --data '{
  "A1": "Name",  "B1": "Amount",
  "A2": "Alice", "B2": "1200",
  "A3": "Bob",   "B3": "950",
  "A4": "Total", "B4": "=SUM(B2:B3)"
}'
```

The output is `{ "updated": 8 }`. An entry that is neither a value, an object, nor `null` fails with `400`. An entry can also be an object, `{ "value": "…", "formula": "…", "style": { … } }`, with a style from the [cell style keys](#cell-style-keys) table. A reference the CLI can't parse fails the whole batch with `400`, and nothing is written.

## Import and export CSV or JSON

```bash
wafflebase sheets import <doc-id> sales.csv
wafflebase sheets import <doc-id> sales.csv --tab tab-2 --start C5
cat sales.json | wafflebase sheets import <doc-id> - --file-format json
wafflebase sheets export <doc-id> sales.csv --range A1:D100
wafflebase sheets export <doc-id> - --file-format csv | head -20
```

| Command | Flag | Description | Default |
|---|---|---|---|
| `import` | `--tab <tab-id>` | Tab to write into | `tab-1` |
| | `--file-format <fmt>` | `csv` or `json` | `json` for a `.json` file, otherwise `csv` |
| | `--start <ref>` | Top-left cell for the data | `A1` |
| `export` | `--tab <tab-id>` | Tab to read | `tab-1` |
| | `--range <range>` | Cells to export, for example `A1:D100` | all cells |
| | `--file-format <fmt>` | `csv` or `json` | `json` for a `.json` file, otherwise `csv` |
| | `--raw` | CSV only: keep formulas as they are, so `sheets import` restores them | off |

`import` prints `imported` (the number of cells written) and `mode`: `grid` for ordinary data placed from `--start`, or `cells` for a file in the export layout described below.

JSON input is an array of arrays, or an array of objects whose keys become the header row:

```json
[
  { "Name": "Alice", "Amount": 1200 },
  { "Name": "Bob", "Amount": 950 }
]
```

Export writes one row per cell, not a grid: a CSV has the columns `ref,value,formula,style`, and JSON is an array of cell objects. Empty cells are left out.

CSV export puts a `'` in front of any value starting with `=`, `+`, `-`, or `@`, so a spreadsheet app opening the file can't run it as a formula. Plain numbers are not changed. Use `--raw` when the file goes straight back into `sheets import`: import recognizes the `ref,value,formula` layout, puts each cell back at its own reference, ignores `--start`, and restores formulas.

## Insert, delete, move, and clear rows and columns

These commands take a JSON body from `--data` or standard input. `axis` is `"row"` or `"column"`.

```bash
wafflebase sheets insert <doc-id> --data '{"axis": "row", "index": 2, "count": 3}'
wafflebase sheets delete <doc-id> --data '{"axis": "column", "index": 2, "count": 2}'
wafflebase sheets move <doc-id> --data '{"axis": "row", "srcIndex": 2, "count": 1, "dstIndex": 5}'
wafflebase sheets clear <doc-id> --data '{"range": "A1:C10"}'
```

| Command | Body | What it does |
|---|---|---|
| `insert` | `{ axis, index, count }` | Inserts `count` rows or columns before `index` |
| `delete` | `{ axis, index, count }` | Deletes `count` rows or columns starting at `index` |
| `move` | `{ axis, srcIndex, count, dstIndex }` | Moves a block of rows or columns. Fails with `409` if it would split merged cells or leave them across frozen rows or columns. |
| `clear` | `{ range }` | Empties the cells in the range and keeps the rows and columns |

Formulas, merged cells, formatting, validation rules, comments, and chart ranges follow the edit, as they do in the editor. One `insert` can add at most 10,000 rows or columns, and one `move` can carry at most 10,000; `delete` has no such limit. You can't change the structure of a pivot table's output tab or a tab connected to a database (`400`).

::: warning Formula results are cleared
After `insert`, `delete`, or `move`, formula cells read back with `value: null` until someone opens the sheet in the editor, which recalculates them.
:::

## Format a tab and change its view

Formatting and view settings are pairs of `get` and `set` commands with one shape:

```bash
wafflebase sheets <setting> get <doc-id> [--tab <tab-id>]
wafflebase sheets <setting> set <doc-id> [--tab <tab-id>] [--data <json>]
```

`set` reads JSON from `--data` or standard input. It accepts what the matching `get` prints, so you can read, edit, and write back:

```bash
wafflebase sheets merges get <doc-id> > merges.json
# edit merges.json
wafflebase sheets merges set <doc-id> < merges.json
```

| Setting | Payload | How `set` writes |
|---|---|---|
| `styles` | Array of `{ range, style }`, where `range` is two `{ r, c }` corners | Replaces all range styles; a range you leave out loses its style |
| `sheet-style` | One style object, or `null` | Merges into the tab's style; `null` clears it |
| `column-styles`, `row-styles` | Map of 1-based index to a style, or `null` | Merges per index; `null` clears that index |
| `column-widths`, `row-heights` | Map of 1-based index to pixels, or `null` | Merges per index; `null` resets that index |
| `freeze` | `{ "rows": n, "cols": n }` | Replaces both; a key you leave out resets to `0` |
| `hidden` | `{ "rows": [ … ], "columns": [ … ] }`, 1-based | Replaces the hidden set |
| `merges` | Map of top-left cell to `{ "rs": rows, "cs": columns }` | Replaces all merges |
| `conditional-formats` | Array of rules | Replaces all rules |
| `data-validations` | Array of rules | Replaces all rules |
| `charts` | Array of charts | Replaces all charts |
| `images` | Array of floating images | Replaces all images |
| `filter` | The filter, or `null` | Replaces it; `null` removes it |
| `pivot` | The pivot table definition, or `null` | Replaces it; `null` removes it |

Aliases: `styles` is also `style` and `range-styles`, and most other plural names have a singular form, such as `merge` and `chart`.

These examples bold and shade a header row, freeze it, and widen column A:

```bash
wafflebase sheets styles set <doc-id> --data '[
  {"range": [{"r": 1, "c": 1}, {"r": 1, "c": 4}], "style": {"b": true, "bg": "#fff2cc"}}
]'
wafflebase sheets freeze set <doc-id> --data '{"rows": 1, "cols": 0}'
wafflebase sheets column-widths set <doc-id> --data '{"1": 160}'
```

::: warning A set can delete what you leave out
`styles`, `merges`, `conditional-formats`, `data-validations`, `charts`, `images`, and `hidden` replace everything stored. Run the matching `get` first and edit its output.
:::

For the fields of a chart, rule, filter, or pivot table, run `wafflebase schema sheets.charts.set` (or the matching command). To place an image, upload it first; see [Put an image on a sheet](/developers/cli/files-and-images#put-an-image-on-a-sheet).

### Cell style keys

Styles in `cells batch`, `styles`, `sheet-style`, `column-styles`, and `row-styles` use these short keys. Any other key fails with `400 Unknown style field`.

| Key | Type | Meaning |
|---|---|---|
| `b`, `i`, `u`, `st` | boolean | Bold, italic, underline, strikethrough |
| `bt`, `br`, `bb`, `bl` | boolean | Top, right, bottom, left border |
| `tc` | string | Text color, such as `#1a73e8` |
| `bg` | string | Fill color |
| `al` | `left`, `center`, `right` | Horizontal alignment |
| `va` | `top`, `middle`, `bottom` | Vertical alignment |
| `nf` | `plain`, `number`, `currency`, `percent`, `date`, `scientific`, `accounting`, `financial`, `time`, `datetime` | Number format |
| `cu` | string | Currency code for `currency` and `accounting`, such as `USD` or `KRW` |
| `dp` | number | Decimal places |

For example, `{"nf": "currency", "cu": "USD", "dp": 2, "al": "right"}`.

## Related

- [Documents and notes](/developers/cli/documents) to create, copy, and move sheets.
- [Automation and agents](/developers/cli/automation) to run these commands in a script or CI job.
- [Sheets API](/developers/api/sheets) for the HTTP endpoints behind these commands.
- [Formulas](/sheets/formulas) for the formulas you can write into cells.
