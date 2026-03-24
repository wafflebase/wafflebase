# Documentation Site Update for Docs Editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the documentation site to have separate Sheets and Docs sections, add Docs editor guides, and update developer docs with document type support.

**Architecture:** Reorganize the VitePress sidebar from a flat "Guide" section into Guide (common), Sheets, Docs, and Developers sections. Move existing sheet-specific pages under `sheets/`, create new Docs pages under `docs-editor/`, and update common pages to cover both document types.

**Tech Stack:** VitePress, Markdown

---

## File Structure

### New files
- `packages/documentation/sheets/build-a-budget.md` — moved from guide/
- `packages/documentation/sheets/formulas.md` — moved from guide/
- `packages/documentation/sheets/charts.md` — moved from guide/
- `packages/documentation/sheets/keyboard-shortcuts.md` — moved from guide/
- `packages/documentation/docs-editor/writing-a-document.md` — new Docs guide
- `packages/documentation/docs-editor/keyboard-shortcuts.md` — new Docs shortcuts

### Modified files
- `packages/documentation/.vitepress/config.ts` — new sidebar structure
- `packages/documentation/README.md` — update table of contents for new structure
- `packages/documentation/guide/getting-started.md` — add sheet/doc creation flow
- `packages/documentation/guide/collaboration.md` — generalize for both types
- `packages/documentation/developers/rest-api.md` — add `type` parameter, update intro text
- `packages/documentation/developers/cli.md` — add `--type` option

### Deleted files (after move)
- `packages/documentation/guide/build-a-budget.md`
- `packages/documentation/guide/formulas.md`
- `packages/documentation/guide/charts.md`
- `packages/documentation/guide/keyboard-shortcuts.md`

---

### Task 1: Create Sheets directory and move existing pages

**Files:**
- Create: `packages/documentation/sheets/build-a-budget.md`
- Create: `packages/documentation/sheets/formulas.md`
- Create: `packages/documentation/sheets/charts.md`
- Create: `packages/documentation/sheets/keyboard-shortcuts.md`
- Delete: `packages/documentation/guide/build-a-budget.md`
- Delete: `packages/documentation/guide/formulas.md`
- Delete: `packages/documentation/guide/charts.md`
- Delete: `packages/documentation/guide/keyboard-shortcuts.md`

- [ ] **Step 1: Create sheets directory and move files**

```bash
cd packages/documentation
mkdir -p sheets
mv guide/build-a-budget.md sheets/
mv guide/formulas.md sheets/
mv guide/charts.md sheets/
mv guide/keyboard-shortcuts.md sheets/
```

- [ ] **Step 2: Verify files moved correctly**

```bash
ls packages/documentation/sheets/
# Expected: build-a-budget.md  charts.md  formulas.md  keyboard-shortcuts.md
ls packages/documentation/guide/
# Expected: collaboration.md  getting-started.md
```

- [ ] **Step 3: Commit**

```bash
git add packages/documentation/sheets/ packages/documentation/guide/
git commit -m "Move sheet-specific docs to sheets/ directory"
```

---

### Task 2: Create Docs editor guide — Writing a Document

**Files:**
- Create: `packages/documentation/docs-editor/writing-a-document.md`

- [ ] **Step 1: Create docs-editor directory**

```bash
mkdir -p packages/documentation/docs-editor
```

- [ ] **Step 2: Write the Writing a Document page**

Create `packages/documentation/docs-editor/writing-a-document.md`:

