---
title: Add checkboxes, dropdowns, and validation
description: Add checkboxes, dropdown lists, and date pickers to cells, and flag or block values that break a rule.
type: how-to
---

# Add checkboxes, dropdowns, and validation

Add checkboxes, dropdown lists, and date pickers to cells, and flag or block values that break a rule.

The control is the cell's own value, so it keeps working when you sort, filter, copy, or use the cell in a formula.

::: info Before you start
- You need edit access. Viewers see the controls but can't change them.
- Rules belong to one tab. Each tab has its own list.
:::

## Add a dropdown list

1. Open the sheet and select the cells, for example **C2:C20**.
2. Click **Data validation** (the checklist icon) in the toolbar. You can also right-click the selection and select **Data validation**.
3. The panel opens on a new, **Unsaved** rule for your selection, with **Criteria** set to **Dropdown**.
4. Under **Options (one per line)**, type each choice on its own line:

   ```text
   To do
   In progress
   Done
   ```

5. Click **Done**.

Each cell now shows a dropdown arrow. Click the arrow, or press `Option+↓` / `Alt+↓`, to pick an option.

**Done** stays unavailable until the list has at least one option. To discard the rule, click **Cancel** or close the panel.

To keep the rule but hide the arrows, turn off **Show dropdown arrow**.

![Data validation panel with an unsaved dropdown rule, three options, and the Done button](/images/sheets/data-validation-dropdown.png)

### On a phone

Tap **More formatting options** (⋮) at the right end of the toolbar, then select **Data validation**. You can also touch and hold the selection and select **Data validation**.

![Data validation panel covering the screen on a phone with a dropdown rule and Done button](/images/sheets/data-validation-panel-mobile.png)

## Add checkboxes

1. Select the cells and click **Data validation**.
2. Set **Criteria** to **Checkbox**.
3. Click **Done**.

Each cell becomes a checkbox that stores `TRUE` or `FALSE`. Click a box to toggle it, or select several and press `Space` to toggle them together. Formulas such as `=COUNTIF(B2:B20, TRUE)` count the checked boxes.

## Validate dates, numbers, or text

1. Select the cells and click **Data validation**.
2. Set **Criteria** to **Date**, **Number**, or **Text**.
3. Pick a **Condition** and enter its value. "Between" conditions take two values.
4. Click **Done**.

| Criteria | Conditions |
|---|---|
| **Date** | is a valid date, date is, date is before, date is on or before, date is after, date is on or after, date is between, date is not between |
| **Number** | is a valid number, is equal to, is not equal to, greater than, greater than or equal to, less than, less than or equal to, between, not between |
| **Text** | contains, does not contain, is exactly, is valid email, is valid URL |

To fill a date cell from a calendar, double-click it.

## Choose what happens to invalid data

Dropdown, date, number, and text rules have an **If the data is invalid** setting:

- **Show a warning**: the value is kept and the cell gets a small red triangle in its top-right corner. Point at the cell to see why, for example `Invalid entry — must be one of: To do, In progress, Done`.
- **Reject the input**: a typed value that breaks the rule isn't saved. A message explains why, and the cell keeps its previous value.

A formula whose result breaks the rule is flagged with the red triangle, not rejected. Pasted values are flagged the same way.

::: tip
Use **Show a warning** while you clean up existing data, then switch to **Reject the input** once the column should only hold valid values.
:::

## Edit or remove a rule

1. Select a cell the rule covers and click **Data validation**. The panel opens on that rule.
2. Change the criteria, options, or range. To change the range, type it under **Apply to range** (for example `B2:B100, D2:D100`) and click **Apply**, or click **Use selected range**.
3. To remove the rule, click **✕** on its card.

Changes to an existing rule save as you make them. When you remove a rule, its cells go back to plain values.

### Add another rule

Click **Add** in the panel. A new dropdown rule appears for the current selection, and you edit it the same way.

## Known limitations

- Checkbox rules have no invalid-data setting, and their cells are never flagged.
- Clicking the grid closes the panel. Select the cells before you open it.
- Data validation isn't available on data source or lakehouse tabs.

## Related

- [Conditional formatting](/sheets/conditional-formatting) to color cells by their values.
- [Formulas](/sheets/formulas) to count checkboxes or dropdown choices.
- [Keyboard shortcuts](/sheets/keyboard-shortcuts) for `Space` and `Alt+↓`.
- [Share a document](/collaborate/share) to give teammates edit access.
