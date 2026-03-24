# Collaboration & Sharing

Wafflebase lets multiple people edit the same sheet or document at the same time. Share via link — no account required for recipients.

## Share a Document

1. Open the sheet or document you want to share
2. Click the **Share** button in the toolbar
3. Choose the access level:
   - **View** — Can see the content, but not edit
   - **Edit** — Full editing access
4. Optionally set an expiration (1 hour, 8 hours, 24 hours, or 7 days)
5. Click **Create Link** and copy the URL

Send the link to anyone. They can open it in their browser without signing in.

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

- **Their cursor** — In sheets, a colored highlight on their selected cell. In docs, a colored text cursor at their position.
- **Their name** — Appears near their cursor so you know who's editing where
- **Live changes** — Edits appear instantly with no need to refresh or save

::: tip
Each collaborator gets a unique color. If your collaborators sign in with GitHub, their name will appear next to their cursor.
:::

## How Conflicts Work

What happens if two people edit the same cell or text at the same time?

Wafflebase uses CRDTs (Conflict-free Replicated Data Types) to handle this. Both edits are preserved in the system — the last writer's value is displayed in sheets, and concurrent text insertions are merged in docs. There's no "conflict dialog" or manual merge step.

In practice, presence cursors make it easy to see where others are working, so simultaneous edits to the same location are rare.

## Manage Share Links

To see or revoke existing links:

1. Open the sheet or document
2. Click **Share** in the toolbar
3. You'll see a list of active links with their role and expiration
4. Click the delete icon next to a link to revoke it immediately

Revoking a link immediately blocks access — anyone with that URL will no longer be able to open it.

## Good to Know

- Revoking or expiring a link blocks access immediately
- Deleting a document automatically invalidates all its share links
- Links cannot be guessed — each one is generated with a unique random ID
- For sensitive data, use short expirations (1 hour or 8 hours)

## Tips for Collaboration

- **Use clear names** — Title your sheets and documents descriptively so teammates can find them
- **Communicate changes** — If you restructure columns or reorganize content, let your team know
- **Use separate tabs** (sheets) — Give each team member their own tab for data entry, with a summary tab that pulls data using formulas
