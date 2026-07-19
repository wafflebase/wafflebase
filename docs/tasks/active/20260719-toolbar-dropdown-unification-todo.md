# Toolbar Dropdown Unification — Todo

Unify toolbar dropdown styling across docs / slides / notes / sheets editors.

## Background

A UI-consistency audit found the dropdown **panels** are already unified (all
route through the shared `components/ui/dropdown-menu` Radix wrapper + design
tokens), but the **container / trigger / separator** layers diverge:

1. `ToolbarButton` primitive exists but is dead code — every trigger re-inlines
   the same `h-7 w-7 ... hover:bg-muted` class string (~26 icon + ~4 menu sites).
2. slides toolbar overrides the shared `Toolbar` to `h-10 gap-1` (40px) while
   docs/sheets/notes use the compact shared default (≈36px, gap-0.5).
3. notes rolls its own toolbar container + `Divider` (`bg-border`, thinner)
   instead of the shared `Toolbar` / `ToolbarSeparator`.

Deferred to Phase 2 (see design doc): color-grid consolidation
(`ColorPickerGrid` vs `ThemedColorPicker` vs conditional-format grid), table
picker consolidation (`TableGridPicker` vs slides `TablePicker` hardcoded blue),
`DropdownMenuShortcut` adoption, a `Popover` primitive, and migrating the two
large single-editor toolbars (docs/sheets) — those already match visually.

## Plan (this PR = Phase 1)

- [x] Enhance `components/ui/toolbar.tsx` `ToolbarButton`: `forwardRef` (so it
      slots into `DropdownMenuTrigger`/`TooltipTrigger asChild`) and a
      `variant: "icon" | "menu"`. (No `active`/pressed variant — pressed toggle
      buttons stay on the `Toggle` primitive, so it would be dead styling.)
- [x] Adopt `ToolbarButton` in the shared `text-formatting` components
      (`text-paragraph-group`, `text-format-group`, `insert-link-button`) — this
      propagates the standard to docs + slides + sheets at once.
- [x] P3: notes-toolbar → shared `Toolbar` + `ToolbarSeparator`; raw trigger
      buttons → `ToolbarButton`.
- [x] P2: slides `toolbar/index.tsx` → drop the `h-10 gap-1` / `mx-1` overrides,
      converge on the compact shared default. (Slides `toolbar/*` section-local
      raw buttons deferred to Phase 2 — see design doc — to avoid the
      disabled-state behavior mismatch in one PR.)
- [x] Design doc (A): add a "Toolbar dropdown unification" section to
      `docs/design/design-system-unification.md` with the audit + phased plan.
- [x] `pnpm verify:fast` green; visual smoke of the slides toolbars in the
      `/harness/visual` route.
- [x] Self code-review over the branch diff (workflow, high effort).

## Decisions

- **Toolbar density → compact** (option A). Minimal blast radius: 3 apps already
  use it and it is the shared `Toolbar` default; only slides shrinks ~4px.
  (User was AFK on the confirm prompt; recorded as the recommended default.)

## Review

- **Scope landed:** `ToolbarButton` is now a `forwardRef` + CVA primitive
  (`icon`/`menu`) adopted by the shared `text-formatting` group (→ docs/slides/
  sheets) and the notes toolbar. Slides toolbar container converged on the
  compact shared default; notes moved off its copied container + custom
  `Divider`.
- **Verification:** `pnpm verify:fast` green (1083 + 27 unit tests, lint, tsc).
  Visual smoke of `slides-toolbar-idle` and `slides-toolbar-text-editing` in
  `/harness/visual` confirmed the migrated align/list/indent/clear-format
  triggers render correctly at the new compact height.
- **Self review (workflow, high effort):** 0 correctness bugs. 3 cosmetic
  findings, all resolved:
  1. Dead `data-[state=on]` styling + unwired `active` prop on the CVA base —
     removed (toggle buttons stay on the `Toggle` primitive; Radix triggers use
     `data-state="open"`, not `"on"`, so it was also non-matching).
  2. Alignment trigger `gap-0 px-1` → `menu` variant `gap-0.5 px-1.5` is a ~2px
     intentional normalization (now matches notes/slides menu triggers) — kept
     the code, corrected the design doc's "no visual change" wording.
  3. Slides ~40px → ~36px height is the intended P2 change; verifier confirmed
     no taller sub-control (zoom/group are `h-7`) breaks vertical alignment.
