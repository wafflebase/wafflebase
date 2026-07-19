# Toolbar Dropdown Unification — Lessons

- **Audit before assuming fragmentation.** The panels were already unified
  (single shared `dropdown-menu` + tokens). The real drift was in the container
  / trigger / separator layers. Parallel Explore agents per surface (docs /
  slides / notes / sheets) + one for the shared primitives made the true
  boundary obvious fast.

- **A shared primitive that nobody imports is a convention, not a standard.**
  `ToolbarButton` existed but every trigger re-inlined its class string, so the
  shared height only held by habit. Making it `forwardRef` (for Radix `asChild`)
  + CVA variants and adopting it in the **shared** `text-formatting` components
  propagated the standard to three editors from one edit — far higher leverage
  than migrating each editor's local buttons.

- **"No visual change" claims must survive review.** The code review caught that
  normalizing the alignment trigger (`gap-0 px-1` → `menu` `gap-0.5 px-1.5`)
  did shift ~2px, contradicting the design-doc wording. The fix was to correct
  the claim, not the code — the shift removed a real divergence. State intended
  normalizations explicitly instead of blanket "no visual change".

- **Don't ship dead styling as future-proofing.** Adding `data-[state=on]`
  selectors + promising an `active` flag with no adopter (and Radix triggers use
  `data-state="open"`, not `"on"`) was dead code the review flagged. Toggle
  buttons already have the `Toggle` primitive; `ToolbarButton` doesn't need an
  active variant. Add the seam when the adopter exists.

- **Scope splits along behavior, not just file count.** Slides section-local
  buttons use `disabled:pointer-events-none` (suppresses disabled hover) vs the
  shared `disabled:cursor-not-allowed`. Migrating them in the same PR would have
  silently changed disabled-hover behavior across dozens of buttons — deferred
  to Phase 2 with the reconciliation called out, keeping Phase 1 a clean,
  zero-behavior-change refactor.

## Phase 2

- **Fix the primitive, not the call sites.** The "no pointer cursor" bug on
  Slides was really a missing `cursor-pointer` on the shared `Toggle` base plus
  a handful of raw buttons. One base edit fixed every toggle app-wide; only the
  raw hold-outs needed touching. Same lesson as `ToolbarButton`: consistency
  lives in the primitive.

- **Sequence follow-ups by consumer-visible value, not by the doc's order.** The
  Phase 2 list led with button migration (pure DRY, zero visual change), but the
  user-visible wins were the table-picker hardcoded-blue and the color-grid
  `grid-cols-5` outliers. Did those first.

- **Changing a Radix item type changes its ARIA role — and the tests.**
  `DropdownMenuItem` → `DropdownMenuCheckboxItem` flips the role from
  `menuitem` to `menuitemcheckbox`. Seven tests querying `[role="menuitem"]`
  went red. That's expected test maintenance for an intentional change, not a
  regression — widen the query to match both roles. Always run the full suite
  after a primitive/role swap, not just lint.

- **Give migration subagents the current-value expression, not just "add a
  check."** For the left-check conversion, the reliable instruction was "reuse
  the exact variable the trigger already uses to show the current value, and if
  you can't determine it, leave it and report." Every subagent found the right
  `checked={…}` (e.g. `currentFormat === "percent"`, `value?.width === w`)
  because the hint pointed at existing state rather than asking them to invent it.

- **Adversarial review catches a11y regressions a human skims past.** The
  high-effort review flagged that the shared `ColorPickerGrid` erased the
  text-vs-background swatch `aria-label` distinction — a screen-reader-only
  regression invisible in a visual smoke. Fixed with an optional `colorKind`
  prop that also improved Docs/Sheets.
