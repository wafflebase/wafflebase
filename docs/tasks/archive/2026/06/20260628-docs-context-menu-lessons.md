# Docs Unified Context Menu — Lessons

1. **The docs editor already had frontend context menus** (comment, table)
   as plain positioned overlays — Radix `ContextMenu` is avoided because it
   blocks Canvas pointer events. A new menu must follow that overlay pattern,
   not Radix.

2. **Multiple `contextmenu` listeners stack on one container.** The docs
   package, comment menu, and table menu all listened on the same element.
   `stopPropagation` does not stop sibling listeners; only `preventDefault`
   (any one) suppresses the native menu. Suppress the native menu once at the
   editor layer and make the menus mutually exclusive by context
   (`isInTable()`), not by event-order tricks.

3. **A caret-word skip in spell check breaks right-click-to-fix.** Skipping
   the word under the caret seemed sensible ("don't flag as you type") but
   deleted the squiggle the instant you clicked a typo, so the suggestions
   vanished. Debounce already covers active typing; keep misspellings flagged
   regardless of caret (Google Docs does).

4. **Programmatic clipboard is asymmetric.** copy/cut can fire the editor's
   rich textarea handlers via `execCommand` within the click gesture; paste
   cannot be triggered programmatically and the async Clipboard API can't read
   the internal MIME — so menu Paste is best-effort. In read-only there's no
   textarea, so copy/cut are inert — gate them out of the menu.