```markdown
# Writing a Document

This guide covers creating and editing documents in Wafflebase — a word-processor-style editor with real-time collaboration.

## Create a Document

1. Open your workspace
2. Click the **New** dropdown button
3. Select **New Document**

A blank document opens with a page-style layout, similar to Google Docs.

## Basic Editing

Click anywhere on the page to place your cursor and start typing. The editor works like a standard word processor:

- **Enter** — Split into a new paragraph
- **Backspace / Delete** — Remove characters
- **Arrow keys** — Move the cursor
- Text wraps automatically at the page edge

### Select Text

- **Click and drag** to select a range of text
- **Double-click** to select a word
- **Triple-click** to select a paragraph
- **⌘+A** / **Ctrl+A** to select all text

### Copy, Cut, and Paste

- **⌘+C** / **Ctrl+C** — Copy selected text
- **⌘+X** / **Ctrl+X** — Cut selected text
- **⌘+V** / **Ctrl+V** — Paste text

When pasting multi-line text, each line becomes a separate paragraph.

## Text Formatting

Use the formatting toolbar at the top or keyboard shortcuts to style your text.

### Inline Styles

| Style | Toolbar | Shortcut |
|-------|---------|----------|
| **Bold** | **B** button | ⌘+B / Ctrl+B |
| *Italic* | *I* button | ⌘+I / Ctrl+I |
| <u>Underline</u> | U button | ⌘+U / Ctrl+U |
| ~~Strikethrough~~ | S button | ⌘+Shift+X / Ctrl+Shift+X |
| Text color | A button | Pick from the color palette |

To clear all formatting from selected text, press **⌘+\\** / **Ctrl+\\**.

### Paragraph Alignment

Use the alignment dropdown in the toolbar to align paragraphs:

- **Left** — Default alignment
- **Center** — Centered text
- **Right** — Right-aligned text

## Page Layout

Documents are displayed with a page-based layout, similar to a printed document. Pages use A4 size by default with standard margins. As you type, text flows naturally across pages.

## Undo and Redo

- **⌘+Z** / **Ctrl+Z** — Undo the last action
- **⌘+Shift+Z** / **Ctrl+Y** — Redo

You can also use the undo/redo buttons in the toolbar.

## What's Next

- [Keyboard Shortcuts](./keyboard-shortcuts) — Full list of document editor shortcuts
- [Collaboration & Sharing](/guide/collaboration) — Share and edit documents together in real time
```

- [ ] **Step 3: Commit**

```bash
git add packages/documentation/docs-editor/writing-a-document.md
git commit -m "Add Writing a Document guide for docs editor"
```

---

### Task 3: Create Docs editor Keyboard Shortcuts page

**Files:**
- Create: `packages/documentation/docs-editor/keyboard-shortcuts.md`

- [ ] **Step 1: Write the Keyboard Shortcuts page**

Create `packages/documentation/docs-editor/keyboard-shortcuts.md`:

```markdown
# Keyboard Shortcuts

Keyboard shortcuts for the document editor. Mac shortcuts are shown with `⌘`, Windows/Linux with `Ctrl`.

## Navigation

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Move cursor | Arrow keys | Arrow keys |
| Move by word | ⌥+← / ⌥+→ | Ctrl+← / Ctrl+→ |
| Move to line start | ⌘+← | Home |
| Move to line end | ⌘+→ | End |
| Move to document start | ⌘+↑ | Ctrl+Home |
| Move to document end | ⌘+↓ | Ctrl+End |

## Selection

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Extend selection | Shift+Arrow | Shift+Arrow |
| Select by word | ⌥+Shift+← / → | Ctrl+Shift+← / → |
| Select to line start | ⌘+Shift+← | Shift+Home |
| Select to line end | ⌘+Shift+→ | Shift+End |
| Select to document start | ⌘+Shift+↑ | Ctrl+Shift+Home |
| Select to document end | ⌘+Shift+↓ | Ctrl+Shift+End |
| Select all | ⌘+A | Ctrl+A |
| Select word | Double-click | Double-click |
| Select paragraph | Triple-click | Triple-click |

## Editing

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| New paragraph | Enter | Enter |
| Delete character before | Backspace | Backspace |
| Delete character after | Delete | Delete |
| Delete word before | ⌥+Backspace | Ctrl+Backspace |
| Delete word after | ⌥+Delete | Ctrl+Delete |
| Delete to line start | ⌘+Backspace | — |
| Undo | ⌘+Z | Ctrl+Z |
| Redo | ⌘+Shift+Z | Ctrl+Y |

## Formatting

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Bold | ⌘+B | Ctrl+B |
| Italic | ⌘+I | Ctrl+I |
| Underline | ⌘+U | Ctrl+U |
| Strikethrough | ⌘+Shift+X | Ctrl+Shift+X |
| Clear formatting | ⌘+\\ | Ctrl+\\ |

## Clipboard

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Copy | ⌘+C | Ctrl+C |
| Cut | ⌘+X | Ctrl+X |
| Paste | ⌘+V | Ctrl+V |
```

