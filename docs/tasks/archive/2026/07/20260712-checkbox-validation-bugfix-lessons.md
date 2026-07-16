# Lessons — checkbox data-validation bug fixes

## Fixing a "make it case-insensitive" toggle — gate on *all* custom values

The first cut gated the case-insensitive branch on `checkedValue === undefined`
alone. The high-effort review caught that a rule with a default `checkedValue`
but a custom `uncheckedValue` whose uppercase is `"TRUE"` (e.g.
`uncheckedValue: "true"`, settable via REST API / Yorkie model with no UI
pairing them) would render its *unchecked* value as **checked** and, on click,
overwrite it with canonical `FALSE`.

**Rule:** when relaxing an equality check for one field of a pair (checked /
unchecked), the relaxation must be gated on the *whole* pair being default, not
just the field you're touching. A half-default rule is still a custom rule and
must stay exact-match.

## Per-repaint helpers must not allocate

`isCheckboxChecked` runs from `renderCellCheckbox` for every visible checkbox
every frame. The sibling `isValidListValue` in the same file documents a
deliberate no-allocation convention ("runs per visible cell per repaint"). A
naive `value.toUpperCase()` broke it. Fix: short-circuit the canonical
`TRUE`/`FALSE` (what `setData`/toggle always write) with plain `===` before the
`toUpperCase` fallback, so only the rare import-lowercase path allocates.

**Rule:** before adding a string transform to a function, check whether it sits
on a per-repaint / per-visible-cell path; if so, fast-path the common exact
case and confine allocation to the rare branch.

## One guard at the model layer covers multiple view entry points

Both the mouse-click (`worksheet.ts:3405`) and Space-key (`worksheet.ts:4853`)
paths call `Sheet.toggleCheckboxAt`. Putting the formula read-only guard inside
`toggleCheckboxAt` (return `false` when `cell.f`) fixed both with one change and
needed no view-layer edit — the callers already treat a `false` return as
"nothing changed." Prefer guarding at the shared model method over each caller.
