# Collaborate with Your Team

Wafflebase lets multiple people edit the same spreadsheet at the same time. This guide shows you how to share a document and work together.

## Share a Document

1. Open the document you want to share
2. Click the **Share** button in the toolbar
3. Copy the generated link

Send the link to your teammates. Anyone with the link can open the document.

### Access Levels

When sharing, you can choose the access level:

- **View** — Can see the data but not edit
- **Edit** — Can view and modify the data

## Edit Together

When a teammate opens your shared link, you'll see:

- **Their cursor** — A colored highlight shows which cell they've selected
- **Their name** — Appears near their cursor so you know who's editing where
- **Live changes** — When they type a value or formula, you see it appear instantly

You don't need to refresh or save. Everything syncs automatically.

::: tip
Each collaborator gets a unique color, so you can easily tell who is working where.
:::

## How Conflicts Work

What happens if two people edit the **same cell** at the same time?

Wafflebase uses CRDTs (Conflict-free Replicated Data Types) to handle this. Both edits are preserved in the system — the last writer's value is displayed. There's no "conflict dialog" or manual merge step.

In practice, presence cursors make it easy to see where others are working, so simultaneous edits to the same cell are rare.

## Tips for Team Spreadsheets

- **Use separate tabs** — Give each team member their own tab for data entry, with a summary tab that pulls data using formulas
- **Use clear headers** — Label your columns so teammates know what goes where
- **Communicate changes** — If you restructure columns or rename tabs, let your team know
