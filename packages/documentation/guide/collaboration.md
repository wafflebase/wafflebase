# Collaboration & Sharing

Wafflebase lets multiple people edit the same sheet, document, presentation, or note at the same time — and read and comment on the same PDF. Share via link — no account required for recipients.

## Share a Document

1. Open the sheet or document you want to share
2. Click the **Share** button in the toolbar
3. Under **Permission**, choose the role:
   - **Viewer** — Can see the content, but not edit
   - **Editor** — Full editing access
4. Under **Expiration**, choose **No limit**, **1 hour**, **8 hours**,
   **24 hours**, or **7 days**
5. Click **Create Link** — the URL is created and copied to your clipboard

Send the link to anyone. They can open it in their browser without signing in.

::: warning Expiration defaults to No limit
**Expiration** starts on **No limit**, so a link you create without touching
that field never expires — it keeps working until you revoke it. Set a window
before you click **Create Link** if the content is sensitive.
:::

### Who can create an editor link

**Viewer** links are open to any member of the document's workspace.
**Editor** is restricted: only the document's author or an **owner** of its
workspace can create one. Everyone else sees the Editor option greyed out with
a note explaining why, and can create viewer links instead. The rule is
enforced on the server, not just in the dialog.

## Access Levels

| Permission | Viewer | Editor |
|-----------|--------|--------|
| View content | Yes | Yes |
| Navigate and scroll | Yes | Yes |
| Select and copy | Yes | Yes |
| Edit content | No | Yes |
| Format (cells or text) | No | Yes |
| Undo/redo | No | Yes |

In sheets, editors can also use formulas, insert/delete rows and columns, and resize columns. In docs, editors can apply text formatting and paragraph alignment.

## Edit Together

When a collaborator opens your shared link, you'll see:

- **Their cursor** — In sheets, a colored highlight on their selected cell. In docs and notes, a colored text cursor at their position. In PDFs, you can see who else is viewing the file.
- **Their name** — A label appears next to their cursor when they move, then
  fades after about four seconds so the content stays readable. Hover their
  cursor to bring the name back.
- **Live changes** — Edits appear instantly with no need to refresh or save

::: tip
Each collaborator gets a unique color. If your collaborators sign in with GitHub, their name will appear next to their cursor.
:::

### Jump to a collaborator

In sheets and documents, the avatars in the header are clickable: select one to
scroll to where that person is working. Their name label reappears when you
land so you can confirm whose position you jumped to. Your own avatar isn't
clickable, and neither is one for a peer whose position isn't known yet.

## Is My Work Saved?

A small status chip sits in the editor header and reports whether your edits
have reached the server. It has four states:

| Chip | What it means |
|------|---------------|
| **Saved** | Connected, and everything you've done is on the server. |
| **Saving…** | Connected, and your recent changes are on their way. |
| **Reconnecting…** | The connection dropped, but nothing of yours is waiting to be sent. |
| **Not saved** | You have changes that aren't reaching the server. |

Hover the chip for a fuller explanation of the current state. **Not saved** is
the only state that is loud about itself: if it persists for a couple of
seconds, a warning appears, and it clears with a confirmation once your work is
actually on the server.

::: warning
While changes are unsent, this browser tab is the only copy of them — nothing
is stored on your machine. If you try to close or reload the tab in that state,
the browser asks you to confirm first. Wait for **Saved** before leaving.
:::

The chip appears in sheets, documents, slides, notes, and boards, and in a
share link opened with the **Editor** role. A **Viewer** share link shows a
**View only** badge in its place — a viewer makes no changes, so there is
nothing for it to report.

## Comments & Mentions

Leave feedback without changing the content. Comments work on cells in sheets,
on selected text in documents, and on a page region in PDFs. Slides, notes, and
boards don't have comments yet.

### Add a comment

**In a sheet:**

1. Select the cell you want to comment on
2. Right-click and choose **Insert comment**, or press **⌘+Option+M** /
   **Ctrl+Alt+M**
3. Type your comment and click **Comment**

**In a document:**

1. Select the text you want to comment on
2. Right-click and choose **Insert comment**, press **⌘+Option+M** /
   **Ctrl+Alt+M**, or click the comment icon in the toolbar
3. Type your comment and click **Comment**

The commented text is highlighted so everyone can see where the discussion is.

**In a PDF:**

1. Click **Add comment** in the header
2. Drag a rectangle over the region of the page you want to comment on
3. Type your comment and post it

The comment is pinned to that page and region. Open the comments panel from the
header to browse every thread by page. See [Viewing PDFs](/pdf/viewing-pdfs) for
more.

### Reply, resolve, edit

