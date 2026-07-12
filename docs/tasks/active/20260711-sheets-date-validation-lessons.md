# Sheets Date Data Validation — Lessons

## Design

- **Generic `operator` + `values[]` beats date-specific fields.** The rule model
  uses a shared `DataValidationOperator` union and a `values: string[]` array
  rather than `dateOperator`/`dateValue`/`dateValueMax`. Number/text validation
  (the planned next kinds) reuse the identical "operator + 0/1/2 operands" shape,
  and one panel section drives all comparison kinds. The old placeholder
  `dateMin`/`dateMax` were dead (no readers) and were removed cleanly.

- **Incomplete operands must degrade, never misposition.** The first review
  (Task 1) caught that a skip-and-continue normalize loop turned a `dateBetween`
  with a blank lower bound (`['', '2026-02-10']`) into `['2026-02-10']` at index
  0 — silently promoting an upper bound to a lower bound. Fix: **stop at the
  first operand gap** so positions never shuffle, and let `isValidDateValue`
  treat `operands.length < need` as "validate it is a date only." This keeps a
  partially-filled panel rule safe (degrades to `dateValid`) instead of wrong.

- **One validity predicate, dispatched by kind.** `isValidValueForRule`
  (list→`isValidListValue`, date→`isValidDateValue`, else `true`) let the commit
  reject and hover tooltip generalize from list-only to kind-agnostic with a
  single call site each; only the user-facing *message* branches on kind.

- **Reuse `inferInput`, don't parse dates.** A date cell already stores ISO
  `yyyy-mm-dd`, and ISO strings compare lexicographically = chronologically, so
  the whole comparison layer is string `<`/`>` with no date library. Operands
  are normalized to a pure `yyyy-mm-dd` (slice off any datetime time part).

## Architecture

- **No store change needed for a new rule field.** Both `MemStore` and
  `YorkieStore` funnel every rule through `normalizeDataValidationRule` +
  `cloneDataValidationRule`, and structural edits go through the shared
  `rule-ranges` helper (`{...clone(normalized), ranges}`). Making
  `cloneDataValidationRule` deep-copy `values` was the *only* plumbing change —
  the new fields then rode through persistence and row/col shift/move for free.
  Verify the choke points rather than assuming; a field-whitelisting store
  (like the per-cell `normalizeCell`) would have silently dropped them.

- **Calendar picker mirrors `listPopover` exactly.** The date picker is a raw
  `document.createElement('div')` overlay on `document.body`, not a React/shadcn
  component (there is no shadcn calendar in the app, and the list dropdown set
  the in-tree precedent). Cloning the list popover's lifecycle — constructor
  create/style/append, dispose `.remove()` + hide, Esc + outside-click unsub on
  hide *and* dispose — kept it leak-free and consistent.

## Process

- **Concurrent session took over the shared checkout mid-task.** After Task 1
  committed, a parallel session checked out `sheets-xlsx-style-import` and popped
  the parked xlsx stash, moving the primary checkout off our branch and
  clobbering an in-flight edit. Our commits were safe on `sheets-date-validation`
  (reflog + `git branch --contains` confirmed). Recovery: create an isolated
  **git worktree** for the branch (`~/Development/wafflebase/wafflebase-dateval`)
  and run all further work there. See memory `project_concurrent_session_stash`.
  A fresh worktree needs `pnpm install` and the workspace **library dists built**
  (`docs`/`sheets`/`slides`) before the pre-commit `verify:fast` can typecheck
  cross-package imports.

- **`docs/superpowers/` is blocked by a commit hook.** Only `docs/design/` and
  `docs/tasks/` are permitted. The SDD plan lives at
  `docs/tasks/active/YYYYMMDD-<slug>-plan.md`, not the skill's default
  `docs/superpowers/plans/`.

- **Multi-line `git commit -m` mangles in this shell.** Use `git commit -F
  <file>` with the message written to a scratch file.

## Deferred (documented follow-ups)

- Relative operands (`today`/`past week`); reject-on-paste/API (only typed
  commit is enforced); keyboard day-navigation in the picker; i18n for calendar
  labels; a visible `<Label>` for the operand inputs; automated coverage for the
  Canvas render + DOM popover + panel paths (interactive smoke deferred to a
  manual pass, matching the checkbox/list phases).
