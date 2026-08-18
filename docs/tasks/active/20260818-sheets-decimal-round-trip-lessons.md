# Decimal round trip — Lessons

Running log of non-obvious findings while implementing
`20260818-sheets-decimal-round-trip-todo.md` (issue #845).

## Context

- Design: `docs/design/sheets/sheet-style.md` (write semantics, patch lifecycle)
- Residue family: #749 (`italic: false`), #793 (`backgroundColor: ''`)

## Lessons

- **`pruneRedundantDefaultStyleKeys` already erases some residue, but only at
  the key's *default* value.** `DefaultStyleValues` in
  `packages/sheets/src/model/worksheet/style-mutation.ts` carries `dp: 2`, so
  writing `dp: 2` self-erases while `dp: 0` — the value the reported bug leaves
  behind — is stored. That is why #749/#793 needed no new machinery and this one
  does: the residue here is not a default value, it is an *inferred* one.
- **`nf: 'number'` with no `dp` renders 2 decimals** (`formatValue`,
  `packages/sheets/src/model/worksheet/format.ts:107`). So removing `dp` while
  leaving `nf: 'number'` is not a no-op on screen — `12` would start rendering
  as `12.00`. Any unset that restores an unstyled cell has to drop both keys
  together.
- **The stored style model has no "explicitly none" token**, so an unset can
  only remove keys from layers the selection fully owns; an inherited
  column/row/sheet value cannot be masked. `unsetRangeStyleKeys` therefore
  reports failure instead of writing a partial result, and the caller keeps the
  old explicit-write path for that case — which stays correct, because when an
  upstream layer does set `dp`, an explicit value is the only way to reach the
  target precision.
- **An unset that ignores values destroys formatting it does not own.** The first
  cut removed `dp`/`nf` from every owned layer *and every cell* in the selection,
  keyed only off the active cell. Select-All plus one Decrease click then wiped
  currency and percent formats sheet-wide, leaving orphan `{cu: 'USD'}` — worse
  than the bug being fixed, and something `setRangeStyle` never did because its
  column/row/sheet branches never touch cells at all. Rule: an unset has to name
  the value it expects and refuse when a layer inside the selection disagrees,
  which is why the API is `unsetRangeStyleValues(style)` and not
  `unsetRangeStyleKeys(keys)`. Found by an adversarial review pass, not by the
  round-trip tests, which all used uniformly styled selections.
- **Who wrote `nf` is unknowable.** Increase/decrease set `nf: 'number'`
  whenever the format is plain/absent, and nothing distinguishes that from a
  user-chosen number format later on. The rule adopted here (drop `nf` only when
  `dp` is being dropped *and* the target equals the value's own precision) keeps
  rendering identical at the moment of the click; the cost is documented in the
  todo's "Known deviation".
