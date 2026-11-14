# AI-slop cleanup — lessons

## Per-step review log

### Step 1 — distill
- Review: diff read in full + 1440/390 render. No blockers. Kicker findings 7 → 0 on `/`.
- Note: the `:5173` dev server on this machine serves a *different* checkout
  (`waffledocs`). Before trusting a screenshot, check which tree the server is
  serving; "after" shots come from a separate Vite on `:5181`.
- Left for later steps: heading copy (step 3), `SectionHead` `mt-4 m-0`
  class conflict (step 6).

### Step 2 — colorize
- Review (correctness lens, independent agent): nothing blocking; canvas
  consumers all get hex/rgba, every new Tailwind class has a `--color-*`.
- Fixed from review: the brief's "header selected → butter wash" inverted
  the sheets header hierarchy (whole-column header paler than a partly
  selected one) and made the filter button's hover stronger than pressed.
  Whole-row/column header is now a syrup tint; filter hover a neutral wash.
  Lesson: when retinting a state, check it against its sibling states, not
  just against the old value.
- Fixed: DESIGN.md claimed one "same butter wash" across engines; the
  opacities differ (16–35%), so the text now says so.
- False alarm worth remembering: a screenshot showed the Bold toggle "off"
  because each script run flips persisted cell state. Probe state
  (`aria-pressed`, computed bg) before blaming a token.
- Known/visible, intentional: sidebar sub-item icons lose their syrup tint.

