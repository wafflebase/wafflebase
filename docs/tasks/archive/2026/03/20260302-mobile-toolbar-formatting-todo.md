# Mobile Toolbar Formatting Actions

Add text formatting (bold, italic, strikethrough) and color options to the
mobile toolbar overflow menu.

## Context

The mobile toolbar currently exposes: undo, redo, paint format (inline),
plus number formats, filter, alignment, and borders in the overflow menu.
Text formatting (bold/italic/strikethrough) and color pickers are missing
on mobile, though they are available on desktop.

## Status: Already Implemented

Upon investigation, all items are already present:

- [x] Bold and Italic — always visible on mobile toolbar (Toggle buttons)
- [x] Strikethrough — in mobile overflow menu
- [x] Text color — always visible (dropdown with 20-color palette)
- [x] Background color — always visible (dropdown with 20-color palette)
- [x] Overflow menu sections — logically grouped (Format → Filter → Align → Borders → Text style → Tools)

No code changes needed. Task was created before exploring the existing
toolbar implementation.