- [ ] **Step 2: Commit**

```bash
git add packages/documentation/docs-editor/keyboard-shortcuts.md
git commit -m "Add keyboard shortcuts page for docs editor"
```

---

### Task 4: Update Getting Started page

**Files:**
- Modify: `packages/documentation/guide/getting-started.md`

- [ ] **Step 1: Update Getting Started to cover both sheets and docs**

Replace the current content with a version that explains both document types. Key changes:

- "Create a Document" section → explain the **New** dropdown with "New Sheet" and "New Document" options
- Add brief descriptions of what each type is for
- "Enter Some Data" section stays (sheet-specific tutorial)
- Add a parallel "Start Writing" section for docs
- "What's Next" section → link to both Sheets and Docs guides

The updated file should read:

```markdown
# Getting Started

This guide walks you through creating your first sheet or document in Wafflebase.

## Sign In

Go to [wafflebase.io](https://wafflebase.io) and click **Get Started**. Sign in with your GitHub account.

## Create a Sheet or Document

After signing in, you'll see your workspace. Click the **New** dropdown button to choose what to create:

- **New Sheet** — A spreadsheet for structured data, formulas, and charts
- **New Document** — A word-processor-style editor for writing and formatting text

## Try a Sheet

Select **New Sheet** to create a blank spreadsheet. Let's build a simple contact list. Click on cell **A1** and type the following data, pressing `Tab` to move right and `Enter` to move to the next row:

|   | A | B | C |
|---|---|---|---|
| 1 | **Name** | **Email** | **Role** |
| 2 | Alice | alice@example.com | Engineer |
| 3 | Bob | bob@example.com | Designer |
| 4 | Carol | carol@example.com | Manager |

::: tip
Press `Tab` to move to the next column, `Enter` to move to the next row. Press `Escape` to cancel editing.
:::

Your spreadsheet should look like this:

![Contact list spreadsheet](/images/getting-started-contact-list.png)

### Resize Columns

If the email column looks cramped, hover over the border between column headers **B** and **C**, then drag it to the right to widen column B.

### Add a Tab

Your document starts with one tab called **Sheet1**. Click the **+** button next to the tab bar at the bottom to add a new tab. Double-click the tab name to rename it.

## Try a Document

Select **New Document** to open a blank page. Start typing — the editor works like a word processor. Use the toolbar to apply formatting such as **bold**, *italic*, and text alignment.

For a full walkthrough, see the [Writing a Document](/docs-editor/writing-a-document) guide.

## What's Next

**Sheets:**
- [Build a Budget Spreadsheet](/sheets/build-a-budget) — Learn formulas, formatting, and layout
- [Formulas](/sheets/formulas) — Full list of supported functions
- [Charts & Pivot Tables](/sheets/charts) — Visualize your data
- [Keyboard Shortcuts](/sheets/keyboard-shortcuts) — Speed up your workflow

**Docs:**
- [Writing a Document](/docs-editor/writing-a-document) — Text editing, formatting, and page layout
- [Keyboard Shortcuts](/docs-editor/keyboard-shortcuts) — Document editor shortcuts

**Common:**
- [Collaboration & Sharing](/guide/collaboration) — Share and edit together in real time
```

- [ ] **Step 2: Commit**

```bash
git add packages/documentation/guide/getting-started.md
git commit -m "Update Getting Started to cover both sheets and docs"
```

---

### Task 5: Update Collaboration & Sharing page

**Files:**
- Modify: `packages/documentation/guide/collaboration.md`

- [ ] **Step 1: Generalize collaboration page for both document types**

Key changes:
- Replace "spreadsheet" with "document" where it refers generically to both types
- The access levels table: add a note that edit permissions cover both cell editing (sheets) and text editing (docs)
- "Edit Together" section: mention that in docs, you see a collaborator's text cursor and name label
- "Tips for Team Spreadsheets" → rename to "Tips for Team Collaboration" and add doc-relevant tips

The "How Conflicts Work" section remains the same — both types use Yorkie CRDTs.

