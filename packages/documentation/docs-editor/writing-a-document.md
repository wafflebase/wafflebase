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

Paste keeps as much of the original as it can. The editor looks at the
clipboard in this order:

1. **An image** — a screenshot or a picture copied from another app is inserted
   into the page, even when the clipboard also carries text.
2. **Content copied from another Wafflebase document** — pasted back with its
   formatting intact.
3. **HTML** — text copied from a web page or another word processor keeps its
   bold, italic, links, headings, and list structure. An HTML `<table>` becomes
   a real table.
4. **Plain text** — a markdown pipe-table (`| a | b |` with a `| --- |`
   separator line) becomes a real table; anything else has each line turned
   into a separate paragraph.

Press **⌘+Shift+V** / **Ctrl+Shift+V** to paste as plain text and drop all
formatting.

::: tip
Pasting a table while the cursor is already inside a table fills cells outward
from the current one rather than nesting a new table. Rows and columns that
would fall outside the existing grid are dropped.
:::

## Text Formatting

Use the formatting toolbar at the top or keyboard shortcuts to style your text.

### Inline Styles

| Style | Toolbar | Shortcut |
|-------|---------|----------|
| **Bold** | **B** button | ⌘+B / Ctrl+B |
| *Italic* | *I* button | ⌘+I / Ctrl+I |
| <u>Underline</u> | U button | ⌘+U / Ctrl+U |
| ~~Strikethrough~~ | — | ⌘+Shift+X / Ctrl+Shift+X |
| Superscript | — | ⌘+. / Ctrl+. |
| Subscript | — | ⌘+, / Ctrl+, |
| Text color | Text color swatch | Pick from the color palette |
| Highlight color | Highlight swatch | Pick from the color palette |
| Clear formatting | Clear formatting button | ⌘+\\ / Ctrl+\\ |

Strikethrough, superscript, and subscript have no toolbar button in the
document editor — use the shortcuts.

### Font and Spacing

Alongside the style controls, the toolbar carries:

- **Font family** — a curated list of fonts, with **More fonts…** to search the
  full catalog.
- **Font size** — type a number or use the **−** / **+** steppers.
- **Line spacing** — presets of 1.0, 1.15, 1.5, and 2.0, plus **Custom…** for
  any value between 0.5 and 10.

On a phone, font family and size live in the **⋮** overflow menu.

### Format Painter

Copy the formatting of one piece of text onto another without retyping it.

- Put the cursor in text whose formatting you want, then click the **brush**
  button in the toolbar (or press **⌘+Shift+C** / **Ctrl+Shift+C**). The button
  stays lit while the formatting is held.
- Select the text to restyle and click the lit button again to apply it. With
  nothing selected, clicking it again simply drops the copied formatting.
- The keyboard pair is sticky rather than single-use: **⌘+Alt+V** /
  **Ctrl+Alt+V** applies the held formatting and keeps it, so you can paint
  several selections in a row.

## Paragraph Styles

### Headings and Named Styles

The **Styles** dropdown in the toolbar sets the current block's
style — **Normal text**, **Title**, **Subtitle**, and **Heading 1** through
**Heading 6**. Headings also have shortcuts: **⌘+Alt+1** … **⌘+Alt+6** /
**Ctrl+Alt+1** … **Ctrl+Alt+6**, and **⌘+Alt+0** / **Ctrl+Alt+0** to go back to
Normal text. Applying the heading level a block already has toggles it back to
a paragraph.

Styles are redefinable per document. Format some text the way you want it, then
open **Styles → Options**:

- **Update 'Heading 1' to match** (named for whichever style you are on) —
  redefine that style from the text at the cursor. Every block using the style
  updates.
- **Reset 'Heading 1'** — put that one style back to its built-in appearance.
- **Reset styles** — put all of them back.
- **Save as my default styles** — keep the document's style set on your
  account, and **Use my default styles** to apply it to another document.

On a phone the block styles are listed under **Styles** in the **⋮** overflow
menu; the redefine options are desktop only.

### Alignment

Use the alignment dropdown in the toolbar, or the shortcuts:

| Alignment | Shortcut |
|-----------|----------|
| Left | ⌘+Shift+L / Ctrl+Shift+L |
| Center | ⌘+Shift+E / Ctrl+Shift+E |
| Right | ⌘+Shift+R / Ctrl+Shift+R |
| Justify | ⌘+Shift+J / Ctrl+Shift+J |

### Lists and Indent

- **Numbered list** — the list button, or **⌘+Shift+7** / **Ctrl+Shift+7**.
- **Bulleted list** — the list button, or **⌘+Shift+8** / **Ctrl+Shift+8**.
- **Tab** / **Shift+Tab** inside a list item nests and un-nests it (up to nine
  levels). On a plain paragraph, Tab does nothing.
