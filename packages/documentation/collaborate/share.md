---
title: Share a document
description: Create a share link so people outside your workspace can view or edit a document, and copy or revoke links later.
type: how-to
---

# Share a document

Create a share link to let anyone open a document in their browser, with or without a Wafflebase account.

A share link works for every document type: sheets, docs, presentations, notes, boards, PDFs, images, and other files. Members of your workspace don't need a link; they can already open everything in it.

::: info Before you start
- Any member can create a **Viewer** link.
- An **Editor** link needs the document's author or a workspace owner.
- A link never expires unless you pick an **Expiration**.
:::

## Create a share link

1. Open the document.
2. Click **Share** in the top right of the header.
3. Under **Permission**, select **Viewer** or **Editor**.
4. Under **Expiration**, select **No limit**, **1 hour**, **8 hours**, **24 hours**, or **7 days**.
5. Click **Create link**.

The link is copied to your clipboard and appears under **Active links**. Paste it into an email or chat to share it.

If you can't create editor links, **Editor** is grayed out and the dialog says *Only the document owner or a workspace owner can create editor links.*

::: warning Anyone with the link can open the document
Recipients don't need to sign in, and they can pass the link on. For sensitive content, pick a short **Expiration** before you click **Create link**.
:::

![Share document dialog with Permission, Expiration, and two Active links](/images/collaborate/share-dialog.png)

### On a phone

**Share** stays in the header on a phone as an icon button. Tap it to open the same dialog.

## Copy or revoke a link

1. Open the document and click **Share**.
2. Find the link under **Active links**. Each row shows its role and **No expiration**, a countdown such as *Expires in 6h*, or **Expired**.
3. Click the copy icon (**Copy link**) to copy it again, or the trash icon (**Revoke link**) to turn it off.

A revoked link stops working right away. You can revoke links you created. The document's author and workspace owners can revoke any link. If you can't create editor links, other people's editor links aren't listed for you.

## Choose viewer or editor

| A person with the link can | Viewer | Editor |
|---|---|---|
| Open, scroll, select, and copy | Yes | Yes |
| Read comments | Yes | Yes |
| Edit, format, and undo | No | Yes |
| Add comments | No | Yes, when signed in |
| Open version history | No | No |

On a PDF, an editor link can comment without signing in.

## What people see when they open the link

- The document opens on its own, without your workspace's sidebar or documents list.
- A viewer sees a **View only** badge next to the title. An editor sees the save status instead. See [Edit together](/collaborate/edit-together#check-that-your-work-is-saved).
- People who aren't signed in appear to others as **Anonymous**.
- There is no version history. Only signed-in workspace members can see it.

If the link was revoked, has expired, or the document is in the [Trash](/collaborate/trash), the page says **Link unavailable**.

![Shared doc opened without signing in, with the View only badge next to the title](/images/collaborate/share-recipient-view.png)

## Known limitations

- A link shares one document. To share many, share each one or invite people to the workspace.
- Moving a document to the Trash turns off its links until it is restored. **Delete forever** turns them off for good.
- People on a share link can't be mentioned and don't get notifications.

## Related

- [Workspaces and roles](/collaborate/workspaces) to give someone access to everything in a workspace.
- [Edit together](/collaborate/edit-together) to see who else is in the document.
- [Comments and mentions](/collaborate/comments) to collect feedback without edits.
- [Troubleshooting](/start/troubleshooting) if a link says **Link unavailable**.
