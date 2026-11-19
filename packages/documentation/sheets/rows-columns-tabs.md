---
title: Work with rows, columns, and tabs
description: Insert, delete, hide, freeze, move, and resize rows and columns, and add, rename, duplicate, reorder, or delete tabs.
type: how-to
---

# Work with rows, columns, and tabs

Insert, delete, hide, freeze, move, and resize rows and columns, and add, rename, duplicate, reorder, or delete tabs.

::: info Before you start
- You need edit access. With a viewer link the row and column menu items are unavailable.
- On a phone, touch and hold a row number, column letter, cell, or tab instead of right-clicking.
:::

## Insert or delete rows and columns

1. Select a row by clicking its number, or a column by clicking its letter. To act on several, drag across the headers or `Shift`-click another header.
2. Right-click the selected header.
3. Select an item. The menu counts your selection:
   - Rows: **Insert row above**, **Insert row below**, or **Delete row** (**Insert 3 rows above** when three are selected)
   - Columns: **Insert column left**, **Insert column right**, or **Delete column**

You can also right-click any cell. The cell menu offers the same insert and delete items for the rows and columns the selection spans.

Formulas, merged cells, and formatting shift with the edit.

## Hide and show rows or columns

1. Select the rows or columns and right-click a selected header.
2. Select **Hide row** or **Hide column** (**Hide 3 rows** when three are selected).

A small arrow marks where rows or columns are hidden. To show them again, click the arrow, or right-click a header next to the hidden ones and select the **Show** item, such as **Show rows 4–6**.

## Freeze header rows or columns

1. Right-click the number of the last row to keep in view. For a single header row, right-click row **1**.
2. Select **Freeze up to row N**, where **N** is that row.

Rows 1 through **N** stay at the top while you scroll. To freeze columns, right-click the letter of the last column to keep in view and select **Freeze up to column** with that letter, such as **Freeze up to column A**.

To undo a freeze, right-click any row number and select **Unfreeze rows**, or right-click a column letter and select **Unfreeze columns**. You can freeze up to the first 1,000 rows or columns.

![Row header menu with Insert, Delete, Hide, and Freeze up to row 1 items](/images/sheets/rows-columns-tabs-freeze.png)

## Move rows or columns

1. Select the rows or columns by their headers.
2. Click and hold a selected header, then drag it to the new position.

The rows or columns and their contents move together.

## Resize rows and columns

- **Resize:** drag the line between two row numbers or two column letters.
- **Fit to content:** double-click that line. The column width or row height fits its contents.

## Add a tab

- To add a sheet, click **+** (**Add sheet**) at the right of the tab bar. It is named **Sheet2**, **Sheet3**, and so on.
- To add a data source or lakehouse tab, click **More tab types** (the ▾ next to **+**) and select **Connect data source (SQL)…** or **Connect lakehouse table…**. See [Connect a database](/sheets/connect-a-database) and [Lakehouse tables](/sheets/lakehouse).

## Rename a tab

1. Double-click the tab, or right-click it and select **Rename**.
2. Type the new name and press `Enter`. Press `Escape` to keep the old name.

Tab names must be unique, ignoring case. A duplicate name shows **Tab name "…" already exists.** and stays in edit mode.

## Duplicate a tab

1. Right-click a sheet tab.
2. Select **Duplicate**.

The copy opens next to the original, named after it with **(copy)**, such as **Sheet1 (copy)**. Comments are not copied. A copy of a pivot table keeps its values but becomes a plain sheet.

## Reorder tabs

Drag a tab left or right along the tab bar. Or right-click it and select **Move left** or **Move right**.

## Delete a tab

1. Right-click the tab.
2. Select **Delete**.

A document always keeps at least one tab, so **Delete** is missing when only one is left. If a pivot table reads from the tab, a **Delete tab** dialog lists the pivot tables that will go with it. Click **Delete all** to confirm.

::: warning
Otherwise the tab is deleted without asking. To get it back, restore an earlier version from [version history](/collaborate/version-history).
:::

## Known limitations

- On a pivot table tab you can't insert or delete rows and columns, or merge cells.
- **Duplicate** works only for sheet tabs, not data source or lakehouse tabs.

## Related

- [Sort and filter](/sheets/sort-and-filter) to hide rows that don't match a condition.
- [Edit and format cells](/sheets/edit-and-format) to fill, move, and format data.
- [Formulas](/sheets/formulas) to reference cells on another tab.
- [Keyboard shortcuts](/sheets/keyboard-shortcuts), including `Shift+Space` to select a row.
