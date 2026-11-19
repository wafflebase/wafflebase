---
title: Write formulas
description: Type = in a cell to calculate a value from numbers, other cells, and functions.
type: how-to
---

# Write formulas

Type `=` in a cell to calculate a value from numbers, other cells, and functions. A formula recalculates whenever a cell it uses changes.

::: info Before you start
- You need edit access to enter formulas.
- For every function and its syntax, see the [Function reference](/sheets/functions).
:::

## Enter a formula

1. Click the cell where the result should appear.
2. Type `=` followed by the formula, for example `=SUM(B2:B7)`.
3. As you type a function name, a list of matching functions appears. Press `↓` or `↑` to choose one, then `Tab` or `Enter` to insert it with its opening parenthesis.
4. While you type the arguments, a hint shows the function's syntax. To add a reference, click a cell or drag across a range instead of typing it.
5. Press `Enter`.

The cell shows the result. Select the cell to see the formula in the formula bar.

![Function list under a cell after typing =SU, with SUM highlighted](/images/sheets/formulas-autocomplete.png)

### On a phone

Double-tap the cell and type the formula in the edit panel, then tap the check mark (**Confirm editing**). The function list and syntax hint don't appear in the edit panel.

## Reference cells, ranges, and other tabs

| To refer to | Write | Example |
|---|---|---|
| One cell | Column letter and row number | `=A1*2` |
| A range | Two corners joined by `:` | `=SUM(A1:C10)` |
| Whole columns | Column letters only | `=SUM(B:B)` |
| Whole rows | Row numbers only | `=SUM(2:2)` |
| A cell on another tab | Tab name, `!`, reference | `=Sheet2!A1` |
| A tab whose name has spaces or symbols | The name in single quotes | `='Q1 Sales'!B2:B10` |

Tab names in a reference ignore case, so `sheet2!A1` and `Sheet2!A1` are the same cell.

While you edit a formula, clicking a column letter inserts the whole column, such as `B:B`, and clicking a row number inserts the whole row.

## Keep a reference fixed

A plain reference such as `B2` changes when you fill or copy the formula to another cell. Add `$` to fix part of it:

| Reference | When filled to another cell |
|---|---|
| `B2` | Column and row both change |
| `$B$2` | Neither changes |
| `B$2` | Only the column changes |
| `$B2` | Only the row changes |

To switch modes, put the cursor on a reference while editing and press `F4`. Each press cycles `B2` → `$B$2` → `B$2` → `$B2` → `B2`.

## Find a function

1. Click **Functions** in the toolbar. On a phone, tap ⋮ (**More formatting options**) and select **Functions**.
2. Type in **Search by name or description**, for example `lookup`.
3. Click a function to insert it into the selected cell.

The panel lists functions by category and shows each one's syntax and description.

![Functions panel filtered by "lookup", showing XLOOKUP and VLOOKUP with their syntax](/images/sheets/formulas-functions-browser.png)

## Return several values at once

Some formulas return a whole range. Enter the formula in one cell, and the results fill the cells below and to the right of it.

| Formula | Result |
|---|---|
| `={1,2;3,4}` | A 2-by-2 block of numbers |
| `=SORT(A2:C20, 2, -1)` | The range sorted by its second column, largest first (`1` sorts smallest first) |
| `=TRANSPOSE(A1:C2)` | The range with rows and columns swapped |
| `=HSTACK(A2:A20, C2:C20)` | Two ranges side by side |
| `=CHOOSECOLS(A2:D20, 1, 3)` | Only the first and third columns of the range |

Only the first cell holds the formula. To change or remove the results, edit or delete that cell. If a cell in the way already has data, the formula shows `#REF!` until you clear it.

## Use operators

| Operator | Meaning | Example |
|---|---|---|
| `+` `-` `*` `/` | Add, subtract, multiply, divide | `=B2*1.1` |
| `^` | Power | `=2^10` |
| `%` | Percent | `=B2*15%` |
| `&` | Join text | `=A2&" "&B2` |
| `=` `<>` `<` `>` `<=` `>=` | Compare; returns `TRUE` or `FALSE` | `=B2>=100` |
| `{ }` | Array: `,` between columns, `;` between rows | `={1,2;3,4}` |

Put text in double quotes: `"Over"`. To include a quote inside text, double it: `"Say ""hi"""`.

## Common formulas

| Task | Formula |
|---|---|
| Total a column | `=SUM(C2:C7)` |
| Average | `=AVERAGE(C2:C7)` |
| Largest or smallest value | `=MAX(C2:C7)`, `=MIN(C2:C7)` |
| Count cells that match | `=COUNTIF(D2:D7, "<0")` |
| Total cells that match | `=SUMIF(A2:A20, "Rent", C2:C20)` |
| Choose between two values | `=IF(D2<0, "Over", "OK")` |
| Replace an error with a value | `=IFERROR(C2/B2, 0)` |
| Look up a value | `=XLOOKUP("Bob", A2:A20, C2:C20)` |
| Look up a value in the third column of a table | `=VLOOKUP("Bob", A2:C20, 3, FALSE)` |
| Look up by position | `=INDEX(C2:C20, MATCH("Bob", A2:A20, 0))` |
| Choose among several conditions | `=IFS(C2>=30, "High", C2>=20, "Medium", TRUE, "Low")` |
| Join text with a separator | `=TEXTJOIN(", ", TRUE, A2:A5)` |
| Days between two dates | `=DAYS(B2, A2)` |

## Fix an error value

When a formula can't produce a result, the cell shows an error value instead.

| Value | What it means | Try this |
|---|---|---|
| `#DIV/0!` | The formula divides by zero or an empty cell. | Check the divisor, or wrap the formula in `IFERROR`. |
| `#VALUE!` | An argument has a value the function doesn't accept, such as a `SORT` order other than `1` or `-1`. | Check the arguments against the function's syntax. |
| `#REF!` | A reference is invalid, the formula refers to its own cell (a circular reference), or a multi-cell result is blocked by data. | Fix the reference, keep the formula's own cell out of its ranges, or clear the cells where the results go. |
| `#NAME?` | The function name isn't recognized. | Check the spelling against the [Function reference](/sheets/functions). |
| `#N/A` | A lookup found no match. | Check the search value, or add an `if_not_found` argument to `XLOOKUP`. |
| `#NUM!` | A number is out of range for the function. | Check the arguments' limits. |
| `#ERROR!` | The formula can't be read, for example because of a missing parenthesis. | Check the formula's syntax. |

## Known limitations

- Formulas can read sheet tabs only, not data source or lakehouse tabs. To calculate with query results, copy them into a sheet tab.
- Named ranges aren't supported. Use cell references.
- Text used in arithmetic counts as `0`. For example, `=A1*2` returns `0` when **A1** holds `abc`.
- `FILTER` needs a range of `TRUE` and `FALSE` cells as its condition. A comparison such as `A2:A20>100` returns `#VALUE!`.
- `FILTER`, `UNIQUE`, `SEQUENCE`, `SORTBY`, `VSTACK`, `TAKE`, `DROP`, `TOCOL`, `FLATTEN`, and `SPLIT` return only their first value, not a whole range.

## Related

- [Function reference](/sheets/functions) for every function and its syntax.
- [Build a budget](/sheets/build-a-budget) to practice `SUM`, `IF`, and fill down.
- [Edit and format cells](/sheets/edit-and-format) to fill a formula down a column.
- [Keyboard shortcuts](/sheets/keyboard-shortcuts) for editing keys such as `F4`.