- **⌘+]** / **⌘+[** (**Ctrl+]** / **Ctrl+[**) increase and decrease the
  paragraph indent, list or not.

### Type Instead of Clicking

A few markdown-style prefixes convert as you type. Type one at the start of an
otherwise empty paragraph, then press **Space** — the space is what fires the
conversion:

- `#` through `######` + **Space** — Heading 1 to Heading 6
- `-` or `*` + **Space** — bulleted list
- `1.` + **Space** — numbered list

Typing `---` on its own line and pressing **Enter** inserts a horizontal rule,
and a `http://` or `https://` address becomes a clickable link as soon as you
type a space after it.

## Links

Select some text and press **⌘+K** / **Ctrl+K** — or click the **link** button
in the toolbar, or right-click and choose **Add link** — then type the address
and click **Apply**.

Put the cursor inside an existing link and a small popover shows the address
with buttons to **edit** or **remove** it.

## Find and Replace

- **⌘+F** / **Ctrl+F** opens the find bar. Type to see the match count, then
  press **Enter** (or **Shift+Enter**) to step forward and back through
  matches. **Esc** closes the bar.
- **⌘+H** / **Ctrl+H** opens it with the replace row, which has **Replace** for
  the current match and **All** for every match.
- Two toggles narrow the search: **Match case** and **Use regex**.

The replace row is hidden when you only have read access to the document.

## Tables

Insert a table from the toolbar to lay out structured content. Click the **Table** button, drag to pick the grid size, and the table appears at the cursor.

- **Tab** moves between cells (Shift+Tab moves backward).
- Right-click a cell for row and column operations — insert above/below, insert
  left/right, delete row/column, and delete the table.
- To combine cells, select a rectangle of them and choose **Merge cells** from
  the same menu. Right-clicking a merged cell offers **Unmerge cells** instead,
  which puts the original cells back. (There is no way to divide a cell that
  was never merged.)
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
- **Delete** / **Backspace** removes it; **Esc** deselects and puts the cursor
  back where the image sits.
- **Arrow keys** leave the image and move the text cursor, as they do in Google
  Docs: **←** places the cursor just before the image, **→** just after, and
  **↑** / **↓** move by line. Images sit inline in the text, so there is no
  free positioning to nudge them to.

## Pagination

Documents use a page-based layout similar to a printed document. Pages default to Letter with 1-inch margins, and text flows across pages as you type.

- Long paragraphs and tables break naturally at the page boundary — line splitting keeps headings, table headers, and partial rows in sync with the layout.
- The editor renders one page per "sheet" so you can scroll through the deck of pages exactly as they will print or export.
- Export to PDF preserves the same pagination — what you see on screen matches the exported document.

To end a page early, press **⌘+Enter** / **Ctrl+Enter** to insert a page break.
Everything after the cursor moves to the top of the next page.

### Page Setup

Click **Page setup** in the toolbar (on a phone, it is in the **⋮** overflow
menu) to change:

- **Paper size** — Letter, A4, or Legal.
- **Orientation** — portrait or landscape.
- **Margins** — top, bottom, left, and right, in inches.

The change applies to the whole document and is a single undo step. You can
also drag the margin markers on the ruler to adjust margins directly.

## Headers & Footers

Add content that repeats on every page — a title, a date, or a page number.

- **Double-click** the margin area above the body (header) or below it (footer)
  to start editing it. Click back into the body, or press **Esc**, to leave.
- While editing a header or footer, click **Insert page number** in the toolbar
  to drop in a number that updates automatically on each page.

A header or footer applies to the whole document, and the toolbar narrows while
you edit one — bold, italic, underline, colors, alignment, and the page-number
button, but no lists, links, or styles dropdown. You can't insert a table, a
page break, or a horizontal rule into a header or footer.

A table that arrives inside a header or footer through **DOCX import** — a
common letterhead pattern — is kept and drawn correctly. It just isn't editable
in place: clicking it moves the cursor to the nearest editable paragraph
instead.

## Spell Check

Misspelled words are underlined with a red squiggle as you type — spell check
is on by default. Right-click an underlined word to see suggestions and click
one to replace it.

Spell check currently covers English (Latin-script) words in the body text.

## The Right-Click Menu

Right-clicking in the body opens one menu that gathers whatever applies where
you clicked:

- **Spelling suggestions** for a word with a red squiggle under it.
- **Cut**, **Copy**, and **Paste**.
- **Add link**, and **Insert comment** when text is selected.

Right-clicking inside a table opens the table menu instead — see
[Tables](#tables) above.

## Comments

Select text and press **⌘+Option+M** / **Ctrl+Alt+M** to start a comment, or
right-click and choose **Insert comment**. A document comment needs a real
selection — nothing happens with a bare cursor.

Replies, resolving, mentions, and the comments panel are covered in
[Collaboration & Sharing](/guide/collaboration#comments-mentions).

## Undo and Redo

- **⌘+Z** / **Ctrl+Z** — Undo the last action
- **⌘+Shift+Z** / **Ctrl+Y** — Redo

You can also use the undo/redo buttons in the toolbar.

## See Every Shortcut

Press **⌘+/** / **Ctrl+/** anywhere in the editor to open the shortcuts dialog.
The dialog is maintained alongside the editor's bindings rather than derived
from them, but it currently matches
[Keyboard Shortcuts](./keyboard-shortcuts) entry for entry. **Esc** closes it.

## What's Next

- [Keyboard Shortcuts](./keyboard-shortcuts) — Full list of document editor shortcuts
- [Collaboration & Sharing](/guide/collaboration) — Share and edit documents together in real time
