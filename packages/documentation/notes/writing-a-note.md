# Writing a Note

Notes are lightweight **Markdown** documents in Wafflebase. Unlike the
word-processor Docs editor, a note is written as Markdown *source* on one side
with a live rendered *preview* on the other — a fast way to jot down meeting
notes, drafts, and technical documentation, with the same real-time
collaboration as every other document type.

## Create a Note

1. Open your workspace
2. Click the **New** dropdown button
3. Select **New Note**

A blank note opens with the editor and preview side by side.

## The Editor

The left pane is a Markdown source editor. Type standard Markdown and watch the
right pane render it live as you go.

```markdown
# Project Kickoff

## Agenda
- Introductions
- Timeline review
- **Next steps**

See the [design doc](https://example.com) for details.
```

### Choose Your View

Use the **view** dropdown at the right of the toolbar to switch between three
modes:

- **Split** — source editor and preview side by side (the default)
- **Editor** — Markdown source only, full width
- **Preview** — rendered output only

Your choice is remembered per browser, so the note opens the same way next time.

## Formatting Toolbar

When the editor is visible, a toolbar gives you one-click Markdown for the most
common styles. Select some text first, then click a button to wrap it:

| Button | Inserts | Result |
|--------|---------|--------|
| **B** | `**text**` | **Bold** |
| *I* | `*text*` | *Italic* |
| ~~S~~ | `~~text~~` | ~~Strikethrough~~ |
| Link | `[text](url)` | A hyperlink |
| Table | A GFM table skeleton | A Markdown table |

::: tip
The **Insert table** button shows a small grid — hover to choose the number of
rows and columns, then click to drop in a ready-to-fill table.
:::

## What the Preview Renders

The preview supports **GitHub-Flavored Markdown** plus a few extras:

- **Tables** — standard `| col | col |` GFM tables
- **Task lists** — `- [ ]` and `- [x]` render as checkboxes
- **Code blocks** — fenced ``` blocks get syntax highlighting and a **Copy**
  button in the corner
- **Math** — inline `$…$` and block `$$…$$` render with KaTeX
- **Links, headings, lists, blockquotes, images** — as you'd expect

For safety, the preview does **not** render raw HTML embedded in your Markdown —
only Markdown syntax is rendered.

## Keyboard Mode

Prefer modal editing? Open the **keyboard** dropdown in the toolbar and switch
from **Default** to **Vim**. Vim keybindings then apply inside the source
editor. Like the view mode, this is remembered per browser.

Standard editing shortcuts work in Default mode:

| Action | Shortcut |
|--------|----------|
| Undo | ⌘+Z / Ctrl+Z |
| Redo | ⌘+Shift+Z / Ctrl+Shift+Z |
| Select all | ⌘+A / Ctrl+A |
| Copy / Cut / Paste | ⌘+C·X·V / Ctrl+C·X·V |

## Collaborate in Real Time

Notes sync live through Wafflebase's CRDT engine, just like sheets, docs, and
slides. When a teammate opens the same note:

- Their edits appear instantly as they type
- You see their **cursor and text selection** in their own color
- No saving, refreshing, or merge step is ever needed

Share a note the same way as any document — click **Share** in the header to
create a view or edit link. See
[Collaboration & Sharing](/guide/collaboration) for the full sharing flow.

## Rename a Note

Click the note's title in the header to rename it. The new title appears in your
workspace document list immediately.

::: tip
Notes are ideal for content you'd otherwise keep in a `README` or a Markdown
scratchpad — release notes, runbooks, and specs — kept in sync with your team
without leaving Wafflebase.
:::
