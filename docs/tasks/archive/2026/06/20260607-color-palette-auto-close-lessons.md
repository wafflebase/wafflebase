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

### Focus restoration must run in `onCloseAutoFocus`, not in the click handler

First attempt: call `editor.focus()` in the swatch click handler, then
`setOpen(false)`, with `onCloseAutoFocus={(e) => e.preventDefault()}` so
Radix doesn't refocus the trigger. That worked for outside-click closes
historically, but **not** when the close is triggered programmatically
from inside the click handler — Radix's `FocusScope` unmount-focus dance
overrode the in-handler `editor.focus()` and ended up leaving focus on
the trigger button anyway. Arrow keys then went nowhere (docs textarea
needed focus, slides ignored `BUTTON` targets).

Fix: move `editor?.focus()` **into** `onCloseAutoFocus`. preventDefault
to stop Radix's own focus-to-trigger, then explicitly focus the editor.
That seam runs after Radix has finished its own focus management, so
nothing overrides it.

### Slides editor filters out `BUTTON` targets at document-level

`packages/slides/src/view/editor/interactions/keyboard.ts:isEditableTarget`
returns true for any `tagName === 'BUTTON'` (and `role="menu"` / `dialog`
/ etc.), to keep Tab inside dialogs and toolbar buttons from triggering
slides shortcuts. The Radix dropdown trigger **is** a `<button>` — after
the palette closes, focus lands on it, and the slides editor ignores
arrow/Esc/Delete.

Fix for slides: in `onCloseAutoFocus`, preventDefault Radix's behavior
**and** explicitly `document.activeElement.blur()` so focus drops to
`document.body`. Body is not a button, not in a menu role, so the
slides editor's document-level keydown handler processes the keystroke
normally. Extracted as `release-focus.ts` so all four slides color
dropdowns share one helper.

Sheets is unaffected because its analogous filter
(`worksheet.ts:isExternalInput`) only checks `INPUT/TEXTAREA/SELECT/
contentEditable`, not `BUTTON`. Arrow keys reach the grid even when
focus is on a toolbar button.

Rule of thumb: when adding programmatic close to a Radix menu, the close
seam is `onCloseAutoFocus`, not the click handler. Put both
preventDefault and the focus-restore call there.

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
