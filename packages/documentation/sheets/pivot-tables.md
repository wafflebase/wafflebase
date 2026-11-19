---
title: Summarize data with a pivot table
description: Group and total a range of data on its own tab with a pivot table.
type: how-to
---

# Summarize data with a pivot table

Group and total a range of data on its own tab with a pivot table.

A pivot table is a snapshot: it recalculates only when you click **Refresh pivot table**, not when the source data changes.

::: info Before you start
- You need edit access.
- Select at least 2 rows and 1 column. The first row must hold the column headers.
- Pivot tables are created from the right-click menu only. There is no toolbar button.
:::

## Create a pivot table

1. Open the sheet and select the data, including the header row. For example, select **A1:D50**.
2. Right-click the selection and select **Insert pivot table**.

A new tab named **Pivot Table 1** opens, with the **Pivot table editor** on the right. The tab stays empty until you add a value and refresh.

### On a phone

Select the data, then touch and hold the selection to open the menu and select **Insert pivot table**.

## Add rows, columns, and values

1. In the **Pivot table editor**, click **Add** under **Rows** and select a column to group by, such as `Region`.
2. To spread a second grouping across the top, click **Add** under **Columns** and select a column, such as `Quarter`.
3. Click **Add** under **Values** and select the column to total, such as `Revenue`.
4. Choose how to total it: **SUM**, **COUNT**, **COUNTA**, **AVERAGE**, **MIN**, or **MAX**. The default is **SUM**.
5. Click **Refresh pivot table**.

The pivot tab fills with one row per group and a grand total. Add several row fields to nest groups. A column can sit in only one of **Rows**, **Columns**, and **Filters**, but you can add it to **Values** more than once, for example as both **SUM** and **COUNT**.

![Pivot table grouping revenue by region and quarter, with the Pivot table editor open](/images/sheets/pivot-tables-editor.png)

### Change the sort order or remove a field

- Click the sort icon on a row or column field to switch between ascending and descending order.
- Click **✕** on a field to remove it.

Click **Refresh pivot table** after each change to see the result.

## Refresh after the source data changes

1. Open the pivot tab. If the editor is closed, click **Edit pivot table** in the top right.
2. Click **Refresh pivot table**.

The result is recalculated from the current source data.

## Hide grand totals

1. In the **Pivot table editor**, find **Totals**.
2. Clear **Show row totals** or **Show column totals**.
3. Click **Refresh pivot table**.

## Known limitations

- The **Filters** area doesn't hide any values yet, and rows hidden by a filter are still counted. To pivot a subset, copy those rows to their own range and pivot that.
- The pivot table reads the range you selected when you created it. Rows added below that range aren't included.
- You can't type into the cells of a pivot tab or insert rows and columns there.
- **Refresh pivot table** stays unavailable until you add at least one value field.

## Related

- [Charts](/sheets/charts) to visualize the totals.
- [Sort and filter](/sheets/sort-and-filter) to explore the source data row by row.
- [Functions](/sheets/functions) such as `SUMIF` for totals that update on their own.
