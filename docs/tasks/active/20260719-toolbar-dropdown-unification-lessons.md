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
  to Phase 2 with the reconciliation called out, keeping this PR a clean,
  zero-behavior-change refactor.