Update the file:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/documentation/guide/collaboration.md
git commit -m "Generalize collaboration guide for both sheets and docs"
```

---

### Task 6: Update VitePress sidebar config

**Files:**
- Modify: `packages/documentation/.vitepress/config.ts`

- [ ] **Step 1: Update config.ts with new sidebar structure**

```typescript
import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Wafflebase Docs",
  description:
    "Documentation for Wafflebase — collaborative spreadsheet and document editor",
  base: "/docs/",

  vite: {
    server: {
      open: false,
    },
  },

  themeConfig: {
    siteTitle: "Wafflebase",
    logoLink: { link: "/", target: "_self" },

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Sheets", link: "/sheets/build-a-budget" },
      { text: "Docs", link: "/docs-editor/writing-a-document" },
      { text: "Developers", link: "/developers/self-hosting" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          {
            text: "Collaboration & Sharing",
            link: "/guide/collaboration",
          },
        ],
      },
      {
        text: "Sheets",
        items: [
          { text: "Build a Budget", link: "/sheets/build-a-budget" },
          { text: "Formulas", link: "/sheets/formulas" },
          { text: "Charts & Pivot Tables", link: "/sheets/charts" },
          {
            text: "Keyboard Shortcuts",
            link: "/sheets/keyboard-shortcuts",
          },
        ],
      },
      {
        text: "Docs",
        items: [
          {
            text: "Writing a Document",
            link: "/docs-editor/writing-a-document",
          },
          {
            text: "Keyboard Shortcuts",
            link: "/docs-editor/keyboard-shortcuts",
          },
        ],
      },
      {
        text: "Developers",
        items: [
          { text: "Self-Hosting", link: "/developers/self-hosting" },
          { text: "REST API", link: "/developers/rest-api" },
          { text: "CLI", link: "/developers/cli" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/wafflebase/wafflebase" },
    ],

    search: {
      provider: "local",
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/documentation/.vitepress/config.ts
git commit -m "Restructure sidebar into Guide, Sheets, Docs, Developers sections"
```

---

### Task 7: Update README.md table of contents

**Files:**
- Modify: `packages/documentation/README.md`

- [ ] **Step 1: Update README.md to reflect new directory structure**

Replace the "Content" section with the new structure:

```markdown
## Content

### Guide (Common)

| Page | Description |
|------|-------------|
| [Getting Started](guide/getting-started.md) | Sign in, create sheets or documents, first steps |
| [Collaboration](guide/collaboration.md) | Share documents, real-time editing, permissions |

### Sheets

| Page | Description |
|------|-------------|
| [Build a Budget](sheets/build-a-budget.md) | Learn formulas, formatting, and layout |
| [Formulas](sheets/formulas.md) | Formula syntax, function reference, examples |
| [Charts](sheets/charts.md) | Chart types, creation, editing, pivot tables |
| [Keyboard Shortcuts](sheets/keyboard-shortcuts.md) | Spreadsheet shortcut reference |

### Docs

| Page | Description |
|------|-------------|
| [Writing a Document](docs-editor/writing-a-document.md) | Text editing, formatting, page layout |
| [Keyboard Shortcuts](docs-editor/keyboard-shortcuts.md) | Document editor shortcut reference |

### Developers

| Page | Description |
|------|-------------|
| [Self-Hosting](developers/self-hosting.md) | Docker Compose setup, environment variables, GitHub OAuth, architecture |
| [REST API](developers/rest-api.md) | API endpoints for documents, tabs, cells, authentication |
| [CLI](developers/cli.md) | CLI tool installation, authentication, usage examples |
```

Also update the "Navigation" line in the Configuration section:
- From: `Dual sidebar — Guide and Developers sections`
- To: `Four sidebar sections — Guide, Sheets, Docs, and Developers`

- [ ] **Step 2: Commit**

```bash
git add packages/documentation/README.md
git commit -m "Update documentation README for new section structure"
```

---

### Task 8: Update REST API docs

**Files:**
- Modify: `packages/documentation/developers/rest-api.md`

- [ ] **Step 1: Update introductory text**

Change the first line from:
```
The Wafflebase REST API lets you read and write spreadsheet data programmatically.
```
To:
```
The Wafflebase REST API lets you read and write spreadsheet and document data programmatically.
```

- [ ] **Step 2: Add type parameter to Create Document section**

After the existing "Create Document" section's curl example, add a note about the `type` parameter. The updated section should read:

```markdown
### Create Document

\`\`\`bash
POST /api/v1/workspaces/:wid/documents
\`\`\`

\`\`\`bash
# Create a sheet (default)
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Q1 Report"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents

# Create a document
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Meeting Notes", "type": "doc"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents
\`\`\`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Document title |
| `type` | string | No | `"sheet"` (default) or `"doc"` |
```

- [ ] **Step 2: Add type field note to List Documents section**

Add a note after the List Documents curl example:

```markdown
Each document in the response includes a `type` field (`"sheet"` or `"doc"`).
```

- [ ] **Step 4: Add a note about Tabs and Cells applying to sheets only**

Before the "## Tabs" heading, add:

```markdown
::: info
The Tabs and Cells endpoints below apply to **sheet** documents only. Document (`"doc"`) content is not currently available through the REST API.
:::
```

- [ ] **Step 5: Commit**

```bash
git add packages/documentation/developers/rest-api.md
git commit -m "Add document type parameter to REST API docs"
```

---

### Task 9: Update CLI docs

**Files:**
- Modify: `packages/documentation/developers/cli.md:111-130`

- [ ] **Step 1: Add --type flag to document create command**

Update the `### document (alias: doc)` section:

```markdown
### document (alias: doc)

Manage documents.

\`\`\`bash
# List all documents
wafflebase document list

# Create a new sheet (default)
wafflebase document create "Q1 Report"

# Create a new document
wafflebase document create "Meeting Notes" --type doc

# Get document metadata
wafflebase document get <doc-id>

# Rename a document
wafflebase document rename <doc-id> "New Title"

# Delete a document
wafflebase document delete <doc-id>
\`\`\`

| Option | Description | Default |
|--------|-------------|---------|
| `--type <type>` | Document type: `sheet` or `doc` | `sheet` |
```

- [ ] **Step 2: Add a note before tab/cell sections**

Before the `### tab` heading, add:

```markdown
::: info
The `tab` and `cell` commands below apply to sheet documents only.
:::
```

- [ ] **Step 3: Commit**

```bash
git add packages/documentation/developers/cli.md
git commit -m "Add --type flag to CLI docs for document creation"
```

---

### Task 10: Update cross-references in moved Sheets pages

**Files:**
- Modify: `packages/documentation/sheets/build-a-budget.md`
- Modify: `packages/documentation/sheets/formulas.md`

- [ ] **Step 1: Fix links in build-a-budget.md**

Update the "What's Next" links at the bottom — they currently use `./formulas` and `./collaboration` which need to be updated:

```markdown
## What's Next

- [Formulas Reference](./formulas) — Full list of supported functions
- [Collaboration & Sharing](/guide/collaboration) — Share this budget with others
```

The `./formulas` link still works (same directory). The `./collaboration` link needs to change to `/guide/collaboration`.

- [ ] **Step 2: Verify formulas.md links**

Check `formulas.md` — its link to `./build-a-budget` still works since both files are in the same `sheets/` directory. No change needed.

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add packages/documentation/sheets/
git commit -m "Fix cross-reference links in moved sheets pages"
```

---

### Task 11: Verify the documentation site builds and renders

- [ ] **Step 1: Run VitePress build**

```bash
cd packages/documentation && npx vitepress build
```

Expected: Build completes without errors.

- [ ] **Step 2: Run VitePress dev server and verify**

```bash
cd packages/documentation && npx vitepress dev --port 5174
```

Manually check:
- Sidebar shows Guide, Sheets, Docs, Developers sections
- All links resolve (no 404s)
- Getting Started shows sheet/doc creation flow
- Docs section pages render correctly
- Collaboration page covers both types

- [ ] **Step 3: Run verify:fast from repo root**

```bash
pnpm verify:fast
```

Expected: All lint and unit tests pass.

- [ ] **Step 4: Final commit if any fixes needed, then squash or leave as-is**
