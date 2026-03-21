# Collaboration & Sharing

Wafflebase lets multiple people edit the same spreadsheet at the same time. Share a document via link — no account required for recipients.

## Share a Document

1. Open the document you want to share
2. Click the **Share** button in the toolbar
3. Choose the access level:
   - **View** — Can see and copy the data, but not edit
   - **Edit** — Full editing access
4. Optionally set an expiration (1 hour, 8 hours, 24 hours, or 7 days)
5. Click **Create Link** and copy the URL

Send the link to anyone. They can open it in their browser without signing in.

## Access Levels

| Permission | Viewer | Editor |
|-----------|--------|--------|
| View data | Yes | Yes |
| Select and copy cells | Yes | Yes |
| Navigate and scroll | Yes | Yes |
| Edit cells | No | Yes |
| Use formulas | No | Yes |
| Format cells | No | Yes |
| Insert/delete rows and columns | No | Yes |
| Resize columns | No | Yes |
| Undo/redo | No | Yes |

## Edit Together

When a teammate opens your shared link, you'll see:

- **Their cursor** — A colored highlight shows which cell they've selected
- **Their name** — Appears near their cursor so you know who's editing where
- **Live changes** — When they type a value or formula, you see it appear instantly

You don't need to refresh or save. Everything syncs automatically.

::: tip
Each collaborator gets a unique color, so you can easily tell who is working where. If your collaborators sign in with GitHub, their name will appear next to their cursor.
:::

## How Conflicts Work

What happens if two people edit the **same cell** at the same time?

Wafflebase uses CRDTs (Conflict-free Replicated Data Types) to handle this. Both edits are preserved in the system — the last writer's value is displayed. There's no "conflict dialog" or manual merge step.

In practice, presence cursors make it easy to see where others are working, so simultaneous edits to the same cell are rare.

## Manage Share Links

To see or revoke existing links:

1. Open the document
2. Click **Share** in the toolbar
3. You'll see a list of active links with their role and expiration
4. Click the delete icon next to a link to revoke it immediately

Revoking a link immediately blocks access — anyone with that URL will no longer be able to open the document.

## Good to Know

- Revoking or expiring a link blocks access immediately
- Deleting a document automatically invalidates all its share links
- Links cannot be guessed — each one is generated with a unique random ID
- For sensitive data, use short expirations (1 hour or 8 hours)

## Tips for Team Spreadsheets

- **Use separate tabs** — Give each team member their own tab for data entry, with a summary tab that pulls data using formulas
- **Use clear headers** — Label your columns so teammates know what goes where
- **Communicate changes** — If you restructure columns or rename tabs, let your team know
