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

## Phase 2 (this session, continued)

Sequenced by consumer-visible value (fix real inconsistencies before pure DRY):

- [x] **Table picker unification** — Slides `TablePicker` now wraps the shared
      `TableGridPicker` (token `bg-primary/20 border-primary` highlight) instead
      of its own fixed 8×8 grid with hardcoded Google-blue `rgba(26,115,232)`.
- [x] **Color-grid consolidation (partial)** — `conditional-format-panel`
      dropped its hand-rolled `grid-cols-5` swatch grid for the shared
      `ColorPickerGrid` (`grid-cols-8`, `NoneSwatch` reset). Merging
      `ThemedColorPicker` ↔ `ColorPickerGrid` (theme-role superset) is left as a
      later step — higher coupling, overlaps PR #2's swatch generator.
- [x] **Disabled-state standard** — `ToolbarButton` base moved to
      `disabled:pointer-events-none` (shadcn convention; no hover highlight on
      disabled), so migrating the Slides buttons is behavior-preserving.
- [x] **Button migration** — remaining editor-local raw triggers →
      `ToolbarButton` in Docs (`docs-formatting-toolbar`, 6), Sheets
      (`formatting-toolbar`, 16), and the Slides `toolbar/*` sections. Skips the
      genuinely-different button types (primary/Done, split buttons, bordered
      pills, the `min-w` zoom trigger, the export header button).
- [x] **cursor-pointer consistency** (user-flagged) — Slides buttons showed the
      default arrow cursor on hover. Added `cursor-pointer` to the shared
      `Toggle` primitive base (fixes every toggle app-wide) and to the remaining
      raw Slides buttons (zoom, slide-group, Done, mobile triggers, shape/line
      grid cells, table trigger).
- [x] **Selected-item indicator standard** (user-flagged) — the "current value"
      check was left in Notes, right (hand-rolled) in Docs line-spacing / Slides
      padding, and absent elsewhere. Standardized every single-select value menu
      on the native Radix left check (`DropdownMenuCheckboxItem`, matching
      Notes): Docs (font family/size, line spacing, text style, alignment, slim
      align), Sheets (number format, H/V align), Slides (zoom, border
      weight/dash, table padding). Action menus (borders, arrange, insert,
      overflow) correctly keep no indicator; grid-style pickers (themed-font,
      line, shape) keep their highlight. Tests that queried `[role="menuitem"]`
      were widened to also match `[role="menuitemcheckbox"]`.

### Phase 2 self-review (workflow, high effort) — resolved

- **Color-swatch aria-label regression** (conditional-format lost text-vs-bg
  distinction under the shared grid) → added an optional `colorKind` prop to
  `ColorPickerGrid`; wired "text color" / "background color" / "highlight color"
  in conditional-format + text-format-group.
- **Slides table-picker default trigger** still raw → migrated to `ToolbarButton`.
- Menu-trigger `gap-0 px-1 → gap-0.5 px-1.5` and the table-legend
  clamp-to-10-on-edge behavior are accepted-by-design (intended normalization /
  shared `TableGridPicker` parity with Docs+Notes), documented in the design doc.

Still deferred to a later pass: `DropdownMenuShortcut` adoption + icon-size /
panel-width constants, a `Popover` primitive for the color pickers, and merging
`ThemedColorPicker` ↔ `ColorPickerGrid`.

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
