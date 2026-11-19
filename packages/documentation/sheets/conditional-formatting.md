---
title: Highlight cells with conditional formatting
description: Color, bold, or underline cells automatically when their values match a rule.
type: how-to
---

# Highlight cells with conditional formatting

Color, bold, or underline cells automatically when their values match a rule.

A rule never changes the cell's value or the formatting you applied by hand. Delete the rule and the cells look as they did before.

::: info Before you start
- You need edit access. Viewers and share-link visitors see the formatting but can't open the panel.
- Rules belong to one tab and work on sheet and pivot tabs.
:::

## Add a rule

1. Open the sheet and select the cells to format, for example **B2:B50**.
2. Click **Conditional formatting** (the palette icon) in the toolbar.
3. The panel opens on a new, **Unsaved** rule for your selection. It starts as **Is not empty** with a light green fill and black text.
4. Under **Format rules**, pick a condition and enter its value, for example **Greater than** `1000`.
5. Under **Formatting style**, set **Bold**, **Italic**, **Underline**, **Text color**, or **Background color**.
6. Click **Done**.

Matching cells take the style right away. To discard the rule instead, click **Cancel** or close the panel.

![Conditional formatting panel with two numbered rules: green fill over 1000, yellow fill from 500 to 1000](/images/sheets/conditional-formatting-rules.png)

### On a phone

Tap **More formatting options** (⋮) at the right end of the toolbar, then select **Conditional formatting**.

### Add another rule

Click **Add** in the panel. A new rule appears for the current selection and saves as you edit it.

## Choose a condition

| Condition | Matches a cell that |
|---|---|
| **Is empty** | is blank or holds only spaces |
| **Is not empty** | holds anything |
| **Text contains** | contains the text you type, ignoring case |
| **Greater than** | is a number greater than the value |
| **Is between** | is a number from **Min** to **Max**, inclusive |
| **Date before** | is a date earlier than the date you type |
| **Date after** | is a date later than the date you type |

Number conditions ignore thousands separators. Type dates as `YYYY-MM-DD`. A cell that isn't a number or a date never matches those conditions.

## Apply a rule to several ranges

1. Select the rule's card in the panel.
2. Under **Apply to range**, type the ranges separated by commas, for example `A1:B10, D1:E10`.
3. Click **Apply**.

Write both ends of every range. A single cell is `A1:A1`; a bare `A1` shows `Enter valid A1 ranges like A1:D20 or A1:B10, D1:E10.`

To use the cells you have selected instead, click **Use selected range**. It needs a cell range; with a whole row or column selected it shows `Select a cell range first.`

## Change the rule order

The panel applies rules from top to bottom. Click the ↑ or ↓ arrow on a rule's card to move it.

When two rules match the same cell, both apply. For a property both rules set, such as the background color, the lower rule wins.

## Edit or delete a rule

1. Select a cell the rule covers and click **Conditional formatting**. The panel opens on that rule.
2. Change its range, condition, or style. Edits save as you make them.
3. To delete the rule, click **✕** on its card.

Each card shows the condition, the ranges, and a style summary such as `B · Fill`.

## Known limitations

- A rule can't change number formats, borders, fonts, or alignment.
- A rule with no style, or with an empty value box, isn't kept.
- Clicking the grid closes the panel. Select the cells before you open it.
- Conditional formatting isn't available on data source or lakehouse tabs. Copy the results into a sheet tab to format them.
- On a pivot tab, a rule stays on the cells you gave it, so a pivot that changes shape after a refresh can leave it on the wrong cells.

## Related

- [Data validation](/sheets/data-validation) to add dropdowns and checkboxes.
- [Edit and format cells](/sheets/edit-and-format) to style cells by hand.
- [Pivot tables](/sheets/pivot-tables) to summarize data before you highlight it.
