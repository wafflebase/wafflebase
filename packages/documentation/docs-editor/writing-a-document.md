# Writing a Document

This guide covers creating and editing documents in Wafflebase — a word-processor-style editor with real-time collaboration.

## Create a Document

1. Open your workspace
2. Click the **New** dropdown button
3. Select **New Document**

A blank document opens with a page-style layout, similar to Google Docs.

## Basic Editing

Click anywhere on the page to place your cursor and start typing. The editor works like a standard word processor:

- **Enter** — Split into a new paragraph
- **Backspace / Delete** — Remove characters
- **Arrow keys** — Move the cursor
- Text wraps automatically at the page edge

### Select Text

- **Click and drag** to select a range of text
- **Double-click** to select a word
- **Triple-click** to select a paragraph
- **⌘+A** / **Ctrl+A** to select all text

### Copy, Cut, and Paste

- **⌘+C** / **Ctrl+C** — Copy selected text
- **⌘+X** / **Ctrl+X** — Cut selected text
- **⌘+V** / **Ctrl+V** — Paste text

When pasting multi-line text, each line becomes a separate paragraph.

## Text Formatting

Use the formatting toolbar at the top or keyboard shortcuts to style your text.

### Inline Styles

| Style | Toolbar | Shortcut |
|-------|---------|----------|
| **Bold** | **B** button | ⌘+B / Ctrl+B |
| *Italic* | *I* button | ⌘+I / Ctrl+I |
| <u>Underline</u> | U button | ⌘+U / Ctrl+U |
| ~~Strikethrough~~ | S button | ⌘+Shift+X / Ctrl+Shift+X |
| Text color | A button | Pick from the color palette |

To clear all formatting from selected text, press **⌘+\\** / **Ctrl+\\**.

### Paragraph Alignment

Use the alignment dropdown in the toolbar to align paragraphs:

- **Left** — Default alignment
- **Center** — Centered text
- **Right** — Right-aligned text

## Tables

Insert a table from the toolbar to lay out structured content. Click the **Table** button, drag to pick the grid size, and the table appears at the cursor.

- **Tab** moves between cells (Shift+Tab moves backward).
- Right-click a cell for row and column operations — insert above/below, insert left/right, delete row/column, merge or split cells.
- Drag a column or row border to resize.
- Tables can be nested — insert a table inside a cell to build sub-grids.

When a table is taller than the remaining space on a page, its rows split across the page boundary automatically.

## Images

Click the **Insert image** button in the toolbar and choose:

- **Upload from computer** — pick an image file from your device.
- **By URL…** — paste the address of an image on the web.

You can also drag an image file straight onto the page, or paste one copied
from another app.

Once an image is placed, click it to select it. Eight square handles appear
around the edges:

- Drag a **corner** handle to resize while keeping the aspect ratio (hold
  **Shift** to resize freely).
- Drag a **side** handle to stretch one dimension.
- **Arrow keys** nudge the image a pixel at a time (**Shift** for larger steps).
- **Delete** / **Backspace** removes it; **Esc** deselects.

## Pagination

Documents use a page-based layout similar to a printed document. Pages default to A4 with standard margins, and text flows across pages as you type.

- Long paragraphs and tables break naturally at the page boundary — line splitting keeps headings, table headers, and partial rows in sync with the layout.
- The editor renders one page per "sheet" so you can scroll through the deck of pages exactly as they will print or export.
- Export to PDF preserves the same pagination — what you see on screen matches the exported document.

## Headers & Footers

Add content that repeats on every page — a title, a date, or a page number.

- **Double-click** the margin area above the body (header) or below it (footer)
  to start editing it. Click back into the body, or press **Esc**, to leave.
- While editing a header or footer, click **Insert page number** in the toolbar
  to drop in a number that updates automatically on each page.

A header or footer applies to the whole document. Tables, page breaks, and
horizontal rules can't be placed inside them.

## Spell Check

Misspelled words are underlined with a red squiggle as you type — spell check
is on by default. Right-click an underlined word to see suggestions and click
one to replace it.

Spell check currently covers English (Latin-script) words in the body text.

## Undo and Redo

- **⌘+Z** / **Ctrl+Z** — Undo the last action
- **⌘+Shift+Z** / **Ctrl+Y** — Redo

You can also use the undo/redo buttons in the toolbar.

## What's Next

- [Keyboard Shortcuts](./keyboard-shortcuts) — Full list of document editor shortcuts
- [Collaboration & Sharing](/guide/collaboration) — Share and edit documents together in real time
