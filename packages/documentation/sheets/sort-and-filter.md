---
title: Sort and filter
description: Turn a table into a filtered range, then sort it by a column or show only the rows that match values or a condition.
type: how-to
---

# Sort and filter

Turn a table into a filtered range, then sort it by a column or show only the rows that match values or a condition.

::: info Before you start
- You need edit access to create, change, or clear a filter.
- The filter is saved with the tab, so everyone sees the same rows hidden.
- Each tab has one filter at a time.
:::

## Create a filter

1. Select the table, including its header row. Or click any one cell in the table.
2. Click **Create filter from selection** (the funnel icon) in the toolbar.

A filter button appears in each header cell. The top row of the range is the header row and is never sorted or hidden.

When you start from a single cell, the filter grows to cover the whole block of data around it. When you select only the header row, it extends down through the rows that have data.

### On a phone

Tap ⋮ (**More formatting options**) and select **Create filter**.

## Sort by a column

1. Click the filter button in the header of the column to sort by. A panel named for the column, such as **Filter B**, opens.
2. Under **Sort**, click **Sort A to Z** or **Sort Z to A**.

Rows in the filter range are reordered by that column. Numbers sort by value, text sorts alphabetically ignoring case, and empty cells go last. Formulas recalculate after the sort.

## Filter by values

1. Click the filter button in a column header.
2. Click **Filter by values**. The panel lists each distinct value in the column, with **(Blanks)** for empty cells.
3. Clear the check box next to each value to hide. To find a value, type in **Search values**. To check or clear all, use **Select all**.
4. Click **Apply**.

Rows whose value is unchecked are hidden. The panel shows how many values are selected, such as **Selected 3 / 5**.

![Column filter panel with Sort A to Z, Filter by values, a value list, and the Apply button](/images/sheets/sort-and-filter-values.png)

## Filter by condition

1. Click the filter button in a column header.
2. Click **Filter by condition**.
3. Select a condition: **Contains**, **Does not contain**, **Equals**, **Does not equal**, **Is empty**, or **Is not empty**.
4. Type a value in **Enter value**, unless the condition is **Is empty** or **Is not empty**.
5. Click **Apply**.

Conditions ignore case. When you filter several columns, a row stays visible only if it matches every column's filter.

## Clear a filter

- **One column:** click its filter button and click **Clear**. **Clear** is unavailable until that column has a filter.
- **The whole filter:** click **Clear filter** (the funnel icon) in the toolbar. On a phone, tap ⋮ and select **Clear filter**.

Clearing shows every row again and removes the filter buttons.

## Known limitations

- Sorting needs a filter. There is no sort command outside the filter panel.
- A sort does nothing when any merged cell sits in the rows being sorted, even in a column outside the filter. Unmerge it first.
- Sorting moves cells only within the filter range's columns. Data in other columns of the same rows stays where it is, so include every related column in the filter.
- To create a filter, select cells, not whole rows or columns. The range needs at least one row below the header.

## Related

- [Rows, columns, and tabs](/sheets/rows-columns-tabs) to hide rows by hand or freeze the header row.
- [Conditional formatting](/sheets/conditional-formatting) to highlight matches instead of hiding the rest.
- [Formulas](/sheets/formulas) to return a sorted copy of a range with `SORT`.
