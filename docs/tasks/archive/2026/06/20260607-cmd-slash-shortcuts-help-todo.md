# Cmd+/ Keyboard Shortcuts Help in Docs & Sheets

Bring the discoverable shortcut-help modal that already exists in
Slides to Docs and Sheets. Cmd/Ctrl+/ should open a categorized
list of keyboard shortcuts in every editor surface, matching the
Slides UX (see [`docs/design/slides/slides-keyboard-shortcuts.md`](../../design/slides/slides-keyboard-shortcuts.md)).

## Goals

- `Cmd/Ctrl+/` opens the help dialog in Docs and Sheets, in addition
  to the existing Slides binding.
- The dialog shape (category grouping, `kbd` chips, platform-aware
  symbols) is identical across the three apps, so the muscle memory
  is the same.
- Catalog lives in the engine package (`packages/docs`, `packages/sheets`)
  so the help and the runtime stay in one repository tree.
- No new bundle weight beyond a small list of strings; the modal is
  the existing Radix `Dialog`.

## Non-Goals

- Exhaustive coverage of every shortcut. The catalog covers the
  high-traffic shortcuts a Google-Docs / Google-Sheets user would
  reach for first; rarely used or debug shortcuts can be added later.
- Editing or customizing shortcuts.

## Plan

- [x] Add `packages/docs/src/view/shortcuts-catalog.ts` with
      `SHORTCUTS`, `formatCombo`, and the type union. Export from
      `packages/docs/src/index.ts`.
- [x] Add `packages/sheets/src/view/shortcuts-catalog.ts` with the
      sheets shortcut list. Export from
      `packages/sheets/src/index.ts`.
- [x] Add a generic `ShortcutsHelpDialog` in
      `packages/frontend/src/components/shortcuts-help-dialog.tsx`.
      Refactor `slides-shortcuts-help.tsx` to use it.
- [x] Add `docs-shortcuts-help.tsx` and `sheets-shortcuts-help.tsx`
      thin wrappers per app.
- [x] Wire `Cmd/Ctrl+/` window-level keydown in `docs-view.tsx` and
      extend the existing keydown effect in `sheet-view.tsx`.
- [x] Mount the dialogs in both views (next to find-bar).
- [x] Rebuild docs + sheets packages so the frontend tsc/tests pick
      up the new exports (consumer reads built dist).
- [x] `pnpm verify:fast` green.

## Review

- `Cmd/Ctrl+/` opens the help modal in Docs and Sheets, matching the
  existing Slides binding (`setShortcutsHelpOpen(true)` — open-only).
  Closing is handled by Esc / outside-click via Radix dialog default.
  Both handlers also early-return on `e.repeat` so a held chord
  doesn't flicker the dialog.
- The Docs text-editor does not bind `/`, and the sheets worksheet
  keymap likewise has no `/` rule, so the window-level handler in
  the frontend fires unhindered while typing inside cell-input /
  text-editor textareas.
- The shared `ShortcutsHelpDialog` widens `category` to `string`,
  so each app can keep a narrow engine-side union (`ShortcutCategory`)
  without coupling the dialog to any one package.

## Risks

- Catalog drift vs. runtime — `SHORTCUTS` is documentation, not a
  source-of-truth for the keyRules. Adding a new shortcut without
  updating the catalog leaves it undiscoverable. Mitigation:
  follow the Slides convention noted in
  `packages/slides/src/view/editor/shortcuts-catalog.ts` (dual-edit
  by convention).
