# Color Palette Auto-close on Selection

Branch: `fix/color-palette-auto-close`

## Status

Implementation done, `pnpm verify:fast` green, lessons captured. Ready to
commit + PR.

## Problem

In sheets / docs / slides toolbars, clicking a color swatch inside the Text /
Highlight / Fill / Background / Border color dropdowns applies the color but
**leaves the palette open**. Google Sheets/Docs/Slides parity (and user
expectation) is for the palette to close on selection.

Root cause: all swatches are plain `<button>` elements inside Radix
`DropdownMenuContent`. Radix only auto-closes the menu when a
`DropdownMenuItem` is activated, so the menu stays open.

## Approach (option 1)

Keep the swatches as plain buttons (do not convert to `DropdownMenuItem` — that
changes focus/keyboard semantics for the grid). Instead, make each `DropdownMenu`
controlled (`open` / `onOpenChange`) at the call site and call `setOpen(false)`
after the picker's `onSelect` / `onReset` / `onChange` fires.

Affected dropdowns (9 sites total):

| # | File | Dropdown | Picker |
|---|------|----------|--------|
| 1 | `packages/frontend/src/components/formatting-toolbar.tsx` | Text color | ColorPickerGrid |
| 2 | `packages/frontend/src/components/formatting-toolbar.tsx` | Fill color | ColorPickerGrid |
| 3 | `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` | Text color | ColorPickerGrid |
| 4 | `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` | Highlight color | ColorPickerGrid |
| 5 | `packages/frontend/src/components/text-formatting/text-format-group.tsx` | Text color (text-edit overlay) | ColorPickerGrid |
| 6 | `packages/frontend/src/components/text-formatting/text-format-group.tsx` | Highlight color | ColorPickerGrid |
| 7 | `packages/frontend/src/app/slides/toolbar/text-element-controls.tsx` | Text box background | ThemedColorPicker |
| 8 | `packages/frontend/src/app/slides/toolbar/shape-controls.tsx` | Shape fill | ThemedColorPicker |
| 9 | `packages/frontend/src/app/slides/toolbar/global-controls.tsx` | Slide background | ThemedColorPicker |
| 10 | `packages/frontend/src/app/slides/toolbar/border-picker.tsx` | Border color | ThemedColorPicker |

(The non-color dropdowns in `border-picker.tsx` — weight + dash — already use
`DropdownMenuItem` and close correctly.)

## Plan

- [x] Add failing test reproducing "menu stays open after color click"
      against the real `BorderPicker` (slides) — covers the
      `ThemedColorPicker` flow.
- [x] Sheets — controlled open on text + fill color dropdowns
      (`formatting-toolbar.tsx`).
- [x] Docs — controlled open on header/footer slim text + highlight
      dropdowns (`docs-formatting-toolbar.tsx`) **and** added
      `onCloseAutoFocus={(e) => e.preventDefault()}` so `editor?.focus()`
      in the handler isn't clobbered by Radix's default focus-trigger
      behavior on close. Controlled open on body / slides text-edit
      shared dropdowns (`text-format-group.tsx`).
- [x] Slides — controlled open on `text-element-controls`,
      `shape-controls`, `global-controls`, and `border-picker` color
      dropdowns.
- [x] `pnpm verify:fast` green (EXIT=0, 899 passed / 1 skipped).
- [ ] Manual smoke in `pnpm dev` for each region — pending.
- [ ] Lessons file + archive + commit + push + PR — lessons done, rest
      pending.

## Non-goals

- Keyboard navigation overhaul of the grid (out of scope; pre-existing).
- Custom color input behavior in `ThemedColorPicker` (native `<input
  type="color">` flow stays as-is — committing an OS color picker selection is
  intentionally non-blocking; we don't auto-close on `<input>` change).
