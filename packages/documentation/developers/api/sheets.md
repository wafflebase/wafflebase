---
title: Sheets
description: Endpoints to manage a sheet's tabs, read and write cells, edit rows and columns, and set worksheet formatting, rules, charts, images, filters, and pivots.
type: reference
---

# Sheets

Endpoints to manage a sheet's tabs, read and write cells, edit rows and columns, and set worksheet formatting, rules, charts, images, filters, and pivots.

Paths are relative to `$WFB_API/workspaces/$WS/documents/$DOC`, where `$DOC` is a document of type `sheet`. Most paths also name a tab, written `$TAB` (for example `tab-1`). Authentication and error shapes are on the [REST API overview](/developers/api/). The CLI equivalent is [`wafflebase sheets`](/developers/cli/sheets).

## Conventions

- Cell references use A1 notation: `A1`, `C10`, ranges `A1:C10`. An unparseable reference is `400`.
- Row and column indices are 1-based: row `1`, column `1` (column A). The grid has 1,000,000 rows and 18,278 columns (A to ZZZ).
- Called on a document that is not a sheet, every endpoint returns `400`, for example `Cell reads are only available on sheet documents; "<id>" is a "doc" document.`
- An unknown tab is `404 Tab not found` on cell reads and on every write. A worksheet-setting `GET` on an unknown tab returns the empty default instead, so check the ID against [List tabs](#list-tabs).
- Writes reach people who have the sheet open right away.
- The API stores formulas but does not evaluate them. A formula cell's `value` is whatever the editor last calculated, or empty.

## Tabs

### List tabs

`GET /tabs`

Returns the tabs in their display order:

```json
[
  { "id": "tab-1", "name": "Sheet1", "type": "sheet" },
  { "id": "a1b2c3", "name": "Orders", "type": "datasource" }
]
```

`type` is `sheet` for a normal tab. Tabs connected to a database or lakehouse have other types. A tab can also carry a `kind`.

A sheet that nobody has opened or written to yet lists no tabs. The first write through the API creates one tab, `tab-1`, named `Sheet1`, so you can write to `tab-1` on a new sheet straight away. A write to any other tab ID on such a sheet is `404` until that tab exists.

### Add a tab

`POST /tabs`

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Tab name. Omitted or blank uses the next free `SheetN`. A name in use gets a number added |
| `type` | string | No | Only `sheet` is supported |

Returns `{ "id", "name", "type" }`. Read `name` back, because it may differ from what you sent.

### Rename a tab

`PATCH /tabs/$TAB` with `{ "name": "Q1" }`

Returns `{ "id", "name", "type" }`. A blank name is `400 name is required`; a name another tab uses is `409 Tab name "<name>" already exists.`

### Move a tab

`POST /tabs/$TAB/reorder` with `{ "index": 1 }`

Moves the tab to a 1-based position. A position past the end moves it to the end. Returns `{ "id", "index" }` with the position it landed at.

### Duplicate a tab

`POST /tabs/$TAB/duplicate`, optionally with `{ "name": "Q1 copy" }`

Copies a sheet tab and places the copy right after it, including its cells, formatting, charts, and images, but not its comments or pivot table. The default name is `<name> (copy)`. Returns `{ "id", "name", "type" }`. A tab that is not a sheet tab is `400`.

### Delete a tab

`DELETE /tabs/$TAB`

Deletes the tab and returns `{ "id", "name", "deleted": true }`.

- The last tab cannot be deleted: `409`. Delete the document instead.
- A tab that a pivot table reads from cannot be deleted until its pivot tabs are gone: `409`.

## Cells

A cell in a response looks like this:

```json
{ "ref": "B2", "value": "12500", "formula": null, "style": { "b": true } }
```

`value` is a string. `formula` and `style` are `null` when the cell has none. A formula cell written through the API has an empty `value` until the editor calculates it.

### Read cells

`GET /tabs/$TAB/cells`

Returns every stored cell in the tab. Add `?range=A1:C10` to return only cells in that range. `range` must be two corners; a single reference such as `A1`, or anything else that does not parse, returns every cell.

```bash
curl -s -H "Authorization: Bearer $WFB_KEY" \
  "$WFB_API/workspaces/$WS/documents/$DOC/tabs/tab-1/cells?range=A1:D20"
```

### Read one cell

`GET /tabs/$TAB/cells/<ref>`

Returns one cell. An empty cell comes back with `value`, `formula`, and `style` all `null`, not `404`.

### Write one cell

`PUT /tabs/$TAB/cells/<ref>`

| Field | Type | Description |
|---|---|---|
| `value` | string | Value to store |
| `formula` | string | Formula, such as `=SUM(B2:B4)` |
| `style` | object | Style keys to set; see [Cell style keys](#cell-style-keys). Merged onto the existing style |

Every field is optional and only what you send changes. Returns what you sent, with `ref`.

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"value": "Revenue", "style": {"b": true, "al": "center"}}' \
  "$WFB_API/workspaces/$WS/documents/$DOC/tabs/tab-1/cells/B1"
```

This writes a bold, centered header into `B1`.

### Clear one cell

`DELETE /tabs/$TAB/cells/<ref>`

Removes the cell's value, formula, and style. Returns `{ "ref", "deleted": true }`.

### Write many cells

`PATCH /tabs/$TAB/cells` with `{ "cells": { ... } }`

`cells` maps references to entries. Each entry is one of:

| Entry | Meaning |
|---|---|
| `{ "value", "formula", "style" }` | The same fields as [Write one cell](#write-one-cell) |
| `"Alice"` or `12500` | A value |
| `"=SUM(B2:B4)"` | A string starting with `=` is a formula |
| `null` | Clear the cell |

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"cells": {"A1": "Rep", "B1": {"value": "Revenue", "style": {"b": true}}, "B5": "=SUM(B2:B4)", "C1": null}}' \
  "$WFB_API/workspaces/$WS/documents/$DOC/tabs/tab-1/cells"
```

Returns `{ "updated": <number of entries> }`. Every entry is checked before anything is written, so one bad reference, entry, or style fails the whole request with `400` and changes nothing.

### Cell style keys

`style` objects accept only these keys. Any other key is `400 Unknown style field '<key>'`.

| Key | Type | Meaning |
|---|---|---|
| `b`, `i`, `u`, `st` | boolean | Bold, italic, underline, strikethrough |
| `bt`, `br`, `bb`, `bl` | boolean | Border on the top, right, bottom, left |
| `tc`, `bg` | string | Text color, fill color, such as `#1D4ED8` |
| `cu` | string | Currency code for the `currency` format, such as `USD` |
| `al` | `left`, `center`, `right` | Horizontal alignment |
| `va` | `top`, `middle`, `bottom` | Vertical alignment |
| `nf` | `plain`, `number`, `currency`, `percent`, `date`, `scientific`, `accounting`, `financial`, `time`, `datetime` | Number format |
| `dp` | number | Decimal places |

## Rows and columns

These edit the grid the way the editor does: formulas, merges, styles, rules, comments, filters, hidden rows and columns, freeze panes, and charts or pivots on other tabs follow the change. Each takes `axis` (`"row"` or `"column"`) and 1-based indices.

Two things differ from the editor:

- Formula results on the tab are cleared, not recalculated. `GET .../cells` shows an empty `value` for formula cells until the sheet is recalculated in the editor.
- A move that would split a merged range is refused with `409` instead of doing nothing.

### Clear a range

`POST /tabs/$TAB/clear` with `{ "range": "A2:D50" }`

Empties the cells and keeps the rows and columns. A single reference such as `"A1"` works. Up to 1,000,000 cells. Returns `{ "cleared": <cells removed> }`.

### Insert rows or columns

`POST /tabs/$TAB/insert` with `{ "axis": "row", "index": 2, "count": 3 }`

Inserts `count` rows or columns before `index`. Returns the body.

### Delete rows or columns

`POST /tabs/$TAB/delete` with `{ "axis": "column", "index": 3, "count": 1 }`

Deletes `count` rows or columns starting at `index`. Returns the body.

### Move rows or columns

`POST /tabs/$TAB/move` with `{ "axis": "row", "srcIndex": 5, "count": 2, "dstIndex": 2 }`

Moves the block that starts at `srcIndex` so it lands before `dstIndex`. A `dstIndex` inside the block is `400`. Returns the body.

### Limits

| Rule | What happens |
|---|---|
| Indices and `index + count - 1` must stay inside the grid | `400` |
| One insert or move may add at most 10,000 rows or columns to the tab, counting the space it fills up to `index` | `400`. Insert near the existing data, or split the request |
| A move's `count` is at most 10,000 | `400` |
| Delete has no count limit inside the grid | Deleting every row is one call |
| A move would leave a merged range across frozen rows or columns | `409` |
| Insert, delete, or move on a database, lakehouse, or pivot output tab | `400`. Those tabs are rebuilt from their source |

## Worksheet settings

Each setting is a `GET` and `PUT` pair on a tab. `PUT` replaces the whole setting unless the section says otherwise. `GET` returns the same shape `PUT` takes, so read before you write.

### Freeze panes

`GET` or `PUT /tabs/$TAB/freeze` with `{ "rows": 1, "cols": 0 }`

Each is 0 to 1,000; omitted means `0`, so `PUT {}` unfreezes. If the line would cut a merged range in half, it moves past the range, or to `0` when that would pass 1,000. The response is what was stored, so compare it with what you sent.

### Hidden rows and columns

`GET` or `PUT /tabs/$TAB/hidden` with `{ "rows": [3, 4], "columns": [2] }`

1-based indices. Omitted lists are empty, so `PUT {}` shows everything.

### Merged cells

`GET` or `PUT /tabs/$TAB/merges` with `{ "merges": { "A1": { "rs": 2, "cs": 3 } } }`

Each key is the top-left cell of a merge; `rs` and `cs` are its row and column span.

- A key must be a single cell, such as `A1`, not a range.
- One merge covers at most 100,000 cells; a tab holds at most 10,000 merges covering at most 1,000,000 cells. More is `400`.
- A merge across the tab's frozen rows or columns is `409`. Change the freeze first.

### Range styles

`GET` or `PUT /tabs/$TAB/range-styles` with `{ "rangeStyles": [ ... ] }`

Styles applied to ranges, the way the editor stores the formatting of a selection. Each entry is a `range` of two corners, `{ "r": row, "c": column }`, and a `style` with the [cell style keys](#cell-style-keys). This entry fills `A1:D1`:

```json
{ "rangeStyles": [{ "range": [{ "r": 1, "c": 1 }, { "r": 1, "c": 4 }], "style": { "bg": "#FEF9C3" } }] }
```

`PUT` replaces every entry. An entry the editor would not accept is `400 rangeStyles[<i>] is not a valid range style patch`.

### Sheet style

`GET` or `PUT /tabs/$TAB/sheet-style` with `{ "style": { "tc": "#18181B" } }`

The default style for the whole tab. The object is merged onto the stored style; `{ "style": null }` clears it. A body without `style` is `400`, so a typo never clears formatting.

### Column and row formatting and sizes

| Path | Body field | Value per index |
|---|---|---|
| `/tabs/$TAB/column-styles` | `columnStyles` | Cell style object or `null` |
| `/tabs/$TAB/row-styles` | `rowStyles` | Cell style object or `null` |
| `/tabs/$TAB/column-widths` | `columnWidths` | Width in pixels or `null` |
| `/tabs/$TAB/row-heights` | `rowHeights` | Height in pixels or `null` |

Keys are 1-based indices as strings. Unlike the other settings, these `PUT`s change only the indices you send; `null` resets one. Each returns the full map.

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"columnWidths": {"1": 180, "2": null}}' \
  "$WFB_API/workspaces/$WS/documents/$DOC/tabs/tab-1/column-widths"
```

This makes column A 180 pixels wide and resets column B.

### Conditional formats and data validation

`GET` or `PUT /tabs/$TAB/conditional-formats` with `{ "rules": [ ... ] }`

`GET` or `PUT /tabs/$TAB/data-validations` with `{ "rules": [ ... ] }`

`PUT` replaces every rule; a rule you leave out is deleted. A rule the editor would not accept is `400 rules[<i>] is not a valid conditional format rule` (or `data validation rule`). Create one rule in the editor and `GET` it to see the shape.

### Charts

`GET` or `PUT /tabs/$TAB/charts` with `{ "charts": [ ... ] }`

`PUT` replaces every chart on the tab; a chart you leave out is deleted.

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Unique on the tab. A repeated ID is `400` |
| `type` | Yes | `bar`, `line`, `area`, `pie`, or `scatter` |
| `sourceTabId`, `sourceRange` | Yes | Where the data is, such as `tab-1` and `A1:C7` |
| `anchor` | Yes | Cell the chart is placed from, such as `E2` |
| `offsetX`, `offsetY` | Yes | Offset from the anchor in pixels |
| `width`, `height` | Yes | Size in pixels, greater than 0 |
| `title`, `xAxisColumn`, `colorPalette` | No | Strings |
| `seriesColumns` | No | Array of strings |
| `legendPosition` | No | `top`, `bottom`, `right`, `left`, or `none` |
| `showGridlines` | No | Boolean |

### Floating images

`GET` or `PUT /tabs/$TAB/images` with `{ "images": [ ... ] }`

Images placed over the grid. [Upload the image](/developers/api/documents-and-folders#upload-an-image) first and use its `url` as `src`. `PUT` replaces every image on the tab.

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Unique on the tab |
| `src` | Yes | Image URL |
| `anchor` | Yes | Cell the image is placed from |
| `offsetX`, `offsetY` | Yes | Offset from the anchor in pixels |
| `width`, `height` | Yes | Size in pixels, greater than 0 |
| `originalWidth`, `originalHeight` | No | The image's own size, used to keep its proportions. Default to `width` and `height` |
| `alt` | No | Alt text |

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"images": [{"id": "logo", "src": "/api/v1/workspaces/a8e2.../images/0f6c2b8e-5d1a-4e7b-9c3f-1a2b3c4d5e6f.png", "anchor": "E2", "offsetX": 0, "offsetY": 0, "width": 240, "height": 80}]}' \
  "$WFB_API/workspaces/$WS/documents/$DOC/tabs/tab-1/images"
```

This places one 240 by 80 pixel image at `E2`.

### Filter

`GET` or `PUT /tabs/$TAB/filter` with `{ "filter": { ... } }`

| Field | Required | Description |
|---|---|---|
| `startRow`, `endRow`, `startCol`, `endCol` | Yes | The filtered range, as non-negative integers. An end before its start is `400` |
| `columns` | No | Conditions per column, stored as given |
| `hiddenRows` | No | Rows the filter hides. Default `[]` |

`{ "filter": null }` removes the filter. A body without `filter` is `400`.

The API does not apply conditions. It stores `hiddenRows` as you send it, so a filter with conditions but no `hiddenRows` hides nothing. Set a filter in the editor and `GET` it to see the `columns` shape.

### Pivot table

`GET` or `PUT /tabs/$TAB/pivot` with `{ "pivot": { ... } }`

| Field | Required | Description |
|---|---|---|
| `id`, `sourceTabId`, `sourceRange` | Yes | Non-empty strings |
| `rowFields`, `columnFields`, `valueFields`, `filterFields` | No | Arrays, stored as given. Default `[]` |
| `showTotals` | No | `{ "rows": true, "columns": true }`. Each defaults to `false` |

`{ "pivot": null }` removes the pivot definition. A body without `pivot` is `400`. Build a pivot table in the editor and `GET` it to see the field shapes.

## Related

- [Make your first API call](/developers/api/quickstart) to write a sheet end to end.
- [Comments](/developers/api/content#comments) to comment on a cell.
- [Formulas](/sheets/formulas) for what the editor calculates.
- [`wafflebase sheets`](/developers/cli/sheets) to import and export CSV files.
