---
title: Build a budget
description: Build a monthly budget that totals your spending, flags overspending, and formats the amounts as currency.
type: tutorial
---

# Build a budget

Build a monthly budget that totals your spending, flags overspending, and formats the amounts as currency. It takes about 10 minutes.

You will use `SUM`, a formula filled down a column, `IF`, number formats, and a conditional formatting rule.

::: info Before you start
- You need a Wafflebase account and a workspace where you can create documents.
- Use a desktop browser. On a phone the fill handle is hidden and several tools move to the ⋮ menu.
:::

## 1. Create the sheet

1. In your workspace, click **New** and select **New sheet**.
2. Click cell **A1**.
3. Copy the data below and press `⌘+V` / `Ctrl+V` to paste it.

```text
Category	Budget	Actual
Rent	1500	1500
Groceries	400	380
Transport	200	220
Utilities	150	135
Entertainment	100	95
Savings	500	500
```

The data fills **A1:C7**, one value per cell.

## 2. Add totals

1. Click cell **A8** and type `Total`.
2. Click cell **B8**, type the formula below, and press `Enter`.

   ```text
   =SUM(B2:B7)
   ```

3. Click cell **C8**, type `=SUM(C2:C7)`, and press `Enter`.

**B8** shows `2850` and **C8** shows `2830`.

## 3. Calculate the difference

1. Click cell **D1** and type `Difference`.
2. Click cell **D2**, type `=B2-C2`, and press `Enter`.
3. Drag across **D2:D8** to select the range.
4. Press `⌘+D` / `Ctrl+D` to fill down.

Each row now subtracts its own actual from its budget. The references change row by row: **D3** holds `=B3-C3`, and **D8** shows the total difference, `20`.

::: tip
You can also drag the fill handle, the small square at the bottom-right corner of the selection, from **D2** down to **D8**.
:::

![Budget sheet with a Difference column; Transport shows -20 and the Total row shows 20](/images/sheets/build-a-budget-difference.png)

## 4. Flag overspending

1. Click cell **E1** and type `Status`.
2. Click cell **E2**, type the formula below, and press `Enter`.

   ```text
   =IF(D2<0, "Over", "OK")
   ```

3. Select **E2:E7** and press `⌘+D` / `Ctrl+D`.

**E4**, the Transport row, shows `Over`. Every other row shows `OK`.

## 5. Format the numbers

1. Select **B2:D8**.
2. Click **Format as currency** in the toolbar. Its tooltip names your local currency, for example **Format as currency (USD)**.
3. Click cell **A10** and type `Used`.
4. Click cell **B10**, type `=C8/B8`, and press `Enter`.
5. With **B10** selected, click **Format as percent**.

The amounts show as currency, such as `$1,500.00` and `-$20.00`. **B10** shows `99.30%` of the budget used.

## 6. Highlight the rows that are over budget

1. Select **E2:E7**.
2. Click **Conditional formatting** in the toolbar. The panel opens with a new rule for **E2:E7**.
3. Under **Format rules**, select **Text contains**.
4. In the value box, type `Over`.
5. Click **Done**.

The `Over` cell turns light green. To pick another color, change **Background color** under **Formatting style** before you click **Done**.

Your sheet should look like this:

![Finished budget in currency format; Transport is marked Over and highlighted, and B10 shows 99.30% used](/images/sheets/build-a-budget-final.png)

## What you learned

- `SUM` adds a range, and a relative reference such as `B2` adjusts when you fill it down.
- `IF` returns one value or another based on a condition.
- Number formats and conditional formatting change how values look without changing them.

## Next steps

- [Formulas](/sheets/formulas) to reference other tabs and find more functions.
- [Charts](/sheets/charts) to chart your budget against actual spending.
- [Share a document](/collaborate/share) to plan the budget with someone else.
