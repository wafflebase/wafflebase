# Conditional Formatting

Conditional formatting paints cells based on what they contain. A rule watches
a range, and every cell in that range whose value matches the rule's condition
picks up the rule's bold / italic / underline / colors.

The formatting is applied at paint time — it never changes the value in the
cell and never overwrites the formatting you applied by hand. Delete the rule
and the cells go straight back to how they looked.

## Open the Conditional Formatting Panel

Click the **Conditional formatting** (brush) icon in the toolbar to open the
right-side panel.

On a narrow screen the toolbar collapses its extra tools into a **More
formatting options** (⋮) menu — open it and choose **Conditional formatting**
there.

There is no right-click entry for conditional formatting, and the panel is only
available on regular sheet tabs. See
[Where rules live](#where-rules-live) for the tabs it does not cover.

::: tip
Select the cells you want to format **before** opening the panel. Clicking back
into the grid closes the panel, so the selection you had when you opened it is
the one the panel can use.
:::

## Add a Rule

1. Select the range you want to format.
2. Open the panel and click **Add**.

The new rule starts as **Is not empty** with a pale-yellow fill, scoped to the
cells you had selected (or to `A1` if nothing was selected), and its editor
opens below the rule list.

From there:

- **Apply to range** — type a range and click **Apply**, or click **Use
  selected range** to fill it from your current grid selection.
- **Format rules** — pick the condition and its value (see below).
- **Formatting style** — pick what the matching cells should look like.

### Writing ranges

The range box takes A1 ranges with **both ends written out**, separated by
commas for a rule that covers several blocks:

```
A1:B10, D1:E10
```

A single cell has to be written as `A1:A1` — a bare `A1` is rejected with
*"Enter valid A1 ranges like A1:D20 or A1:B10, D1:E10."*

**Use selected range** needs a cell selection. If you have a whole row, a whole
column, or the entire sheet selected via its header, it answers *"Select a cell
range first."*

## Format Rules

The **Format rules** dropdown offers seven conditions:

| Condition | What it matches |
|-----------|-----------------|
| Is empty | The cell is blank (or holds only whitespace) |
| Is not empty | The cell holds anything else |
| Text contains | The cell's text contains what you typed, ignoring case |
| Greater than | The cell is a number greater than the number you typed |
| Is between | The cell is a number inside the two bounds, inclusive |
| Date before | The cell is a date earlier than the date you typed |
| Date after | The cell is a date later than the date you typed |

**Is empty** and **Is not empty** take no value. **Is between** shows two boxes,
**Min** and **Max** — the range is inclusive at both ends, and entering them in
the wrong order still works. The other four show a single box, prompting
*Enter text*, *Enter number*, or *YYYY-MM-DD* depending on the condition.

A few details worth knowing:

- **Greater than** and **Is between** compare numbers. Thousands separators in
  the cell or in the value you type are ignored, and a cell that isn't a number
  simply never matches.
- **Date before** / **Date after** compare whole days. `YYYY-MM-DD` is the
  format the box asks for; other date text is accepted if the browser can read
  it, and a cell that isn't a date never matches.

## Formatting Style

A rule can set any combination of:

- **Bold**, **Italic**, **Underline** toggles
- **Text color** — a palette, plus **Reset** to go back to the default color
- **Background color** — a palette, plus **None** for no fill

That's the whole list. A rule can't change number formats, borders, fonts, or
alignment.

::: warning
A rule is only saved once it is complete. A rule with **no** style at all — every
toggle off and both colors cleared — is dropped, and so is a value-taking rule
whose value box is still empty. It disappears from the panel the next time you
open it.
:::

## Rule Order and Overlap

The panel says it at the top: **rules are applied from top to bottom**. Each
rule card is numbered, and the ↑ / ↓ buttons on a card move it in that order.

When two rules match the same cell, their styles are **merged**, and the rule
lower in the list wins for the properties it actually sets. A rule that only
sets a background color leaves an earlier rule's bold and text color in place;
a rule that also sets a background color replaces the earlier one's.

Conditional formatting sits on top of every other style layer — sheet, column,
row, range, and the cell's own formatting. Where a rule matches, its properties
win.

## Edit or Delete a Rule

- Click a rule's card to select it; its range, condition, and style appear in
  the editor below.
- Click the **✕** on a card to delete the rule. The formatting for that range
  disappears immediately.

Each card also summarizes itself — the condition and value, the ranges it
covers, swatches for its colors, and a short style summary such as `B · Fill`
(or `No style`).

## Rules and Structural Edits

Rules follow the grid. Inserting, deleting, or moving rows and columns remaps
every rule's ranges to match, so a rule on `B2:B100` still covers the same cells
after a row is inserted above it.

If a rule's ranges are deleted entirely — you delete every row or column it
covered — the rule is removed with them.

## Where Rules Live

Rules belong to a **single tab** and are saved into the document, so
collaborators see the same formatting you do. A person opening the document
through a read-only share link sees the formatting too; they just don't get the
panel.

- **Sheet tabs** — fully supported.
- **Pivot table tabs** — supported; they're sheet tabs, and refreshing a pivot
  rewrites its cells without touching the rules. But a rule stays anchored to
  the cells you gave it, so a pivot that changes shape can leave a rule
  covering the wrong part of the output.
- **DataSource and Lakehouse tabs** — not supported. Those tabs render a
  read-only result grid with no formatting toolbar, so there's no way to open
  the panel on them. Shape the data in SQL instead, or copy the results into a
  sheet tab and format it there.
