# Decimal round trip — Lessons

Running log of non-obvious findings while implementing
`20260818-sheets-decimal-round-trip-todo.md` (issue #845).

## Context

- Design: `docs/design/sheets/sheet-style.md` (write semantics, patch lifecycle)
- Residue family: #749 (`italic: false`), #793 (`backgroundColor: ''`)

## Lessons

- **`pruneRedundantDefaultStyleKeys` already erases some residue, but only at
  the key's *default* value.** `DefaultStyleValues` in
  `packages/sheets/src/model/worksheet/style-mutation.ts` deliberately has no
  `dp` entry, so every written `dp` is stored — including the `dp: 0` the
  reported bug leaves behind. Adding `dp: 2` there was the first idea and it is
  wrong: it would make "no stored `dp`" and "`dp: 2`" the same state, and
  `explicitDp` — the signal that a stored `dp` is the buttons' own to remove —
  depends on telling them apart. That is why #749/#793 needed no new machinery
  and this one does: the residue here is not a default value, it is an
  *inferred* one, and no default table can erase it.
- **`nf: 'number'` with no `dp` renders 2 decimals** (`formatValue`,
  `packages/sheets/src/model/worksheet/format.ts:119`). So removing `dp` while
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
  user-chosen number format later on. Provenance being unavailable, the rule is
  about *effect*: the unset only fires where it changes nothing on screen
  (`unsetKeepsRendering`). The cost is documented in the todo's "Known
  deviation".
- **"Unset `dp` means the value's own precision" is only true for plain and
  `number`.** For `currency`/`percent` an absent `dp` means the *format's*
  default of 2, so unsetting a `dp: 0` currency would silently add decimals —
  a decrease click that increases what is shown. And `nf: 'number'` groups
  thousands, so dropping it flattens `1,234.5` to `1234.5`. Both are caught by
  comparing `formatValue` before and after rather than by reasoning about
  `dp` alone; the comparison also subsumes the "does every cell in the
  selection agree about its precision" check that came before it. The price is
  that a value ≥ 1000 keeps a `{dp, nf: 'number'}` residue after a round trip —
  a residue that renders correctly is better than a format silently destroyed.
