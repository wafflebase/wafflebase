---
title: Manage workspaces and members
description: Create and switch workspaces, invite and remove members, and see what owners and members can do.
type: how-to
---

# Manage workspaces and members

A workspace holds your documents, folders, data sources, and API keys, and its members are the people who can open them.

Every member can open and edit every document in the workspace. To share one document with someone outside it, use a [share link](/collaborate/share) instead.

## Create a workspace

You already have one: the first time you sign in, Wafflebase creates **&lt;your username&gt;'s Workspace** and makes you its owner.

1. Click the workspace name at the top of the sidebar.
2. Select **New workspace**.
3. Enter a name and click **Create**.

The new workspace opens, and you are its owner.

## Switch workspaces

1. Click the workspace name at the top of the sidebar.
2. Select the workspace you want.

Its documents list opens. Each workspace has its own address, `/w/<workspace-url>`, and its own documents, templates, data sources, and trash.

![Sidebar workspace switcher open with two workspaces and New workspace](/images/collaborate/workspaces-switcher.png)

### On a phone

Tap the sidebar button at the top left of the header to open the sidebar, then use the switcher the same way. The sidebar closes when you pick a workspace.

## Invite someone

::: info Before you start
- Only an owner can invite.
- Wafflebase doesn't send email. You copy the link and send it yourself.
:::

1. In the sidebar, click **Settings**.
2. Under **Invites**, click **Create invite link**.
3. In the new row, click the copy icon (**Copy invite link**).
4. Send the link to the person you want to invite.

When they open the link, they sign in if needed and land in the workspace's documents list as a member. Opening it as an existing member changes nothing. The workspace owners and the person who created the invite get a [notification](/collaborate/comments#get-notified) when someone joins.

::: warning An invite link works for anyone who has it
The link isn't tied to an email address, never expires, and can be used by more than one person. Treat it like a password and revoke it when you're done.
:::

![Settings page with the Members table and one invite row with copy and revoke icons](/images/collaborate/workspaces-invites.png)

## Revoke an invite

1. Open **Settings**.
2. Under **Invites**, click the trash icon (**Revoke invite**) in the invite's row.

The link stops working right away. People who already joined with it stay members.

## Remove a member or leave

1. Open **Settings**.
2. Under **Members**, click the trash icon (**Remove member**) in the person's row.
3. Read what the removal will delete or turn off, then click **Remove**, or **Leave** for yourself.

An owner sees the icon on every member's row, but never on an owner's row. A member sees it only on their own row, which is how you leave a workspace.

When someone is removed:

- They lose access to every document, folder, and data source in the workspace. Their other workspaces are unaffected.
- The documents they created stay in the workspace and keep them as the author.
- Their API keys for this workspace are revoked for good. Adding them back doesn't bring the keys back.
- Private chat channels that only they belonged to are deleted, messages included.
- Webhooks they created are turned off. Another owner can turn one back on, which makes that owner its creator. See [Webhooks](/developers/webhooks).

## Rename the workspace or change its URL

1. Open **Settings**.
2. Edit **Workspace name** or **Workspace URL**.
3. Click **Save** next to the field you changed.

Only an owner can save these changes; a member who tries sees *Couldn't update the workspace*. Links to documents keep working after a URL change, but links to the old `/w/<workspace-url>` address stop working.

## Delete a workspace

::: danger Deleting a workspace can't be undone
It permanently deletes every document, folder, data source, invite, and API key in it. Deleted documents don't go to the [Trash](/collaborate/trash).
:::

1. Open **Settings** as an owner.
2. Under **Delete workspace**, click **Delete this workspace**.
3. Type the workspace's name to confirm.
4. Click **Delete workspace**.

You can't delete your last workspace.

## See who viewed shared documents

**Analytics** appears in the sidebar only when your deployment has turned on view analytics. It counts visits through [share links](/collaborate/share).

1. In the sidebar, click **Analytics**.
2. Pick a date range: **Last 7 days**, **Last 30 days** (the default), **Last 90 days**, or **All time**.
3. To see one document's numbers, click **Details** in its row under **Most viewed documents**.

The workspace page shows **Total views**, **Unique visitors**, and the most viewed documents. A document's page adds **Returning visitors**, **Avg. dwell**, and views per share link. **Details** appears only on documents you created, or on every document if you own the workspace.

## Check what each role can do

A workspace has two roles. Whoever creates it is the **owner**, and everyone who joins with an invite link is a **member**.

Some actions need you to *manage* the document or folder: you created it, or you own the workspace.

| Action | Member | Owner |
|---|---|---|
| Open, create, edit, rename, and copy documents | Yes | Yes |
| Comment, and see version history | Yes | Yes |
| Move a document, or move it to the Trash | Ones you created | Yes |
| Restore or delete forever from the Trash | Ones you created | Yes |
| Create and rename folders | Yes | Yes |
| Move or delete a folder | Ones you created | Yes |
| Create a viewer share link | Yes | Yes |
| Create an editor share link, or publish a template | Ones you created | Yes |
| Revoke a share link | Links you created, and any link on documents you created | Any link |
| Use and edit data sources | Yes | Yes |
| Create API keys, and see and revoke them | Your own | Everyone's |
| Invite people and revoke invites | No | Yes |
| Remove a member | Only yourself | Any member |
| Rename the workspace or change its URL | No | Yes |
| Delete the workspace | No | Yes |

Roles are fixed. The app has no way to promote a member, transfer ownership, or let an owner leave, so decide who should own a workspace before you invite people.

::: warning Folders don't restrict access
Every member can open every document, whatever folder it's in. Keep content that some members shouldn't see in a separate workspace.
:::

Data source connections belong to the workspace, so any member can query them with the saved credentials. See [Connect a database](/sheets/connect-a-database).

## Known limitations

- Invite links from Settings always add a member and never expire.
- An owner can't leave a workspace or be removed from it in the app.
- People who open a share link aren't members. They can't be mentioned or notified.

## Related

- [Share a document](/collaborate/share) with people outside the workspace.
- [Folders](/collaborate/folders) to organize a workspace's documents.
- [Concepts](/start/concepts) for how workspaces, share links, and templates relate.
- [API quickstart](/developers/api/quickstart) to create and use an API key.