- **Reply** — Open a comment and click **Reply** to continue the thread.
- **Resolve** — Hover the thread and click the check (✓) to resolve it.
  Resolved threads are tucked away but never lost.
- **Edit / Delete** — Hover your own comment and use the **⋯** menu. Deleting
  the first comment removes the whole thread.

### The comments panel

Sheets and documents both have a side panel listing every thread. Click the
comment icon in the header — or press **⌘+Option+Shift+M** /
**Ctrl+Alt+Shift+M** — to open it. Threads are grouped under **Open** and
**Resolved** tabs; click a thread to jump to the cell or text it belongs to. In
a document, if the text a comment was attached to is later deleted, the thread
moves to an orphaned list so the conversation is preserved.

PDFs have a comments panel too, opened from the header — see
[Viewing PDFs](/pdf/viewing-pdfs).

### Mention a teammate

Type **@** inside a comment to mention a workspace member. An autocomplete list
appears — keep typing to filter, then use **↑ / ↓** and **Enter** (or **Tab**)
to pick someone. The mention is inserted as a blue chip so it stands out in the
thread.

::: tip
Mentions highlight who a comment is for. Only people who are members of the
workspace can be mentioned.
:::

## Notifications

A mention doesn't just stand out in the thread — it reaches the person. The
bell in the header carries a badge with your unread count (it stops counting at
**99+**), and opening it lists what happened, newest first. Select a row to
mark it read and jump to what it's about, or use **Mark all read** to clear the
badge.

You are notified when:

- **Someone mentions you** in a comment
- **Someone replies** to a thread you've commented in
- **Someone resolves** a thread you've commented in
- **Someone joins a workspace** you own, or accepts an invite you created
- **A template you published** is approved, rejected, or removed from the
  public gallery, or goes back for review after its document changed

Starting a brand-new thread notifies nobody unless it mentions someone. You are
never notified about your own actions, and a reply that mentions you produces
one notification, not two.

::: tip
The bell only appears when you're signed in — someone reading through a share
link has no inbox. Notifications also stay inside the workspace: only workspace
members can be notified, and only a workspace member's comment can notify
anyone.
:::

## Version History

Every sheet, document, presentation, note, and board keeps a history of past
versions. Click the **history** icon in the editor header to toggle the
**Version history** panel open on the right.

The panel lists versions grouped by day. Most entries are **Automatic** —
snapshots taken as the document is edited, so the timeline follows activity
rather than the clock. To mark a moment you want to find again, type a name
into **Name current version** and click **Save**; named versions you created
are tagged **By you**.

Each entry offers two actions:

- **Preview** — open that version read-only without changing anything.
  Not yet available in documents, where the button is disabled.
- **Restore** — roll the document back to that version.

Restoring first saves the current state as a **Before restore** version, so a
restore is always reversible. Note that comments are part of the version being
restored: any comment added after it was created is removed along with the rest
of the newer content. Wafflebase asks you to confirm before it goes ahead.

::: tip
Version history is only available when you're signed in and opening the
document from your workspace — the panel isn't part of a share link. The list
shows the 50 most recent versions.
:::

## How Conflicts Work

What happens if two people edit the same cell or text at the same time?

Wafflebase uses CRDTs (Conflict-free Replicated Data Types) to handle this. Both edits are preserved in the system — the last writer's value is displayed in sheets, and concurrent text insertions are merged in docs. There's no "conflict dialog" or manual merge step.

In practice, presence cursors make it easy to see where others are working, so simultaneous edits to the same location are rare.

## Manage Share Links

To see or revoke existing links:

1. Open the sheet or document
2. Click **Share** in the toolbar
3. Under **Active links** you'll see each link's role and expiration —
   **No expiration**, a countdown such as *Expires in 6h*, or **Expired**
4. Use the copy icon to copy a link again, or the delete icon to revoke it

Revoking a link immediately blocks access — anyone with that URL will no longer be able to open it.

You can always revoke a link you created yourself. Revoking links other people
created takes the same authority as creating an editor link: the document's
author or a workspace owner. Editor links you didn't create aren't listed for
you at all, so the token can't be copied and passed on.

## Good to Know

- Revoking or expiring a link blocks access immediately
- Deleting a document automatically invalidates all its share links
- Links cannot be guessed — each one is generated with a unique random ID
- New links are created with **No limit** unless you pick an expiration, so for
  sensitive data choose a short one (1 hour or 8 hours) before creating the link

## Tips for Collaboration

- **Use clear names** — Title your sheets and documents descriptively so teammates can find them
- **Communicate changes** — If you restructure columns or reorganize content, let your team know
- **Use separate tabs** (sheets) — Give each team member their own tab for data entry, with a summary tab that pulls data using formulas
