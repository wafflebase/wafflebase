# Data Validation Phase 2 — List / Dropdown

Design: `docs/design/sheets/data-validation.md`
Predecessor: Phase 1 (checkbox) shipped in #460.

## Scope (decided)

- **Phase 2 only**: `kind: 'list'` dropdown.
- **Literal value lists only** (v1). Range-source lists (`=Sheet1!A1:A10`),
  colored chips, and custom-formula criteria stay Non-Goals.

## Goals

- Dropdown-arrow glyph rendered at the cell's right edge when `showArrow`.
- Click arrow / edit-entry → anchored DOM popover listing `rule.list`;
  selection writes the chosen text via `store.set` (batched = one undo unit).
- Typed-value commit validation using `resolveDataValidationAt` + list membership:
  - `onInvalid: 'reject'` → discard input, keep previous value, error toast.
  - `onInvalid: 'warning'` → store value; render a red warning triangle.
- Read-only stores/permissions render the arrow but disable interaction.
- Structural edits (row/col insert/delete/move) already carry list rules via the
  shared `shiftRuleRanges`/`moveRuleRanges` path — verify, add tests.

## Non-Goals (this phase)

- Range-backed list source.
- Colored dropdown chips / smart chips.
- Date picker (Phase 3).
- Full `Data → Data validation` side panel (a later phase; ship quick-insert here).

## Plan (insertion points — fill exact line refs from code map)

### Model (`packages/sheets`)
- [ ] `data-validation.ts`: `isListValueValid(rule, value)`, `normalizeListRule`
      (dedupe/trim list, default `showArrow: true`).
- [ ] `sheet.ts`: `insertDropdown(range, list, opts)` / `removeDropdown(range)` /
      `isDropdown(ref)` mirroring the checkbox methods; dataValidations cache sync.
- [ ] Store: no new Store surface needed (reuses get/setDataValidations) — confirm.

### Spreadsheet API (`spreadsheet.ts`)
- [ ] `insertDropdown` / `removeDropdown` public API wrapping store in beginBatch/endBatch.

### Rendering (`gridcanvas.ts`)
- [ ] Extend Pass 3.5: draw dropdown-arrow glyph (cached Path2D) at cell right edge
      for `kind:'list'` + `showArrow`. Value text still drawn by renderCellContent.
- [ ] `computeDropdownArrowBox(cellRect)` geometry helper shared with hit-test.
- [ ] Warning triangle (top-right) for `onInvalid:'warning'` violations — reuse
      comment-marker technique.

### Interaction (`worksheet.ts`)
- [ ] Extend `detectValidationControl` to hit-test the arrow box → open list popover.
- [ ] List popover: reuse the filter-panel DOM overlay pattern, anchored to cell rect.
      Keyboard nav (Up/Down/Enter/Esc); selection writes via store.set (batched).
- [ ] Edit-entry (start typing / Enter on a list cell) opens the popover too.
- [ ] Commit-path validation hook in the cell-input commit (reject/warning).
- [ ] Gate every mutation on store writability.

### Frontend UI (`packages/frontend`)
- [ ] Toolbar/menu `Insert → Dropdown` quick action over the current selection
      (mirror the checkbox toolbar button; desktop + mobile). Minimal list-entry
      prompt/popover for the literal values.

### Tests
- [ ] `data-validation.test.ts`: `isListValueValid` (member/non-member, empty),
      `normalizeListRule`, resolve precedence with list rules.
- [ ] gridcanvas render: arrow glyph + warning triangle snapshots.
- [ ] interaction: arrow hit-test opens popover; selection writes value; reject
      discards; writability gate.
- [ ] structural-edit rule shift/move for list rules.

## Verification
- [x] Sheets typecheck (`tsc --noEmit`) clean; frontend typecheck clean.
- [x] `pnpm verify:fast` green (lint + all unit; 1332 sheets + 1083 repo tests).
- [x] Frontend production build clean.
- [ ] **Live browser smoke — deferred.** The running `:5173` dev server belongs
      to a *different worktree* (`wafflesheets`); its backend (`:3000`) has CORS
      pinned to `http://localhost:5173`, so a second frontend on another port is
      CORS-blocked, and restarting the shared backend would disrupt that
      session. Run in this worktree's own `pnpm dev`: insert dropdown → pick
      value → arrow renders → typed reject vs warning → sort/copy moves value →
      read-only viewer can't change.

## Review

Shipped in two commits on `feat/data-validation-list`:
1. `Sheets data validation: list dropdown control (engine + view)` — model
   helpers, Sheet/Spreadsheet API, render pass, interaction + commit validation.
2. `Sheets dropdown UI: toolbar button, options dialog, reject toast` — frontend.

All layers mirror the Phase-1 checkbox precedent. Design doc updated with a
"Phase 2 (list / dropdown) — as shipped" subsection. Remaining: Phase 3 (date
picker), and the deferred live smoke above.

## Lessons
- See `20260710-data-validation-list-lessons.md`.
