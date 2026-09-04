# Organizing with Folders

Folders let you organize a workspace's documents into a tree — the same way a
Shared Drive works. Folders are **purely organizational**: they group documents
for browsing but do not change who can access a document.

Every document type can live in a folder — sheets, docs, slides, notes, boards,
PDFs, images, and any other file you've uploaded.

## Create a folder

1. Open your workspace
2. Click the **New** dropdown button
3. Select **New folder**
4. Give it a name

The new folder is created inside whichever folder you're currently browsing, so
folders nest to any depth and you can build a structure like
`Team → Projects → 2026`.

::: tip Folders need a workspace
**New folder** appears only when you're looking at a single workspace's list. The
combined list of every workspace's documents has no one workspace to create the
folder in, so the entry isn't offered there — switch to a workspace first.
:::

## Move documents and folders

- **Drag a document onto a folder row** to move it there. Select several first
  and the whole selection moves together. You can also drop onto a segment of
  the breadcrumb to move a document back up the tree.
- Use **Move to…** in a row's **⋯** menu to do the same through a dialog — which
  is also how you move a *document* into a different workspace.
- Moving a folder brings all of its contents along with it.

::: warning Folders never leave their workspace
The **Move to…** dialog lets you pick another workspace, but that only applies
to documents. Ask it to move a folder there and the folder stays where it is —
you're told "Folders can't move to another workspace" and only the documents in
the selection move.
:::

Moving is limited to documents you created, unless you own the workspace: a row
you don't manage can't be picked up at all, and a multi-selection containing one
is refused with a message instead of moving the rest. Moving a *folder* follows
the same rule, but — as with deleting one — the menu entry is shown to everyone:
**Move to…** is offered on every folder row, so a member moving a folder they
neither created nor own the workspace for gets a "Failed to move" message rather
than a missing button. See
[Workspaces & Members](/guide/workspaces#roles) for who counts as what.

## Browse folders

- **Click a folder** to drill into it and see the documents inside.
- The **breadcrumb** at the top shows where you are; click any segment to jump
  back up the tree.
- The workspace root is the top level — documents that aren't in any folder
  live there.

## Rename a folder

Open the folder row's **⋯** menu and choose **Rename**. Any member of the
workspace can rename any folder — renaming is the one folder action that isn't
restricted to the person who created it.

## Delete a folder

**Delete** in the same **⋯** menu removes the folder and its sub-folders, but
**never deletes your documents** — any documents inside return to the workspace
root so nothing is lost.

Unlike renaming, deleting is restricted: you can delete folders you created, and
a workspace owner can delete any of them. The menu entry is shown to everyone,
so a member deleting someone else's folder gets a "Failed to delete" message
rather than a missing button. See
[Workspaces & Members](/guide/workspaces#roles).

::: tip
Folders only organize documents; they don't grant or restrict access. Sharing
and permissions are controlled per-document — see
[Collaboration & Sharing](/guide/collaboration).
:::
