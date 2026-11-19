---
title: Export and import a board
description: Download a board or a selection as a PNG or PDF, and import an existing Miro board as a new board.
type: how-to
---

# Export and import a board

Download a board or a selection as a PNG or PDF, and import an existing Miro board as a new board.

## Download a board

1. Open the board.
2. Click **Download** (the download icon) in the top-right corner of the canvas.
3. Select **Download as PNG** or **Download as PDF**.

The file is named after the board and covers everything on it, with a small margin. A PDF is one page sized to the content. Anyone who can open the board can download it, viewers included.

![Download menu open in the top-right corner of the canvas with PNG and PDF options for the whole board or the selection](/images/board/export-download-menu.png)

### Download only a selection

1. Select the items you want. To export one section, select the section.
2. Click **Download** and select **Download selection as PNG** or **Download selection as PDF**.

## Import a Miro board

The import creates a new board in your workspace from a Miro board.

::: info Before you start
- You need a Miro access token that can read the board. The token is used for this one import and is never stored.
- Start the import from a workspace's document list, not from the all-workspaces list.
:::

1. In your workspace, click **New**, then select **Import from Miro…**.
2. Paste the token under **Access token**.
3. Paste the board's address under **Board URL**, for example `https://miro.com/app/board/uXjVOD50NUI=/`.
4. Click **Import**.

The import continues in the background, and its progress shows in the uploads panel. When it finishes, the panel lists anything that didn't come across.

![Import a Miro board dialog with the Access token and Board URL fields](/images/board/export-miro-dialog.png)

### What comes across

| Miro item | On the board |
|---|---|
| Sticky notes | Sticky notes |
| Cards and app cards | Rounded rectangles with the card's title and description |
| Shapes | Shapes. An unrecognized shape becomes a rectangle. |
| Text | Text boxes |
| Images | Images, copied into your workspace |
| Connectors | Connectors, when both ends are attached to items that were imported |
| Frames | [Sections](/board/sections) |

Other item types, such as embeds, are skipped and listed in the summary.

## Known limitations

- A very large board is scaled down in the file to stay within size limits.
- Items inside a hidden section are left out of a download.
- Stamps, vote dots, and comment pins are not included in a download.
- An empty board can't be downloaded. See [Troubleshooting](#troubleshooting).
- One Miro import brings in up to 10,000 items and 100 images, up to 64 MB of images in total. The summary says when a board went over a limit.

## Troubleshooting

### The board is empty — nothing to export.

**What it means:** the board, or the part you selected, has nothing to put in the file.

**Try this:** add something to the board, or select items that aren't inside a hidden section.

### Couldn't export the board. Try again.

**What it means:** the file couldn't be created.

**Try this:**

1. Try again.
2. Reload the page, then download again.
3. If the board is very large, download a selection instead.

## Related

- [Import and export](/files/import-export) for every document type and format.
- [Sections](/board/sections) to group what you want to export.
- [Share a document](/collaborate/share) to give people a link instead of a file.
