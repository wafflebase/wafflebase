# Mobile Toolbar Formatting Actions

Add text formatting (bold, italic, strikethrough) and color options to the
mobile toolbar overflow menu.

## Context

The mobile toolbar currently exposes: undo, redo, paint format (inline),
plus number formats, filter, alignment, and borders in the overflow menu.
Text formatting (bold/italic/strikethrough) and color pickers are missing
on mobile, though they are available on desktop.

## Tasks

- [ ] Add text formatting section to mobile overflow menu
  - Bold, Italic, Strikethrough toggles
  - Show active state when selection has the format applied
- [ ] Add text color and background color to mobile overflow menu
  - Reuse existing color picker component or adapt for mobile
  - Consider a compact color palette optimized for touch
- [ ] Group overflow menu sections logically (text style → colors → numbers → alignment → borders)
- [ ] Update design doc `design/frontend.md` mobile toolbar section
- [ ] Add visual regression baselines for updated overflow menu
- [ ] Run `pnpm verify:fast` and confirm pass
