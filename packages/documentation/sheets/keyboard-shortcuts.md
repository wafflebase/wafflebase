# Keyboard Shortcuts

Keyboard shortcuts for common actions. `Ctrl` is the modifier on
Windows/Linux and `⌘` on Mac — either one works wherever both are listed.

::: tip
Press `Ctrl+/` / `⌘+/` in the spreadsheet to open the **Keyboard shortcuts**
dialog, which lists the same bindings in the app.
:::

## Navigation

| Action | Shortcut |
|--------|----------|
| Move the active cell | Arrow keys |
| Jump to the edge of the data | `Ctrl+Arrow` / `⌘+Arrow` |
| Move to the next cell | `Tab` |
| Move to the previous cell | `Shift+Tab` |

## Selection

| Action | Shortcut |
|--------|----------|
| Select all | `Ctrl+A` / `⌘+A` |
| Extend the selection by one cell | `Shift+Arrow` |
| Select an entire row | Click the row number |
| Select an entire column | Click the column header |
| Extend a row/column selection | `Shift`-click another header |

::: warning
`Shift+Arrow` extends the selection **one cell at a time**. Adding `Ctrl` /
`⌘` does not extend the selection to the edge of the data — the combination
still extends by a single cell.
:::

## Editing

| Action | Shortcut |
|--------|----------|
| Start editing the active cell | `Enter`, or just start typing |
| Confirm the entry and move down | `Enter` (while editing) |
| Confirm the entry and move right / left | `Tab` / `Shift+Tab` (while editing) |
| Cancel editing | `Escape` |
| Insert a line break inside a cell | `Alt+Enter` |
| Clear cell contents | `Delete` / `Backspace` |
| Cycle a formula reference between relative and absolute | `F4` (while editing) |
| Toggle a checkbox | `Space` |
| Open a dropdown list | `Alt+↓` |
| Merge / unmerge the selection | `Ctrl+Shift+M` / `⌘+Shift+M` |
| Undo | `Ctrl+Z` / `⌘+Z` |
| Redo | `Ctrl+Y` / `⌘+Shift+Z` |

`Enter` does two different things depending on the selection. On a single
cell it opens the editor. With a multi-cell range selected it moves the
active cell down within that range instead (`Shift+Enter` moves up), so you
can walk a block without leaving it.

`Space` and `Alt+↓` only apply to cells covered by a data validation rule —
a checkbox rule for `Space`, a dropdown rule for `Alt+↓`. See
[Data Validation](./data-validation.md).

In the in-cell editor, `Ctrl+Enter` / `⌘+Enter` also inserts a line break.
It exists because the macOS Korean IME reserves `Option` for Hanja
conversion; in the formula bar, use `Alt+Enter`.

## Clipboard

| Action | Shortcut |
|--------|----------|
| Copy | `Ctrl+C` / `⌘+C` |
| Cut | `Ctrl+X` / `⌘+X` |
| Paste | `Ctrl+V` / `⌘+V` |
| Clear the copy marquee | `Escape` |

## Formatting

| Action | Shortcut |
|--------|----------|
| Bold | `Ctrl+B` / `⌘+B` |
| Italic | `Ctrl+I` / `⌘+I` |
| Underline | `Ctrl+U` / `⌘+U` |
| Strikethrough | `Ctrl+Shift+S` / `⌘+Shift+S` |

## Find, Comments, and Help

| Action | Shortcut |
|--------|----------|
| Find | `Ctrl+F` / `⌘+F` |
| Comment on the active cell | `Ctrl+Alt+M` / `⌘+Alt+M` |
| Toggle the comments panel | `Ctrl+Alt+Shift+M` / `⌘+Alt+Shift+M` |
| Show keyboard shortcuts | `Ctrl+/` / `⌘+/` |
