# Charts & Pivot Tables

Wafflebase includes built-in charts and pivot tables so you can visualize and summarize your data without leaving the spreadsheet.

## Charts

### Insert a Chart

1. Select the data range you want to chart (include headers in the first row).
   The selection must cover at least 2 rows and 2 columns
2. Click the **Insert chart** button (the bar-chart icon) in the toolbar. On a
   narrow screen, the toolbar collapses its extra tools into an overflow (**⋯**)
   menu — choose **Insert chart** there
3. A bar chart appears anchored to the top-left cell of your selection, with
   the chart editor panel open on the right

### Chart Types

| Type | Best For |
|------|----------|
| **Bar** | Comparing categories side by side |
| **Line** | Showing trends over time |
| **Area** | Trends with volume emphasis |
| **Pie** | Showing proportions of a whole |
| **Scatter** | Visualizing relationships between two numeric values |

### Configure Your Chart

The chart editor panel has two tabs:

**Setup** — Choose the chart type, data range, X-axis column, and which columns
to plot as series. A pie chart plots a single **value column** rather than
multiple series.

**Customize** — Set the chart title, legend position (Top, Bottom, Right, Left,
or None), toggle gridlines, and pick a color palette.

::: tip
The available controls depend on the chart type. Pie charts have no gridlines,
so the **Show gridlines** checkbox is not shown for them.
:::

### Move and Resize

Drag the chart to reposition it on the sheet. Drag the edges or corners to resize.

### Color Palettes

Three built-in palettes are available:

- **Theme (default)** — Adapts to light/dark theme
- **Warm** — Orange and earth tones
- **Cool** — Blue and teal tones

### Charts Follow Their Source Data

A chart reads its source range every time it draws, so edits to the source
cells show up in the chart right away. Pivot tables work the other way — see
[Refresh](#refresh) below.

## Pivot Tables

Pivot tables let you summarize large datasets by grouping and aggregating
values — similar to Google Sheets pivot tables.

### Create a Pivot Table

1. Select a data range (first row must be headers, at least 2 rows)
2. Right-click the selection and choose **Insert pivot table**
3. A new **Pivot Table** tab is created and the pivot editor panel opens on the
   right

::: tip
Insert pivot table is only on the right-click menu — there is no toolbar button
for it.
:::

### Configure Fields

The pivot editor panel has a section per area. Click **Add** in a section and
pick a source column from the dropdown; there is no drag-and-drop. Each field
shows a **✕** button to remove it again.

- **Rows** — Group data by these columns (supports multi-level grouping)
- **Columns** — Create column headers from field values
- **Values** — Aggregated data; choose SUM, COUNT, COUNTA, AVERAGE, MIN, or MAX
  per field
- **Filters** — Add a source column here to reserve it for filtering

Row and column fields each carry a sort toggle for ascending / descending
order.

::: warning
The **Filters** area currently has no way to choose which values to hide, so a
filter field does not change the pivot result yet. Filter your source data
before pivoting it if you need a subset.
:::

### Refresh

Pivot tables materialize their result into the cells of the pivot tab, so they
do not update when the source data changes. Click **Refresh pivot table** at the
bottom of the editor panel to recalculate.

### Grand Totals

Row and column grand totals are shown by default. Clear **Show row totals** or
**Show column totals** in the editor panel's **Totals** section if you don't
need them.
