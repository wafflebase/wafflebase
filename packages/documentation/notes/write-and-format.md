---
title: Write and format a note
description: Write a note in Markdown, format it from the toolbar, and set up the editor the way you like.
type: how-to
---

# Write and format a note

Write a note in Markdown, format it from the toolbar, and set up the editor the way you like.

::: info Before you start
- You need edit access. A viewer share link opens the note read-only, in **Preview**.
- The formatting toolbar appears in the **Editor** and **Split** layouts, not in **Preview**.
- Images: PNG, JPEG, GIF, or WebP, up to 10 MB. In your workspace, larger images are scaled down first.
:::

## Choose a layout

1. Open the note.
2. At the right of the toolbar, click one of the three view buttons: **Editor** (source only), **Split** (source and preview side by side), or **Preview** (rendered note only).
3. In **Split**, drag the divider between the panes to resize them. Each pane keeps at least 15% of the width.

In **Split**, scrolling either pane scrolls the other to the same relative position. **Preview** shows the note in a centered reading column. Your layout is remembered in this browser.

### On a phone

**Split** is not offered below 768 pixels wide. Tap the eye icon (**Preview**) to switch between the source and the rendered note. A layout you pick on a phone is not saved, so your desktop layout stays as it was.

## Set a heading

1. Put the cursor on the line.
2. Click **Text style** (it shows **Normal text** or the current heading) at the left of the toolbar.
3. Select **Heading 1** to **Heading 6**, or **Normal text** to remove the heading.

The line gets the matching number of `#` marks. Shortcut: `⌘+Option+1` / `Ctrl+Alt+1` through `6`, and `0` for normal text.

![Text style menu open with Normal text and Heading 1 to Heading 6, each showing its shortcut](/images/notes/write-and-format-text-style.png)

## Make text bold, italic, or struck through

1. Select the text.
2. Click **Bold**, **Italic**, or **Strikethrough** in the toolbar.

The buttons light up when the cursor is in text that has that style. Click again to remove it. Shortcuts: `⌘+B` / `Ctrl+B`, `⌘+I` / `Ctrl+I`, and `⌘+Shift+X` / `Ctrl+Shift+X`.

## Add a link

1. Select the link text.
2. Click **Link**, or press `⌘+K` / `Ctrl+K`. The text becomes `[text](url)` with `url` selected.
3. Type or paste the address.

To remove a link, put the cursor in it and click **Link** again. Web addresses typed as plain text also become links in the preview.

## Make lists and checklists

1. Select one or more lines.
2. Click **Bullet list**, **Numbered list**, or **Checkbox**.
3. To nest items, click **Indent**. To bring them back out, click **Outdent**.

Clicking the lit list button turns the lines back into paragraphs, and clicking a different one converts the list. **Indent** is unavailable on the first item of a list, and **Outdent** on a top-level item. Press `Enter` at the end of an item to start the next one, and `Enter` on an empty item to end the list.

::: tip
Type `[ ]` at the start of a line and press `Space` to start a checklist item. The editor adds the `- ` for you.
:::

## Insert a quote, code block, foldout, or table

1. Put the cursor where you want the block, or select lines to wrap.
2. Click one of these:
   - **Quote** adds `> ` to each selected line, or removes it when every line is already quoted.
   - **Code block** wraps the selection in a ``` fence. Type a language name after the opening fence to highlight it.
   - **Foldout** inserts a collapsible section. Type its label between `<summary>` and `</summary>`, and its body on the blank line below.
   - **Insert table** opens a grid. Point to the size you want, up to 10 by 10, and click.

Code blocks in the preview have a **Copy** button in the corner. For the syntax behind each block, see the [Markdown reference](/notes/markdown-reference).

## Add an image

1. Put the cursor where the image should go.
2. Click **Insert image** and choose one or more files. You can also paste an image or drag it into the source pane.

An **Uploading** label with the file name shows at the cursor until the upload finishes. The editor then inserts `![name](url)`, using the file name as the alt text. If an upload fails, a message says why.

## Tick tasks in the preview

1. Switch to **Split** or **Preview**.
2. Click a task's checkbox or its text.

The box ticks or unticks, and the source line changes between `- [ ]` and `- [x]`. In a read-only note the boxes don't change.

## Find and replace text

1. Click in the source pane and press `⌘+F` / `Ctrl+F`. The find panel opens at the bottom of the pane.
2. Type what to find. Press `Enter` or `⌘+G` / `Ctrl+G` for the next match, and add `Shift` for the previous one.
3. To replace, type in the replace field, then click **replace** or **replace all**.
4. Press `Escape` to close the panel.

## Fold a heading or code block

1. In the source pane, find the arrow in the gutter beside a heading or a code block.
2. Click the arrow. The section collapses.
3. Click the arrow again to expand it.

Shortcut: `⌘+Option+[` / `Ctrl+Shift+[` folds the block at the cursor. See [Keyboard shortcuts](/notes/keyboard-shortcuts#view) for the rest.

## See who wrote each line

1. Click **Editor settings** (the sliders icon) at the right of the toolbar.
2. Select **Show authors**.

A column left of the line numbers names the person who last edited each line. A run of lines by the same person is labeled once. Point to a cut-off name to see it in full. Some older text has no name, and an editor without a display name shows as **Anonymous**.

![Source pane with the authors column showing two collaborators' names beside their lines](/images/notes/write-and-format-show-authors.png)

::: warning Your name is always recorded
Every editor's display name is saved with the text they type, whether or not anyone turns on **Show authors**. Anyone who can open the note, including a viewer share link, can see these names. Names are self-reported, so treat them as a hint, not proof.
:::

## Use Vim keys

1. Click **Editor settings**.
2. Under **Keyboard**, select **Vim**. Select **Default** to switch back.

In Vim mode, `Escape` belongs to Vim. On Windows and Linux the formatting shortcuts are turned off so Vim keeps its own `Ctrl` keys. On a Mac they still work. See [Keyboard shortcuts](/notes/keyboard-shortcuts).

Your layout, **Show authors**, and keyboard choices are remembered in this browser. Changes you make while viewing a note through a share link are not saved.

## Format on a phone

On a phone the toolbar keeps **Undo**, **Redo**, **Text style** (shown as **Text** or **H1** to **H6**), **Bold**, and **Italic**, plus **Preview** (the eye) and **Editor settings**. The other formatting buttons are in the ⋮ menu (**More formatting options**):

- **Strikethrough**
- **Lists**: **Bullet list**, **Numbered list**, **Checkbox**, **Indent**, **Outdent**
- **Insert**: **Link**, **Quote**, **Code block**, **Foldout**, **Table (3×3)**, **Image**

The table on a phone is always 3 by 3. Add or remove rows in the source afterward.

![Phone note toolbar with the More formatting options menu open showing Lists and Insert groups](/images/notes/write-and-format-more-menu-mobile.png)

## Known limitations

- There are no comments on notes. Use a doc if you need comment threads.
- Uploading a `.md` file from the workspace stores it as a file, not a note. To import or export Markdown, use the [CLI](/developers/cli/documents#notes).

## Related

- [Markdown reference](/notes/markdown-reference) for everything the preview renders.
- [Keyboard shortcuts](/notes/keyboard-shortcuts) for every key in the editor.
- [Edit together](/collaborate/edit-together) to see how live editing and cursors work.
- [Version history](/collaborate/version-history) to restore an earlier version of a note.
