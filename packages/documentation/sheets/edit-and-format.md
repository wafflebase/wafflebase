---
title: Edit and format cells
description: Enter, fill, move, and find data in a sheet, and format cells with number formats, colors, borders, and alignment.
type: how-to
---

# Edit and format cells

Enter, fill, move, and find data in a sheet, and format cells with number formats, colors, borders, and alignment.

::: info Before you start
- You need edit access. With a viewer link the grid is read-only and the toolbar is hidden.
- A sheet tab has 1,000,000 rows and 18,278 columns (**A** to **ZZZ**).
:::

## Enter and edit a cell

1. Click a cell.
2. Type a value or a formula. Typing replaces what the cell holds.
3. Press `Enter` to save and move down, or `Tab` to save and move right.

To change part of a cell instead of replacing it, select the cell and press `F2`, or double-click it. You can also edit the selected cell in the formula bar above the grid. Press `Escape` to cancel an edit.

To start a new line inside a cell while editing, press `Alt+Enter` (Mac: `Option+Enter`).

To clear the selected cells, press `Delete` or `Backspace`, or right-click and select **Delete values**.

### On a phone

1. Double-tap a cell. An edit panel opens at the bottom of the screen with the cell's name, such as **B2**.
2. Type the new value.
3. Tap the check mark (**Confirm editing**) to save, or the X (**Cancel editing**) to discard.

The formula bar and the Name box are hidden on a phone.

![Phone edit panel at the bottom of the screen for cell B2, with cancel and confirm buttons](/images/sheets/edit-and-format-edit-panel-mobile.png)

## Fill a series or a formula

1. Select the cells to copy from, for example `1` and `2` in **A1:A2**.
2. Drag the fill handle, the small square at the bottom-right corner of the selection, across the cells to fill.

Numbers continue their trend (`3`, `4`, `5`, …). Text repeats, and formulas adjust their references to each new row or column.

To copy the top cell of a selection down through the rest of it, press `⌘+D` / `Ctrl+D`. To copy the leftmost cell to the right, press `⌘+R` / `Ctrl+R`.

On a phone the fill handle is hidden.

## Move, copy, and paste cells

- **Move:** select cells, then drag the selection's border to a new place.
- **Copy or cut:** press `⌘+C` / `Ctrl+C` or `⌘+X` / `Ctrl+X`, or right-click and select **Copy** or **Cut**.
- **Paste:** select the top-left target cell and press `⌘+V` / `Ctrl+V`, or right-click and select **Paste**.

Tab-separated text pasted from another spreadsheet or a text editor fills one cell per value. Press `Escape` to clear the dashed border around copied cells.

On a phone, touch and hold a cell to open the same menu.

## Go to a cell or range

1. Click the Name box, at the left end of the formula bar. It shows the current selection.
2. Type a cell or range: `C3`, `B2:D4`, whole columns such as `A:C`, or whole rows such as `2:5`.
3. Press `Enter`.

The grid scrolls to the target and selects it. If the text isn't a valid reference, the Name box goes back to the current selection. Press `Escape` to leave it without moving.

## Find values

1. Press `⌘+F` / `Ctrl+F`. The find bar opens.
2. Type the text to find. The bar shows the match count, such as `2/5`.
3. Press `Enter` for the next match or `Shift+Enter` for the previous one. You can also click **Previous match** and **Next match**.
4. Press `Escape` to close the bar.

Find searches the current tab, ignores case, and matches values as they appear in the cell, including their number format.

## Open links in a cell

Every web address or email address you type in a cell becomes a link, even when the cell holds other text or several links.

- **Open a link:** hold `⌘` / `Ctrl` and click it. In a sheet you can only view, a plain click opens it.
- **Open every link in the selected cell:** press `Alt+Enter` (Mac: `Option+Enter`) while not editing.
- **See or copy a link:** point to the cell. A card lists the cell's links, each with a copy button.

## Format numbers, currency, and dates

1. Select the cells.
2. Click a format in the toolbar:
   - **Format as currency** applies your local currency. Its tooltip names it, for example **Format as currency (USD)**.
   - **Format as percent** shows `0.25` as `25.00%`.
   - **Decrease decimal places** and **Increase decimal places** change the digits after the decimal point.
3. For other formats, click **More formats** (the **123 ▾** menu) and select one.

**More formats** lists **Plain text**, **Number**, **Percent**, **Scientific**, **Accounting**, **Financial**, **Currency**, **Currency rounded**, **Date**, **Time**, and **Date time**. Every entry except **Plain text** shows a preview. When your local currency isn't the US dollar, the currency entries name it, such as **Currency (EUR)**, and a separate **Currency (USD)** entry is added. **Currency rounded** is left out for a currency without decimal places, such as the yen.

![More formats menu listing Plain text through Date time, with a sample value beside each format](/images/sheets/edit-and-format-more-formats.png)

A currency format keeps the currency you applied. Collaborators in other countries see the same currency, not their own.

### On a phone

Tap ⋮ (**More formatting options**) at the right end of the toolbar. The **Format** group has currency, **Percent**, the decimal controls, **Plain text**, **Number**, and **Date**.

## Style text and fill cells

1. Select the cells.
2. Use the toolbar:
   - **Bold** (`⌘+B` / `Ctrl+B`), **Italic** (`⌘+I` / `Ctrl+I`), **Underline** (`⌘+U` / `Ctrl+U`), and **Strikethrough** (`⌘+Shift+S` / `Ctrl+Shift+S`)
   - **Text color**: pick a swatch, or **Reset** for the default color
   - **Fill color**: pick a swatch, or **None** to remove the fill

On a phone, **Underline** and **Strikethrough** are in the ⋮ menu.

## Add borders

1. Select the cells.
2. Click **Cell borders** in the toolbar.
3. Select **All borders**, **Outer border**, **Inner borders**, **Top border**, **Bottom border**, **Left border**, or **Right border**.

To remove borders, select **Clear borders**. On a phone, the same options are under **Borders** in the ⋮ menu.

## Align and merge cells

1. Select the cells.
2. Click **Horizontal align** and select **Left**, **Center**, or **Right**.
3. Click **Vertical align** and select **Top**, **Middle**, or **Bottom**.

To combine the selected cells into one, click **Merge cells** or press `⌘+Shift+M` / `Ctrl+Shift+M`. To split them again, select the merged cell and click **Unmerge cells**.

On a phone, alignment is under **Align** in the ⋮ menu. **Merge cells** stays on the toolbar.

## Copy formatting with Paint format

1. Select a cell whose formatting you want to copy.
2. Click **Paint format** in the toolbar.
3. Click a cell, or drag across a range, to apply the formatting.

Paint format turns off after one use. To stop before applying, click **Cancel paint format**.

## Known limitations

- You can't change the font family or font size of cells.
- **Merge cells** is unavailable on a pivot table tab.
- Find has no replace option.

## Related

- [Keyboard shortcuts](/sheets/keyboard-shortcuts) for every editing and formatting key.
- [Conditional formatting](/sheets/conditional-formatting) to format cells that match a rule.
- [Rows, columns, and tabs](/sheets/rows-columns-tabs) to insert, hide, and resize rows and columns.
- [Comments](/collaborate/comments) to discuss a cell with your team.
