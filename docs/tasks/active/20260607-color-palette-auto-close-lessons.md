# Color Palette Auto-close — Lessons

## What I learned

### Radix DropdownMenu only auto-closes on `DropdownMenuItem`

The trap: a Radix `<DropdownMenu>` wrapping arbitrary content (a grid of
`<button>` swatches in this case) does **not** auto-close when a child
button is activated. Only `DropdownMenuItem` (and friends — `RadioItem`,
`CheckboxItem`) wire into Radix's selection-close pathway.

If you have a custom grid/picker UI that shouldn't be styled as menu items,
either:

1. Make the wrapping menu controlled (`open` + `onOpenChange`) and call
   `setOpen(false)` after the action — what we did here.
2. Wrap each interactive element in `<DropdownMenuItem asChild>` — keeps
   auto-close but inherits item styling/focus semantics; usually wrong for
   grid pickers because keyboard navigation is item-based, not 2D.

### Watch for focus regressions when adding programmatic close

The Docs body / Slides text-edit overlay already set
`onCloseAutoFocus={(e) => e.preventDefault()}` because they want focus to
stay on the canvas caret (not jump to the trigger button) when the menu
closes via outside-click. The Docs **header/footer slim toolbar** didn't —
because the palette never used to close at all. Once we made it auto-close,
the handler's `editor?.focus()` was instantly clobbered by Radix's default
"focus the trigger" behavior. Fix: add the same `onCloseAutoFocus` prevent
on the slim header/footer dropdowns.

Rule of thumb: whenever a handler ends with `editor?.focus()`, the parent
dropdown that's about to close needs `onCloseAutoFocus={(e) =>
e.preventDefault()}` — otherwise the close steals focus right back.

### Testing a real-portal Radix menu under jsdom

Radix portals `<DropdownMenuContent>` into `document.body`, so the test
must query swatches via `document.body`, not the render host. The
font-family-picker test was a good template: dispatch a full
`pointerdown → pointerup → click` sequence on the trigger to open
(Radix listens to pointer events, not synthetic `.click()` alone), then
the same sequence on a swatch inside the portal.

## What went well

- Wrote a failing test first against the real `BorderPicker` (slides).
  Watched it fail, applied fix, watched it pass — fast feedback loop.
- All 9 dropdown sites use the same controlled-open pattern: easy to
  search-and-pattern-match in review.

## Followups (none blocking)

- `ColorPickerGrid` and `ThemedColorPicker` could expose an `onAfterChange`
  prop to centralize the close behavior, but with only 7 files affected
  it's not worth the indirection. Inline `setOpen(false)` keeps the close
  logic visible at the call site.
