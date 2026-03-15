# Charts & Pivot Tables

Wafflebase includes built-in charts and pivot tables so you can visualize and summarize your data without leaving the spreadsheet.

## Charts

### Insert a Chart

1. Select the data range you want to chart (include headers in the first row)
2. Click **Insert** > **Chart** in the toolbar
3. A chart appears on your sheet with the editor panel open on the right

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

**Setup** — Choose the chart type, data range, X-axis column, and which columns to plot as series.

**Customize** — Set the chart title, legend position (top, bottom, left, right, or hidden), toggle gridlines, and pick a color palette.

### Move and Resize

Drag the chart to reposition it on the sheet. Drag the edges or corners to resize.

### Color Palettes

Three built-in palettes are available:

- **Default** — Adapts to light/dark theme
- **Warm** — Orange and earth tones
- **Cool** — Blue and teal tones

## Pivot Tables

Pivot tables let you summarize large datasets by grouping, filtering, and aggregating values — similar to Google Sheets pivot tables.

### Create a Pivot Table

1. Select a data range (first row must be headers)
2. Click **Insert** > **Pivot Table**
3. A new sheet is created with the pivot result, and the editor panel opens

### Configure Fields

In the pivot editor panel, drag fields into these areas:

- **Rows** — Group data by these columns (supports multi-level grouping)
- **Columns** — Create column headers from field values
- **Values** — Aggregated data (SUM, COUNT, COUNTA, AVERAGE, MIN, MAX)
- **Filters** — Filter source data before aggregation

### Refresh

Pivot tables do not auto-update when source data changes. Click **Refresh** in the editor panel to recalculate.

### Grand Totals

Row and column grand totals are shown by default. Toggle them off in the editor panel if you don't need them.
