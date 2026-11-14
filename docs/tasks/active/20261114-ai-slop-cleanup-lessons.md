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

### Step 3 — clarify
- Split across two agents on disjoint paths (app copy + CLI / brand + docs);
  both still touched `login-form.tsx` — the edits merged, but declare shared
  files up front next time.
- Review (truthfulness lens, independent agent) found 3 blockers, all fixed:
  the features sub claimed comments + version history for every type
  (comments exist in sheets/docs/PDF only; history in the five CRDT types),
  "the whole stack ships as one Docker image" (backend only), and the docs
  site still named ~30 UI labels this step renamed.
  Lesson: a copy rewrite that removes slop can *add* claims; fact-check each
  new sentence against code, and grep the docs for every UI label you rename.
- Non-blocking, fixed: hero said "servers you run" on a page the hosted
  deployment also serves; three leftover "Failed to"; four dialogs now opt
  out of a description explicitly (`aria-describedby={undefined}`); new
  `LoadErrorState` test.

### Step 4 — harden
- Review (a11y + touch lens, independent agent): nothing blocking; one
  should-fix caused by this step. Removing `maximum-scale=1` re-enabled
  iOS focus-zoom on every sub-16px field (find bars, link popover, tab
  rename, SQL editor, sheets filter/validation, function browser). Fixed
  with the repo's `text-base md:text-sm` convention and a coarse-pointer
  16px helper in the sheets engine.
  Lesson: a viewport-meta flag is load-bearing in more than one way —
  `user-scalable=no` was blocking double-tap zoom *and* focus zoom; trace
  every effect before removing it.
- Fixed: a global `caret-color` would vanish on filled cells, so the syrup
  caret is scoped to `ui/input`. Selection keeps `color: var(--foreground)`
  (muted/syrup text fall under 4.5:1 otherwise) with a
  `data-selection="dark"` opt-out for the always-dark terminal.
- Known limitations (PR body): `ring/50` focus rings are ~1.9:1 (repo-wide
  shadcn/DESIGN.md convention, not changed here); pinch starting on a
  sheet image still zooms the page; slides canvas menu has no menu roles
  (pre-existing); sheets cell editor stays 13px on iPhone landscape ≥768px.

### Step 5 — typeset
- Review: self (mostly class swaps); overflow risk from 33 `text-[11px]` →
  `text-xs` deferred to the visual-golden diff at the end.
- The hero `<em>` computes to weight 500, not the 600 the brief assumed —
  load the italic for the *computed* weight, then guard with
  `font-synthesis-style: none` so a missing face can't fake it again.
- Fixed: DESIGN.md said mono covers "category/tag chips" but tag chips are
  sans; narrowed to the template category chip.

