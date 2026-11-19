---
title: Paste from other apps
description: Paste text, tables, and images into a doc from web pages, spreadsheets, Markdown, and other documents, with or without formatting.
type: how-to
---

# Paste from other apps

Paste content into a doc and keep as much of its structure as the doc can hold. Press `⌘+V` / `Ctrl+V`, or right-click and select **Paste**.

Right-click **Paste** may ask for clipboard permission the first time, and it pastes text and formatted text only. To paste an image or content copied from a Wafflebase doc, press `⌘+V` / `Ctrl+V`.

## What a paste keeps

The doc checks the clipboard in this order and uses the first match:

| On the clipboard | What you get |
|---|---|
| An image, such as a screenshot or a copied picture | The image, inserted at the cursor |
| Content copied from a Wafflebase doc | The same content with all of its formatting |
| Formatted text from a web page or word processor | Headings, bulleted and numbered lists, links, tables, bold, italic, underline, strikethrough, text and highlight colors, and font sizes |
| A Markdown table (rows like `\| a \| b \|` under a `\| --- \|` separator) | A real table |
| Any other text | One paragraph per line |

From formatted text, a paste drops images, font families, and how deep list items were nested.

## Paste formatted text

1. Copy the text in the other app.
2. Click where it should go in the doc and press `⌘+V` / `Ctrl+V`.

The text keeps its headings, lists, links, and character styles. Reapply fonts with [Format text](/docs-editor/format-text) if needed.

## Paste as plain text

1. Copy the text.
2. Press `⌘+Shift+V` / `Ctrl+Shift+V`.

All formatting is dropped, and each line becomes a paragraph. The text takes the style of the paragraph you paste into.

## Paste a spreadsheet range or table

1. Copy the cells in a spreadsheet, such as a Wafflebase sheet, or copy a table from a web page.
2. Click where the table should go and press `⌘+V` / `Ctrl+V`.

A new table appears with the copied rows and columns.

### Paste into an existing table

What happens depends on what you copied:

- **Cells** (a spreadsheet range, a web table, a Markdown table, or cells selected inside a Wafflebase table) fill the table starting at the cell with the cursor. Cells that would fall outside the table are left out.
- **A whole table** copied from a Wafflebase doc is placed inside the current cell as a nested table.

To keep the existing table's size, copy only as many cells as there is room for.

## Paste Markdown

A Markdown table becomes a real table. Other Markdown lines, such as `# Heading` or `- item`, are pasted as plain text with their symbols. To format them, type the shortcuts instead; see [Format text](/docs-editor/format-text) and [Lists and indents](/docs-editor/lists-and-indents).

## Paste an image

1. Copy an image, or take a screenshot to the clipboard.
2. Click in the doc and press `⌘+V` / `Ctrl+V`.

If the clipboard holds both an image and text, the image wins. See [Images](/docs-editor/images) for sizes and file types.

## Known limitations

- Tables can't be pasted into a header or footer. Text pastes there as usual.
- A very large paste shows **Pasting a large document…** while it runs. Wait for it to finish before typing.
- A paste is a single step: press `⌘+Z` / `Ctrl+Z` once to undo all of it.

## Related

- [Tables](/docs-editor/tables) to adjust a pasted table.
- [Import and export](/files/import-export) to open a whole Word file instead of pasting it.
- [Keyboard shortcuts](/docs-editor/keyboard-shortcuts) for clipboard shortcuts.
