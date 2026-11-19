---
title: Use version history
description: Look back at earlier versions of a document, name the current one, and restore an older version.
type: how-to
---

# Use version history

Every sheet, doc, presentation, note, and board keeps a history of earlier versions that you can preview and restore.

Wafflebase saves versions automatically as people edit, so a busy afternoon adds several and a quiet week adds none. Restoring is reversible.

::: info Before you start
- You need to be signed in and open the document from your workspace. Share links have no history.
- PDFs, images, and other uploaded files have no version history.
- Presentations have no history on a phone. See [Use Wafflebase on a phone](/start/phone).
:::

## Open version history

1. Open the document.
2. Click the clock icon (**Show version history**) in the header.

The **Version history** panel opens on the right. Versions are grouped by day, newest first. Most are named **Automatic**. Versions that people named, and **Before restore** versions, show **By you** when you created them. Click the icon again to close the panel.

![Version history panel with two named versions, each with Preview and Restore buttons](/images/collaborate/version-history-panel.png)

### On a phone

Tap **⋮** (**More**) in the header, then **Version history**.

## Name the current version

1. Open version history.
2. Type a name in **Name current version**, for example `Sent to finance`.
3. Click **Save**.

The named version appears at the top of the list. You can't rename or delete a version later, so name a state before you move on from it.

## Preview a version

1. Open version history.
2. Click **Preview** on a version.

The version opens read-only over the document, with a banner that says *Viewing &lt;version&gt; from &lt;time&gt;*. Nothing changes while you look, and the toolbar and editing shortcuts are turned off. Click another version's **Preview** to switch, or click **Back to current version** to leave.

What a preview shows:

| Document | In a preview |
|---|---|
| Sheet | The first tab only, without charts and images |
| Doc | The whole document, read-only |
| Presentation | One slide at a time; use **‹** and **›** in the banner to move |
| Note | The rendered Markdown |
| Board | The whole board, fitted to the screen, without pan or zoom |

## Restore a version

1. Open version history.
2. Click **Restore** on the version you want.
3. In **Restore this version?**, click **Restore this version**.

The whole document goes back to that version, including every tab or slide. Before it restores, Wafflebase saves the current state as **Before restore**. To undo a restore, restore **Before restore**; `⌘+Z` / `Ctrl+Z` can't undo it.

::: warning Comments go back too
Comments added after the version you restore are removed. Restore **Before restore** to get them back.
:::

### Restore from a preview

In a preview, click **Restore this version** in the banner. This restores right away, without the confirmation dialog.

![Doc preview with the Viewing banner, Back to current version, and Restore this version](/images/collaborate/version-history-preview.png)

## Load older versions

The panel loads 50 versions at a time. Scroll to the bottom of the list and click **Load older versions** to see more.

## Known limitations

- Only one restore can run at a time. While one is running, **Restore** is unavailable and says *A restore is already in progress*.
- Automatic versions don't show who made the changes.
- Versions can't be renamed or deleted.
- People on a share link can't see or restore versions.

## Related

- [Edit together](/collaborate/edit-together) to see who changed what as it happens.
- [Comments and mentions](/collaborate/comments) to discuss a change before you restore.
- [Trash](/collaborate/trash) to bring back a deleted document.
