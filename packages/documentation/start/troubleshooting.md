---
title: Troubleshooting
description: Fix common problems with signing in, saving, share links, uploads, templates, version history, sheets, docs, and the desktop app, by the message you see.
type: troubleshooting
---

# Troubleshooting

Find the message or symptom you see, then work through the fixes in order.

- Sign in: [sign-in link expired](#that-sign-in-link-expired-or-was-started-in-another-tab), [account exists under the other provider](#an-account-already-exists-for-that-email-address-under-the-other-sign-in-provider), [no verified email](#that-account-has-no-verified-email-address)
- Saving: [Not saved](#the-header-says-not-saved), [Reconnecting…](#the-header-says-reconnecting), [Leave without saving?](#leave-without-saving-appears)
- Sharing: [Link unavailable](#link-unavailable), [read-only link](#a-share-link-opens-read-only), [can't choose Editor](#you-can-t-choose-editor-in-the-share-dialog)
- Documents: [a document disappeared](#a-document-disappeared), [can't move or delete](#you-can-only-move-documents-you-own), [upload too large](#file-is-larger-than-the-100-mb-limit), [Markdown upload](#an-uploaded-md-file-didn-t-become-a-note)
- Sheets: [chart needs 2 rows and 2 columns](#select-at-least-2-rows-and-2-columns), [query refused](#only-select-queries-are-allowed), [local lakehouse paths disabled](#local-lakehouse-paths-are-disabled-on-this-server)
- Docs: [image upload failed](#couldn-t-upload-the-image), [image URL refused](#image-url-must-start-with-http-or-https), [margins refused](#margins-must-be-zero-or-a-positive-number-of-inches), [link edit refused](#the-cursor-left-this-link-click-it-again-to-edit-it)
- Desktop app: [server too old](#this-server-is-too-old-for-desktop-sign-in), [sign-in turned off](#this-server-has-desktop-sign-in-turned-off), [sign-in timed out](#sign-in-timed-out-try-again), [can't reach the server](#can-t-reach-appears-in-the-desktop-app), [Windows warning](#windows-protected-your-pc-appears), [Mac warning](#a-mac-says-wafflebase-is-damaged-or-can-t-be-opened)
- Other: [Template not found](#template-not-found), [no version history](#version-history-is-missing), [restore in progress](#a-restore-is-already-in-progress), [workspace settings](#couldn-t-update-the-workspace)

## `That sign-in link expired or was started in another tab`

### What it means

The sign-in took too long, or you started a second sign-in in another tab, which replaced the first.

### Try this

1. Close any other Wafflebase sign-in tabs.
2. Click **Continue with GitHub** (or **Continue with Google**) again in one tab.

## `An account already exists for that email address under the other sign-in provider`

### What it means

You first signed in with the other provider (GitHub or Google) using the same email address.

### Try this

1. Sign in once with the provider you used first.
2. Sign out, then sign in with the new provider. It works from now on.

## `That account has no verified email address`

### What it means

Wafflebase signs you in by your email address, and the provider reports none that is verified. A related message, `That account did not share an email address`, means the provider shared no address at all.

### Try this

1. Verify your email address in your GitHub or Google account settings.
2. Sign in again, or try the other provider.

## The header says **Not saved**

### What it means

Your recent changes haven't reached the server. They exist only in this browser tab, so closing or reloading it loses them. A **Not saved** notice explains which case you're in:

- *Your connection dropped*: the changes sync when the connection returns.
- *The server rejected your recent changes*: the changes won't sync on their own.

### Try this

1. Keep the tab open. Don't reload it.
2. If your connection dropped, reconnect to the network and wait for the header to show **Saved**.
3. If the server rejected the changes, copy the text you added somewhere safe, such as another app. Then reload the document and add it again.
4. If you opened the document with a share link, ask its owner whether the link was revoked or changed to a viewer link.

## The header says **Reconnecting…** {#the-header-says-reconnecting}

### What it means

The connection to the server dropped, but none of your changes are waiting to be sent. Nothing is lost.

### Try this

1. Check your network connection.
2. Wait. The header returns to **Saved** when the connection comes back.

## **Leave without saving?** appears

### What it means

You tried to leave a document while some of your changes hadn't reached the server. Leaving now loses them.

### Try this

1. Click **Stay**.
2. Wait for the header to show **Saved**, then leave.
3. If it shows **Not saved**, see [The header says Not saved](#the-header-says-not-saved).

## **Link unavailable**

### What it means

The share link no longer works. The page explains why:

- `Share link not found`: the link was revoked, or its document was moved to the Trash.
- `Share link has expired`: the link's expiration time has passed.

### Try this

1. Check that you copied the whole link.
2. Ask the document's owner for a new link. If the document is in the Trash, restoring it brings its links back.

## A share link opens read-only

### What it means

The link is a viewer link. The header shows a **View only** badge, and you can read the document but not change it.

### Try this

1. Ask the document's owner for an editor link.
2. If you're in the same workspace, open the document from your documents list instead. Members can edit every document there.

## You can't choose **Editor** in the Share dialog

### What it means

Only the document's author or a workspace owner can create editor links. The dialog says `Only the document owner or a workspace owner can create editor links.`

### Try this

1. Create a **Viewer** link instead, if reading is enough.
2. Ask the author or a workspace owner to create the editor link.

## A document disappeared

### What it means

Someone probably moved it to the Trash, or moved it into a folder.

### Try this

1. Check your folders. **Search by title...** at the top of the documents list searches only the folder you're in.
2. Open **Trash** in the sidebar. The document's author or a workspace owner can click **Restore**.
3. Ask a workspace owner whether it was deleted forever. That can't be undone.

## `You can only move documents you own`

### What it means

Moving a document, or moving it to the Trash, needs its author or a workspace owner. The message `You can only delete documents you own` means the same thing.

### Try this

1. Check the **Owner** column in the documents list to see who created each document.
2. Ask that person or a workspace owner to move or delete it.

## `File is larger than the 100 MB limit`

### What it means

Uploads are limited to 100 MB per file, and 25 MB for images. An image over its limit shows `File is larger than the 25 MB limit` instead. The file is not uploaded, and the upload panel can't retry it.

### Try this

1. Compress the file or split it into smaller files.
2. Upload the smaller file again with **New > Upload files…**.

## An uploaded `.md` file didn't become a note

### What it means

Uploading a Markdown file stores it as a file you can download. It doesn't create a note.

### Try this

1. Open the file, copy its text, and paste it into a new note (**New > New note**).
2. To turn a Markdown file into a note from the command line, use `wafflebase notes import`. See [Import a Markdown file](/developers/cli/documents#import-a-markdown-file).

## `Select at least 2 rows and 2 columns.` {#select-at-least-2-rows-and-2-columns}

### What it means

A chart needs a range at least 2 cells tall and 2 cells wide: one column for labels and one for values, with a header row. A related message, `Select a cell range to insert a chart.`, means you selected whole rows, whole columns, or the whole sheet instead of cells.

### Try this

1. Drag across the data, including the header row and the label column.
2. Click **Insert chart** again.

See [Add a chart](/sheets/charts).

## `Only SELECT queries are allowed` {#only-select-queries-are-allowed}

### What it means

A data source tab only reads from the database. Each query must be one statement that starts with `SELECT` or `WITH`. Two related messages mean the same rule: `Forbidden keyword: …` (the query contains a word such as `INSERT`, `UPDATE`, or `DELETE`, even inside quotes) and `Multiple statements are not allowed`.

### Try this

1. Start the query with `SELECT` or `WITH`.
2. Remove any statement after the first `;`.
3. Remove or rename anything that spells a refused word on its own, such as a quoted `'delete'`.
4. Click **Execute** again.

See [Connect a database](/sheets/connect-a-database).

## `Local lakehouse paths are disabled on this server` {#local-lakehouse-paths-are-disabled-on-this-server}

### What it means

The connection uses **Local filesystem (server-configured)**, and the server's operator hasn't turned local paths on. A related message, `… is not allowed by the server`, means a custom endpoint isn't on the operator's allowlist.

### Try this

1. If the table lives in cloud storage, change **Storage** to that service and enter its path.
2. Otherwise, ask the person who runs your Wafflebase server to turn on local paths or allow the endpoint. Operators: see [Connect databases and lakehouse tables](/developers/self-hosting/optional-features#connect-databases-and-lakehouse-tables).

See [Read lakehouse tables](/sheets/lakehouse).

## `Couldn't upload the image` {#couldn-t-upload-the-image}

### What it means

The image didn't reach the server, so nothing was inserted. The message may end with more detail. Common causes: the file is over 10 MB, it isn't a PNG, JPEG, GIF, or WebP image, or your connection dropped.

### Try this

1. Check the file's format and size. Save it as PNG or JPEG, or make it smaller, if needed.
2. Check your connection, then insert the image again.

See [Add and edit images](/docs-editor/images).

## `Image URL must start with http:// or https://` {#image-url-must-start-with-http-or-https}

### What it means

The address you entered under **By URL…** isn't a full web address. A related message, `Couldn't load the image`, means the address works but doesn't lead to an image the browser can show.

### Try this

1. Copy the image's own address, including `https://`. In most browsers, right-click the image and select **Copy image address**.
2. Paste it into **By URL…** again.
3. If it still fails, download the image and upload it instead.

See [Add and edit images](/docs-editor/images).

## `Margins must be zero or a positive number of inches.` {#margins-must-be-zero-or-a-positive-number-of-inches}

### What it means

A margin box in **Page setup** is empty or holds something other than a plain number, such as `1 in`, `-1`, or `1,5`. **Apply** stays off until you fix it. The related messages `Left and right margins must leave room for content.` and `Top and bottom margins must leave room for content.` mean the margins are too wide for the page.

### Try this

1. Enter each margin as a plain number of inches, such as `1` or `0.75`.
2. If a "leave room" message appears, make the named pair of margins smaller.
3. Click **Apply**.

See [Change margins](/docs-editor/page-layout#change-margins).

## `The cursor left this link. Click it again to edit it.` {#the-cursor-left-this-link-click-it-again-to-edit-it}

### What it means

The cursor moved out of the link while you were editing its address, so **Apply** didn't change anything. The address you typed is still in the box.

### Try this

1. Copy the address from the box.
2. Click inside the link again, then click **Edit link** (pencil).
3. Paste the address and click **Apply**.

See [Add a link](/docs-editor/format-text#add-a-link).

## **Template not found**

### What it means

The template link is wrong, or the template was unpublished.

### Try this

1. Check that you copied the whole link.
2. Click **Browse the gallery** to find a similar template.
3. Ask the person who shared it whether it is still published.

## Version history is missing

### What it means

Version history needs a signed-in workspace member. People who opened a share link don't see it, and presentations don't offer it on a phone.

### Try this

1. Sign in and open the document from your workspace's documents list.
2. For a presentation, use a window at least 768 pixels wide.

## `A restore is already in progress`

### What it means

A restore you started is still running. Wafflebase doesn't start another until it finishes.

### Try this

1. Wait a few seconds for the first restore to finish.
2. Try again.

## `Couldn't update the workspace`

### What it means

The change didn't go through. The most common causes: only workspace owners can change the workspace name and URL, and the URL may already be in use by another workspace.

### Try this

1. Ask a workspace owner to make the change.
2. If you are an owner, choose a different URL, check your connection, and try again.

## `This server is too old for desktop sign-in` {#this-server-is-too-old-for-desktop-sign-in}

### What it means

The desktop app is connected to a Wafflebase server from before the app existed. That server can't sign you in from the app.

### Try this

1. Sign in from a web browser for now.
2. Ask your server's administrator to upgrade Wafflebase.
3. If you meant to use the official server, open **Change server…** and click **Use wafflebase.io**. See [Connect to your team's server](/start/desktop#connect-to-your-team-s-server).

## `This server has desktop sign-in turned off` {#this-server-has-desktop-sign-in-turned-off}

### What it means

The server isn't set up to sign in over HTTPS, so it refuses sign-in from the desktop app. On Windows, a similar message, `This server does not accept sign-in from the Windows app's window`, means the server's administrator turned off sign-in from the Windows app.

### Try this

1. Sign in from a web browser for now.
2. Ask your server's administrator to follow [Allow desktop app sign-in](/developers/self-hosting/sign-in#allow-desktop-app-sign-in).

## `Sign-in timed out. Try again.` {#sign-in-timed-out-try-again}

### What it means

The app waited five minutes for the browser to finish signing in, and it didn't.

### Try this

1. Close the Wafflebase sign-in tabs in your browser.
2. Click **Continue with GitHub** in the app again, and finish the steps in the browser tab it opens.

## **Can't reach** appears in the desktop app {#can-t-reach-appears-in-the-desktop-app}

### What it means

The app can't connect to the server at the address it shows. Your computer may be offline, the address may be wrong, or the server may be down. The app keeps trying on its own.

### Try this

1. Check that your computer is connected to the internet. The app opens Wafflebase as soon as it is.
2. Click **Try again**.
3. Open the address in a web browser. If it doesn't open there either, ask your server's administrator.
4. If the address is wrong, click **Change server…** and enter the one you open Wafflebase at in a browser.

## **Windows protected your PC** appears {#windows-protected-your-pc-appears}

### What it means

Windows SmartScreen shows this for the Wafflebase installer because the installer is not code-signed yet.

### Try this

1. Check that you downloaded the installer from the link in [Install on Windows](/start/desktop#install-on-windows).
2. Click **More info**, then click **Run anyway**.

## A Mac says Wafflebase is damaged or can't be opened {#a-mac-says-wafflebase-is-damaged-or-can-t-be-opened}

### What it means

The Mac app is signed and notarized by Apple, so a copy downloaded from the official link opens without a warning. A warning usually means the download was incomplete or the copy came from somewhere else.

### Try this

1. Move the Wafflebase app you installed to the Trash.
2. Download it again from the link in [Install on a Mac](/start/desktop#install-on-a-mac), and install it.

## Still stuck

Report the problem on [GitHub Issues](https://github.com/wafflebase/wafflebase/issues). Include the exact message, the document type, and your browser or app.

## Related

- [Concepts](/start/concepts): who can see and change what
- [Share a document](/collaborate/share): create and revoke share links
- [Trash](/collaborate/trash): restore deleted documents
- [Version history](/collaborate/version-history): preview and restore earlier versions
