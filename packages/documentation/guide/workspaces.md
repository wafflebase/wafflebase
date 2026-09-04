# Workspaces & Members

A **workspace** is the container everything else lives in. Every document,
folder, datasource, and API key belongs to exactly one workspace, and the people
in that workspace are the people who can reach them.

Sharing a *single* document with someone outside the workspace is a different
thing — that's a share link, covered in
[Collaboration & Sharing](/guide/collaboration).

## Your First Workspace

You don't have to create one. The first time you sign in, Wafflebase creates a
workspace for you called **&lt;your username&gt;'s Workspace** and makes you its
owner.

To create another, use the workspace switcher at the top of the sidebar: it
shows the workspace you're currently in, lists the others you belong to, and
offers **New workspace**. Enter a name and click **Create** — you're the owner of
the new one too.

The switcher is also how you move between workspaces. Each has its own URL,
`/w/<workspace>`, and its own documents list, templates, datasources, and
analytics.

## Roles

There are exactly two roles: **Owner** and **Member**. Whoever creates a
workspace is its owner; everyone who joins by invite is a member unless the
invite says otherwise.

| Action | Member | Owner |
|--------|--------|-------|
| Open, create, and edit any document in the workspace | Yes | Yes |
| Create folders, and rename them | Yes | Yes |
| Delete or move a folder | Only ones you created | Yes |
| Delete or move a document to another workspace | Only ones you created | Yes |
| Create a **viewer** share link | Yes | Yes |
| Create an **editor** share link | Only for documents you created | Yes |
| Revoke someone else's share link | No | Yes |
| Create, edit, delete, and query datasources | Yes | Yes |
| See the list of API keys | Yes | Yes |
| Create or revoke an API key | No | Yes |
| Invite people, and revoke invites | No | Yes |
| Remove a member | Only yourself | Yes |
| Rename the workspace or change its URL | No | Yes |
| Delete the workspace | No | Yes |

::: warning Membership is the only permission on a document
There are no per-document permissions inside a workspace. Every member can open
and edit every document in it — folders organize documents, they don't restrict
them. If some content shouldn't be visible to everyone on the list, it belongs in
a different workspace.
:::

### What "only ones you created" means

For a handful of administrative actions — deleting a document, moving it to
another workspace, minting an **editor** share link, revoking a link someone else
made — Wafflebase asks whether you are the document's *author* or the workspace's
*owner*. A member who didn't create the document can still edit its content, but
can't do those four things to it. The rule is enforced on the server, not just in
the interface.

An owner is a manager of **every** document in the workspace, including
documents created by people who have since left.

::: warning Datasource credentials are shared
A datasource connection is stored on the workspace, not on the person who added
it. Any member can run queries against its saved credentials, and can edit or
delete the connection — there is no owner-only tier for them. See
[Connections are shared with the workspace](/sheets/datasources#connections-are-shared-with-the-workspace).
:::

## Workspace Settings

**Settings** in the sidebar opens `/w/<workspace>/settings`. It's a single page
of sections:

- **Workspace Name** — the display name, visible to all members
- **Workspace URL** — the slug after `/w/`. Changing it updates all links, and
  the settings page reloads at the new address
- **Members** — everyone in the workspace, with their username, email, and role
- **Invites** — *owners only*
- **API Keys** — *owners only*
- **Danger Zone** — *owners only*

A member sees the first three sections and nothing below them.

::: tip
The Name and URL fields are visible to members, but saving them is an owner
action — a member who edits one gets a "Failed to update workspace" message
rather than a disabled field.
:::

## Invite Someone

Only an owner can invite.

1. Open **Settings** for the workspace
2. Under **Invites**, click **Create Invite**
3. A row appears in the table. Use the copy icon to put the link on your
   clipboard
4. Send that link however you like

The link looks like `https://<your-site>/invite/<token>`.

::: warning Nothing is emailed, and the link isn't tied to a person
Wafflebase doesn't send invitation emails — copying the link and delivering it
is the whole flow. The invite isn't bound to an email address either: **anyone**
who is signed in and has the link can join the workspace with it, and it keeps
working for more than one person until you revoke it. Treat an invite link like a
password.
:::

The **Create Invite** button always creates a *member* invite that never expires
— which is why the **Expires** column reads **Never**. Invites with a different
role or an expiry can be created through the REST API, but not from this screen.

Revoke an invite with the trash icon in its row. That stops the link working
immediately; it does not remove anyone who has already joined with it.

### Accepting an invite

Opening the link signs you in if you aren't already, then joins you to the
workspace and drops you into its documents list — there's no confirmation step
or accept button.

If you're already a member, the link just opens the workspace and changes
nothing: an invite never changes an existing member's role.

When someone joins, the workspace's owners and the person who created the invite
are notified. See [Notifications](/guide/collaboration#notifications).

## Remove a Member

In **Settings → Members**, an owner gets a trash icon on every member's row.
Clicking it removes them straight away — there is no confirmation dialog.

What happens to the person:

- They lose access to every document, folder, and datasource in the workspace
- Any API keys they created for this workspace are revoked, permanently. Adding
  them back later does not reactivate the old keys
- Their other workspaces are untouched

What happens to their work:

- **Nothing is deleted.** Every document they created stays in the workspace and
  keeps their name as its author
- Because they're no longer a member, they can no longer open those documents
- The workspace's owners remain managers of them, so nothing becomes stranded

### Leaving a workspace

A member can remove their own row to leave. An **owner cannot leave** — the
option isn't offered, and the server refuses it.

::: warning Roles are fixed once someone joins, and owners are permanent
There is no way to promote a member to owner, demote an owner, or transfer
ownership after the fact — no control in the interface and no API for it. Owners
also can't be removed from the Members table: the trash icon never appears on an
owner's row.

In practice this means the role someone joins with is the role they keep, and an
owner's only way out of a workspace is to delete it. Decide who should be an
owner before you invite them.
:::

## Delete a Workspace

Under **Danger Zone**, **Delete this workspace** asks you to type the
workspace's name to confirm. Deleting it permanently removes its documents,
folders, datasources, invites, API keys, and membership list. There is no
undo, and no trash to recover from.

You can't delete your last workspace — Wafflebase refuses if it's the only one
you belong to.

## Workspaces, Documents, and Folders

- Every document is in exactly one workspace, always. There's no "no workspace"
  state
- A document can be **moved** to another workspace, by someone who is a manager
  of it and a member of the destination
- **Folders** organize a workspace's documents into a tree. They're
  purely organizational: a folder grants and restricts nothing, and deleting one
  returns its documents to the workspace root rather than deleting them. See
  [Organizing with Folders](/pdf/organizing-with-folders)
- **Templates**, **datasources**, **API keys**, and **analytics** are all scoped
  to one workspace and don't cross between them
- **Comments and mentions** stay inside the workspace too — only members can be
  mentioned or notified

## Good to Know

- Signing out of one workspace isn't a thing — you're signed into Wafflebase,
  and the switcher moves you between the workspaces you belong to
- Someone reading a document through a share link is **not** a member. They have
  no sidebar, no workspace, and can't be mentioned or notified
- Renaming a workspace's URL breaks links people have bookmarked to
  `/w/<old-slug>/…`
