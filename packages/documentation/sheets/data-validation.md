# Data Validation

Data validation adds interactive **in-cell controls** — checkboxes, dropdown
lists, and a date picker — and guards a range against bad input. A control is
not a floating object on top of the grid; it's a special rendering of the cell's
own value, so it survives sorting, filtering, and copying, and works directly in
formulas.

## Open the Data Validation Panel

Open the right-side **Data validation** panel in either of these ways:

- Click the **Data validation** icon in the toolbar
- Right-click a cell and choose **Data validation**

On a narrow screen, the toolbar collapses its extra tools into an overflow
(**⋯**) menu — open it and choose **Data validation** there.

## Add a Rule

1. Click **Add** in the panel to create a rule
2. Set **Apply to range** — type a range like `B2:B100`, or click **Use selected
   range** to fill it from your current selection, then click **Apply**
3. Pick a **Criteria** (see below)
4. Choose what happens on invalid input — **Show a warning** or **Reject the
   input**

You can add several rules per sheet; each appears as a card you can edit or
delete.

## Criteria

### Checkbox

Turns each cell in the range into a checkbox storing `TRUE` or `FALSE`.

- **Click** the box to toggle it
- Select one or more cells and press **Space** to toggle them together
- Because the value is a real boolean, `=COUNTIF(B2:B100, TRUE)` and similar
  formulas work as expected

### Dropdown

Restricts the cell to a list of options you type, one per line. A dropdown arrow
appears in the cell.

- **Click** the arrow — or press **Alt+↓** — to open the option picker
- Toggle **Show dropdown arrow** to hide the arrow while keeping the rule
- Values outside the list are flagged (warning) or blocked (reject), per the
  rule's invalid setting

### Date

Validates that the cell holds a date, with an operator:

| Operator | Meaning |
|----------|---------|
| is a valid date | Any valid date |
| date is | Equals a specific date |
| is before / is on or before | Earlier than a date |
| is after / is on or after | Later than a date |
| is between / is not between | Within (or outside) two dates |

**Double-click** a date-validated cell to pick a value from a calendar popover
instead of typing it.

### Number

Validates numeric input with an operator:

- is a valid number
- is equal to / is not equal to
- greater than / greater than or equal to
- less than / less than or equal to
- between / not between

### Text

Validates text input:

- contains / does not contain
- is exactly
- is valid email
- is valid URL

## Handling Invalid Input

Each rule chooses how to treat a value that fails validation:

- **Show a warning** — the value is accepted but the cell gets a small red
  marker in its corner, so you can spot it and fix it later
- **Reject the input** — the entry is refused and the cell keeps its previous
  value

::: tip
Use **warning** while cleaning up existing data so nothing is lost, and switch
to **reject** once a column should only ever hold valid values.
:::

## Remove a Rule

Open the **Data validation** panel and click the delete (trash) icon on the
rule's card. The in-cell controls for that range are removed and the cells go
back to plain values.
