---
title: Add a chart
description: Turn a range of cells into a bar, line, area, pie, or scatter chart, and place images on a sheet.
type: how-to
---

# Add a chart

Turn a range of cells into a bar, line, area, pie, or scatter chart, and place images on a sheet.

A chart reads its cells every time it draws, so it updates as soon as you change the data.

::: info Before you start
- You need edit access. Viewers see charts and images but can't add or change them.
- Select at least 2 rows and 2 columns. Include the header row so the chart can name its series.
- Images: PNG, JPEG, GIF, or WebP, up to 10 MB. Larger images are shrunk to fit.
:::

## Insert a chart

1. Open the sheet and select the data, including the header row. For example, select **A1:C7**.
2. Click **Insert chart** (the bar chart icon) in the toolbar.

A bar chart appears beside the data: to the right, or below it when there is no room. Its title comes from your headers, for example `Revenue and Cost by Month`, or `Chart` when the range has no header row. The **Chart editor** panel opens on the right.

![Bar chart placed to the right of its monthly data, with the Chart editor open on Setup](/images/sheets/charts-insert.png)

### On a phone

Tap **More formatting options** (⋮) at the right end of the toolbar, then select **Insert chart**. See [Use Wafflebase on a phone](/start/phone).

## Change the chart type and data

1. Open the **Chart editor**. If it's closed, click the chart's menu (⋮) in its title bar and select **Edit chart**.
2. On the **Setup** tab, set the options you need:

   | Option | What it does |
   |---|---|
   | **Chart type** | **Bar chart**, **Line chart**, **Area chart**, **Pie chart**, or **Scatter chart** |
   | **Data range** | The cells the chart plots. Type a range such as `A1:D20` and click **Apply**, or click **Use selected range** |
   | **X-axis** | The column used for category labels, or **None**. Called **Label column** for a pie chart |
   | **Series** | The columns plotted as values. A pie chart has a single **Value column** instead |

The chart redraws as you change each option.

## Customize the title, legend, and colors

1. In the **Chart editor**, open the **Customize** tab.
2. Type a **Chart title**.
3. Choose a **Legend** position: **Top**, **Bottom**, **Right**, **Left**, or **None**.
4. Turn **Show gridlines** on or off. Pie charts have no gridlines, so the option is hidden for them.
5. Pick a **Color palette**: **Theme (default)**, **Warm**, or **Cool**.

## Move, resize, or delete a chart

1. Click the chart to select it.
2. Do one of the following:
   - To move it, drag the chart. Press an arrow key to nudge it.
   - To resize it, drag an edge or a corner handle.
   - To delete it, press `Delete` or `Backspace`, or click the chart's menu (⋮) and select **Delete chart**.

## Insert an image

1. Click the cell where the image should start.
2. Click **Insert image** (the photo icon) in the toolbar and choose a file.

The image appears at that cell. You can also paste an image, or drag an image file onto the grid to drop it where you release it.

To move an image, drag it. To resize it, drag a corner handle to keep its proportions, or an edge handle to stretch it. To delete it, select it and press `Delete`, or right-click it and select **Delete image**.

### On a phone

Tap **More formatting options** (⋮), then select **Insert image**.

## Known limitations

- A chart whose range holds no numbers shows `Not enough numeric data in <range>`. Pick a range that includes a numeric column.
- To replace an image, delete it and insert a new one.

## Related

- [Pivot tables](/sheets/pivot-tables) to summarize data before you chart it.
- [Conditional formatting](/sheets/conditional-formatting) to highlight values in the cells themselves.
- [Troubleshooting](/start/troubleshooting#select-at-least-2-rows-and-2-columns) if Wafflebase says `Select at least 2 rows and 2 columns.`
- [Keyboard shortcuts](/sheets/keyboard-shortcuts) for nudging and deleting objects.
