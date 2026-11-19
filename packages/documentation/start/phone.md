---
title: Use Wafflebase on a phone
description: What you can do in each editor on a phone, where the header and toolbar controls move, and which touch gestures apply.
type: overview
---

# Use Wafflebase on a phone

Every editor opens and edits on a phone, with a layout made for a narrow screen.

The phone layout applies when the window is less than 768 pixels wide, so it also appears in a narrow desktop window. The same account, documents, and share links work on every device.

## What works on a phone

| Editor | Edit | Comments | Version history | Export | Share |
|---|---|---|---|---|---|
| Sheets | Yes | **⋮** menu | **⋮** menu | Not in the app | Header |
| Docs | Yes | **⋮** menu | **⋮** menu | **⋮** menu | Header |
| Slides | Yes | Not available | Not on a phone | **⋮** menu | Header |
| Notes | Yes | Not available | **⋮** menu | Not in the app | Header |
| Board | Yes | **⋮** menu | **⋮** menu | **Download** on the canvas | Header |

Slides and notes have no comments on any device. Sheets and notes have no export in the app on any device; you can export them from the command line with the CLI. See [Import and export CSV or JSON](/developers/cli/sheets#import-and-export-csv-or-json) and [Read and export a note](/developers/cli/documents#read-and-export-a-note). To use version history for a presentation, open it in a wider window.

PDFs, images, and other uploaded files open in the same viewer as on a desktop, with download and **Share** in the header.

![Documents list on a phone with the New button and a list of documents](/images/start/phone-documents-list.png)

## Find controls on a phone

- **Sidebar:** tap the sidebar button at the top left to open Documents, Templates, Trash, Settings, and the workspace menu.
- **Header:** the document's own action (the play button, **Slideshow**, in a presentation) and **Share** stay in the header. Tap **⋮** (**More**) for **Comments**, **Version history**, and export. A check mark next to **Comments** or **Version history** shows the panel is open.
- **Collaborators:** the avatars of other people in the document are hidden on a phone. Their cursors and selections still appear in the document.
- **Toolbar:** each editor shows a shorter toolbar. Swipe it sideways, or open its overflow menu for the rest.

![Document header on a phone with the More menu open showing Comments, Version history, and export formats](/images/start/phone-more-menu.png)

## Use each editor on a phone

### Sheets

- Drag with one finger to scroll the grid, and pinch to zoom.
- Double-tap a cell to edit it. Type in the edit panel at the bottom of the screen, then tap the check mark (**Confirm editing**) or the **X** (**Cancel editing**).
- Touch and hold a cell or a selection to open the cell menu, with items such as **Data validation** and **Insert pivot table**.
- Tap ⋮ (**More formatting options**) at the right end of the toolbar for number formats, borders, **Create filter**, **Insert chart**, **Insert image**, **Conditional formatting**, and **Data validation**.
- The formula bar and the Name box are hidden. A formula cell shows its formula in the edit panel, but the function list and syntax hint don't appear there.

See [Sheets](/sheets/).

### Docs

- Tap to place the cursor and type with the on-screen keyboard.
- The toolbar keeps undo, redo, **Format painter**, bold, italic, underline, the colors, and **Clear formatting**. Swipe it sideways if they don't all fit.
- Tap ⋮ (**More formatting options**) for fonts, styles, lists and indents, insert, alignment, line spacing, and **Page setup**.

These need a computer:

- The ruler. Set margins in **Page setup** instead. First-line indents need a wider window.
- Redefining a style. A phone can apply styles but not update or reset them.
- Adding an image by URL. Upload a photo instead.
- A table of any size other than 3 by 3. A phone inserts **Table (3×3)** only.
- Find and replace, which open only from keyboard shortcuts. With a hardware keyboard they work.

See [Docs](/docs-editor/).

### Slides

- The current slide fills the screen, with a strip of slide thumbnails below it. Tap a thumbnail to go to that slide, or tap **Add slide** at the end of the strip to add a blank slide at the end.
- With nothing selected, tap **Insert** (the + icon) for text boxes, images, shapes, lines, and tables.
- Tap an object to select it, and drag its handles to move or resize it. Double-tap a text box or shape to type in it, and touch and hold an object for its menu.
- Theme, format, and background panels open as sheets from the bottom of the screen.
- Tap the play button (**Slideshow**) in the header to present from the current slide. **Present from beginning** is in the header's ⋮ (**More**) menu.

Speaker notes, version history, and duplicating, deleting, or reordering slides need a wider window.

When someone opens a presentation with a viewer link on a phone, they swipe left and right to change slides. See [Slides](/slides/).

### Notes

- A note shows the editor or the preview, one at a time. Side-by-side **Split** view is not available on a phone.
- Tap the eye icon (**Preview**) in the toolbar to switch between writing and reading. A view you pick on a phone isn't saved.
- The toolbar keeps undo, redo, the text style, bold, and italic. Tap ⋮ (**More formatting options**) for strikethrough, lists, links, quotes, code blocks, tables, and images.
- A table inserted on a phone is always 3 by 3. Add or remove rows in the source afterward.

See [Notes](/notes/).

### Board

- Drag empty canvas with one finger to move around, and pinch to zoom.
- Tools sit in the dock at the bottom of the screen: **Select**, **Sticky note**, **Text box**, **Shape**, and **Marker**. The rest, such as **Hand**, **Lasso select**, **Line**, **Eraser**, **Section**, **Insert image**, stamps, and **Comment**, are under **More tools** (the ⋯ button).
- **Timer**, **Start voting…**, **Spotlight me**, and **Laser pointer** fold into **Facilitate** in the top toolbar when nothing is selected.
- With the marker on, one finger draws and two fingers pinch to zoom.
- Touch and hold empty canvas to open the menu for adding a sticky note or section. Touch and hold an item or a section for its menu.
- The minimap starts closed. Tap **Map** in the bottom right corner to open it.
- Teammates' avatars are hidden, so you can't start following someone, but you still follow someone who spotlights. Cursor chat and emotes need a keyboard.

See [Board](/board/).

![Board on a phone with three sticky notes and the tool dock at the bottom](/images/start/phone-board.png)

## Related

- [Getting started](/start/getting-started): build and share your first sheet
- [Edit together](/collaborate/edit-together): see who else is working in a document
- [Troubleshooting](/start/troubleshooting): fix saving, share link, and upload problems
