---
title: Edit together
description: See who else is in a document, jump to where they are working, and check that your edits are saved.
type: how-to
---

# Edit together

Several people can edit the same sheet, doc, presentation, note, or board at once, and everyone sees each change as it happens.

There is nothing to save or refresh. Anyone in the workspace can join, and so can anyone with an editor [share link](/collaborate/share).

## See who is here

Everyone who has the document open appears as an avatar in the top right of the header. Up to four show at once; click **+N** to see the rest.

Each person also gets a color and a marker where they are working:

| Document | What you see |
|---|---|
| Sheet | A colored outline on their selected cell, with their name |
| Doc and note | A colored text cursor with their name |
| Presentation and board | Their selection, and on a board their mouse pointer |
| PDF | Their avatar in the header |

In sheets and docs, the name fades a few seconds after the person stops moving. Hover their cursor to show it again. In notes, presentations, and boards the name stays on screen.

Signed-in people show their username. People on a share link who aren't signed in show as **Anonymous**.

![Doc with a second person's colored cursor labeled Anonymous, and two avatars in the header](/images/collaborate/edit-together-peer-cursor.png)

### On a phone

The header has no room for avatars on a phone, so they're hidden. Collaborators' cursors and selections still appear in the document.

## Jump to a collaborator

In sheets, docs, and boards, you can go to where someone is working.

1. Hover an avatar in the header. In a sheet, the tooltip names their cell, for example *Click to jump to B4*.
2. Click the avatar.

A sheet or doc scrolls to their position. On a board you start following them: your view moves with theirs, and a banner says *Following &lt;name&gt; — Esc to stop*. Press `Escape` to stop following.

You can't jump to yourself, or to someone whose position isn't known yet.

## Rename a document

1. Click the document's title in the header.
2. Type the new name.
3. Press `Enter` to save, or `Escape` to cancel.

Everyone with the document open sees the new title right away. Any workspace member can rename a document.

## Check that your work is saved

A status chip next to the header buttons shows whether your edits have reached the server.

| Chip | What it means |
|---|---|
| **Saved** | Everything you did is on the server. |
| **Saving…** | Your latest changes are on their way. |
| **Reconnecting…** | The connection dropped, but nothing of yours is waiting. |
| **Not saved** | You have changes that haven't reached the server. |

Hover the chip for more detail. If **Not saved** lasts more than two seconds, a warning appears that says whether the connection dropped or the server rejected your changes. A **Saved** message appears when your work gets through. If the warning stays, see [Troubleshooting](/start/troubleshooting).

While you have unsent changes, leaving the document asks *Leave without saving?* Click **Stay** to keep the tab open, or **Leave** to discard the changes.

::: warning Wait for Saved before you close the tab
Unsent changes exist only in this browser tab. The browser doesn't always ask before closing, so a missing prompt doesn't mean your work is safe.
:::

The chip appears in sheets, docs, presentations, notes, and boards, and on an editor share link. PDFs don't have one.

### On a phone

**Saved** is hidden to save space, and the other states show as an icon only. The **Not saved** warning message still appears.

## Edit the same thing at the same time

- **Sheets**: when two people change the same cell, the last change wins.
- **Docs and notes**: text typed at the same time by two people is merged, so both people's words are kept.
- **Presentations**: text in a text box, shape, table cell, or speaker notes is saved when you click away. If two people edit the same box, the last one to click away wins. See [Slides](/slides/).
- **Boards**: moving, resizing, and restyling follow the last change.

You never see a conflict dialog. Watch for other people's cursors to avoid editing the same spot.

## Known limitations

- A viewer share link can't edit, so it shows **View only** instead of the status chip.
- Version history isn't available on share links. See [Version history](/collaborate/version-history).

## Related

- [Share a document](/collaborate/share) to invite someone to edit.
- [Comments and mentions](/collaborate/comments) to discuss changes.
- [Version history](/collaborate/version-history) to undo a collaborator's change.
- [Facilitate a session](/board/facilitate-a-session) for spotlight, cursor chat, and timers on a board.
