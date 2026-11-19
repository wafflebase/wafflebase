# @wafflebase/documentation

VitePress-based documentation site for Wafflebase. Serves user guides and developer documentation at the `/docs/` subpath. The site root is [`index.md`](index.md), the landing page.

## Content

The tables below mirror the sidebar in [`.vitepress/config.ts`](.vitepress/config.ts) — same sections, same order. A page added to one belongs in the other. Writing rules live in [`STYLE.md`](STYLE.md).

Moved pages stay behind as `search: false` stubs that meta-refresh to their new URL (for example `guide/collaboration.md` → `/collaborate/share`), so old links keep working. Do not add content to them.

### Get started

| Page | Description |
|------|-------------|
| [Getting started](start/getting-started.md) | Sign in, build a small contact list in a sheet, share it with a link, and watch a second person edit it live. |
| [Concepts](start/concepts.md) | How workspaces, documents, folders, share links, templates, and the Trash fit together, and who can see and change what. |
| [Use Wafflebase on a phone](start/phone.md) | What you can do in each editor on a phone, where the header and toolbar controls move, and which touch gestures apply. |
| [Troubleshooting](start/troubleshooting.md) | Fix common problems with signing in, saving, share links, uploads, templates, and version history, by the message you see. |

### Collaborate & organize

| Page | Description |
|------|-------------|
| [Manage workspaces and members](collaborate/workspaces.md) | Create and switch workspaces, invite and remove members, and see what owners and members can do. |
| [Share a document](collaborate/share.md) | Create a share link so people outside your workspace can view or edit a document, and copy or revoke links later. |
| [Edit together](collaborate/edit-together.md) | See who else is in a document, jump to where they are working, and check that your edits are saved. |
| [Comment and mention people](collaborate/comments.md) | Comment on cells, text, board items, and PDFs, mention teammates with @, and follow up from the notifications bell. |
| [Use version history](collaborate/version-history.md) | Look back at earlier versions of a document, name the current one, and restore an older version. |
| [Use and publish templates](collaborate/templates.md) | Start a new document from a template, publish your own document as a template, and submit it to the public gallery. |
| [Organize documents in folders](collaborate/folders.md) | Organize a workspace's documents into folders, find documents in the list, and move, rename, copy, or delete them. |
| [Delete and restore documents](collaborate/trash.md) | Move documents to the Trash, restore them, and delete them forever. |

### Sheets

| Page | Description |
|------|-------------|
| [Overview](sheets/index.md) | Sheets is a spreadsheet for formulas, charts, and live data that your team edits together. |
| [Build a budget](sheets/build-a-budget.md) | Build a monthly budget that totals your spending, flags overspending, and formats the amounts as currency. |
| [Edit and format cells](sheets/edit-and-format.md) | Enter, fill, move, and find data in a sheet, and format cells with number formats, colors, borders, and alignment. |
| [Work with rows, columns, and tabs](sheets/rows-columns-tabs.md) | Insert, delete, hide, freeze, move, and resize rows and columns, and add, rename, duplicate, reorder, or delete tabs. |
| [Sort and filter](sheets/sort-and-filter.md) | Turn a table into a filtered range, then sort it by a column or show only the rows that match values or a condition. |
| [Write formulas](sheets/formulas.md) | Type = in a cell to calculate a value from numbers, other cells, and functions. |
| [Function reference](sheets/functions.md) | Every function you can use in a Sheets formula, grouped by category, with its syntax and a short description. |
| [Add a chart](sheets/charts.md) | Turn a range of cells into a bar, line, area, pie, or scatter chart, and place images on a sheet. |
| [Summarize data with a pivot table](sheets/pivot-tables.md) | Group and total a range of data on its own tab with a pivot table. |
| [Add checkboxes, dropdowns, and validation](sheets/data-validation.md) | Add checkboxes, dropdown lists, and date pickers to cells, and flag or block values that break a rule. |
| [Highlight cells with conditional formatting](sheets/conditional-formatting.md) | Color, bold, or underline cells automatically when their values match a rule. |
| [Connect a database](sheets/connect-a-database.md) | Run a SQL query against a PostgreSQL database and see the results in a read-only tab of your sheet. |
| [Read lakehouse tables](sheets/lakehouse.md) | Read an Apache Iceberg or Delta Lake table from object storage into a read-only tab, and look at earlier versions with time travel. |
| [Keyboard shortcuts](sheets/keyboard-shortcuts.md) | Keyboard shortcuts for moving, selecting, editing, and formatting in a sheet. |

### Docs

| Page | Description |
|------|-------------|
| [Overview](docs-editor/index.md) | Docs is a page-based word processor where you write, format, and lay out documents with your team. |
| [Write a project proposal](docs-editor/write-a-proposal.md) | Build a one-page project proposal with a title, headings, a list, a budget table, an image, a link, and page numbers. |
| [Format text](docs-editor/format-text.md) | Style text in a doc with bold, fonts, colors, headings, alignment, line spacing, and links. |
| [Use lists and indents](docs-editor/lists-and-indents.md) | Make bulleted and numbered lists in a doc, nest list items, and set paragraph indents with the toolbar or the ruler. |
| [Insert and edit tables](docs-editor/tables.md) | Insert a table in a doc, add and delete rows and columns, merge cells, color cell backgrounds, and resize columns. |
| [Add and edit images](docs-editor/images.md) | Upload, paste, drag, or link an image into a doc, then resize, copy, or delete it. |
| [Set up pages, headers, and footers](docs-editor/page-layout.md) | Set a doc's paper size, orientation, and margins, insert page breaks and horizontal lines, and add headers, footers, and page numbers. |
| [Find text and check spelling](docs-editor/find-and-spelling.md) | Find and replace text in a doc and fix misspelled words from the right-click menu. |
| [Paste from other apps](docs-editor/paste-from-other-apps.md) | Paste text, tables, and images into a doc from web pages, spreadsheets, Markdown, and other documents, with or without formatting. |
| [Keyboard shortcuts](docs-editor/keyboard-shortcuts.md) | Every keyboard shortcut in the Docs editor, for Mac and for Windows and Linux. |

### Slides

| Page | Description |
|------|-------------|
| [Overview](slides/index.md) | Slides is the Wafflebase presentation editor, where you build a deck with your team and present it full screen. |
| [Build a deck](slides/build-a-deck.md) | Build a three-slide project update deck with a theme, a content slide, a shape, and a transition, then present it. |
| [Add content](slides/add-content.md) | Add and manage slides, then fill them with text, images, shapes, tables, and connector lines. |
| [Style and arrange objects](slides/style-and-arrange.md) | Change how shapes, images, and text boxes look, and place, align, group, and order them on a slide. |
| [Change themes and layouts](slides/themes-and-layouts.md) | Apply and customize a deck theme, edit layout placeholders, and set slide backgrounds. |
| [Add animations and transitions](slides/animations.md) | Add slide transitions and object animations to a deck, set their timing, and preview them in the editor. |
| [Present a deck](slides/present.md) | Write speaker notes, present a deck full screen, and download it as PowerPoint or PDF. |
| [Keyboard shortcuts](slides/keyboard-shortcuts.md) | Keyboard shortcuts and drag modifiers for the Slides editor and slideshow. |

### Notes

| Page | Description |
|------|-------------|
| [Overview](notes/index.md) | A note is a Markdown document you write with a live preview, together with your team in real time. |
| [Write and format a note](notes/write-and-format.md) | Write a note in Markdown, format it from the toolbar, and set up the editor the way you like. |
| [Markdown reference](notes/markdown-reference.md) | The Markdown syntax a note's preview renders, including math, diagrams, and the HTML tags it allows. |
| [Keyboard shortcuts](notes/keyboard-shortcuts.md) | Every keyboard shortcut in the note editor, for formatting, editing, finding text, and folding. |

### Board

| Page | Description |
|------|-------------|
| [Overview](board/index.md) | A board is an infinite canvas where you arrange sticky notes, shapes, drawings, and images with your team. |
| [Run a retro on a board](board/run-a-retro.md) | Run a Start, Stop, Continue retrospective on a board, from the template to a voted list of action items and a PDF. |
| [Add stickies, shapes, and connectors](board/stickies-shapes-connectors.md) | Add sticky notes, shapes, text boxes, images, and connectors to a board, then style and arrange them. |
| [Draw on a board](board/draw.md) | Sketch on a board with the marker and highlighter, erase strokes, select with a lasso, and point with the laser. |
| [Group ideas with sections](board/sections.md) | Group sticky notes and other items on a board into titled sections that move together, and hide or lock a section. |
| [Facilitate a session](board/facilitate-a-session.md) | Run a live session on a board with a shared timer, dot voting, stamps, follow and spotlight, cursor chat, emotes, and comments. |
| [Export and import a board](board/export-and-import.md) | Download a board or a selection as a PNG or PDF, and import an existing Miro board as a new board. |
| [Keyboard shortcuts](board/keyboard-shortcuts.md) | Every keyboard shortcut on a board, for tools, sticky notes, navigation, selection, editing, and collaboration. |

### Files

| Page | Description |
|------|-------------|
| [Upload files](files/upload.md) | Upload any file to a workspace and see what each file type becomes. |
| [Read and comment on PDFs](files/pdfs.md) | Read a PDF in the browser, copy its text, comment on text or a region of a page, and download the original. |
| [View images](files/images.md) | View an uploaded image, zoom in and out, page through the images in a folder, and download the original. |
| [Import and export files](files/import-export.md) | Which file formats each Wafflebase editor imports and exports, what each conversion keeps, and the size limits. |

### Developers

| Page | Description |
|------|-------------|
| [Overview](developers/index.md) | Script Wafflebase from the terminal, call it over HTTP, let Claude Code work in your workspace, or run your own server. |
| [Claude Code plugin](developers/claude-code-plugin.md) | Install the Wafflebase plugin for Claude Code so Claude can find, read, and edit your documents, with your confirmation before every change. |

### CLI

| Page | Description |
|------|-------------|
| [Install and sign in](developers/cli/index.md) | Install the wafflebase command-line tool, sign in to your workspace, and set the options every command shares. |
| [Documents and notes](developers/cli/documents.md) | Command reference for managing documents, docs, notes, folders, comments, and templates with the wafflebase CLI. |
| [Sheets](developers/cli/sheets.md) | Command reference for reading and writing sheet tabs, cells, rows and columns, formatting, charts, and images with the wafflebase CLI. |
| [Slides and boards](developers/cli/slides-and-board.md) | Command reference for decks, individual slides, PowerPoint import and export, deck checks, and board elements with the wafflebase CLI. |
| [Files and images](developers/cli/files-and-images.md) | Command reference for storing any file as a document and managing the workspace images that documents embed, with the wafflebase CLI. |
| [Automation and agents](developers/cli/automation.md) | Run the wafflebase CLI from scripts, CI jobs, and AI agents with API keys, dry runs, machine-readable output, and error codes. |

### REST API

| Page | Description |
|------|-------------|
| [Overview](developers/api/index.md) | The Wafflebase REST API reads and writes the documents in a workspace over HTTP, with an API key or a signed-in session. |
| [Make your first API call](developers/api/quickstart.md) | Create an API key, list your documents, and write cells into a new sheet with curl. |
| [Documents and folders](developers/api/documents-and-folders.md) | Endpoints to list, create, rename, copy, file, trash, and restore documents, manage folders, and upload files and images. |
| [Sheets](developers/api/sheets.md) | Endpoints to manage a sheet's tabs, read and write cells, edit rows and columns, and set worksheet formatting, rules, charts, images, filters, and pivots. |
| [Document content](developers/api/content.md) | Endpoints to read and replace the content of docs, decks, notes, and boards, edit a deck's slides, and work with comment threads. |
| [Boards](developers/api/board.md) | Endpoints to read a board's elements, add sticky notes, sections, and text, and move or resize elements without replacing the board. |

### Self-hosting

| Page | Description |
|------|-------------|
| [Overview](developers/self-hosting/index.md) | Run Wafflebase on your own infrastructure so your documents, accounts, and files stay on servers you control. |
| [Local development](developers/self-hosting/local-development.md) | Start the full Wafflebase stack on localhost with Docker Compose and the dev servers. |
| [Configuration](developers/self-hosting/configuration.md) | Every backend environment variable and frontend build-time variable a Wafflebase deployment reads. |
| [Sign-in providers](developers/self-hosting/sign-in.md) | Configure GitHub, GitHub Enterprise, and Google sign-in for a self-hosted Wafflebase, and make cookies and CLI sign-in work over HTTPS. |
| [Deploy to production](developers/self-hosting/deploy.md) | Build the backend image and the frontend with your own URLs, run migrations, connect storage, and turn on access control. |
| [Optional features](developers/self-hosting/optional-features.md) | Turn on share-link analytics, database and lakehouse connections, error tracking, and the public template gallery on a self-hosted Wafflebase. |
| [Troubleshooting](developers/self-hosting/troubleshooting.md) | Fix common startup, sign-in, sync, upload, and feature errors on a self-hosted Wafflebase. |

## Development

```bash
pnpm install                                      # Install dependencies (from monorepo root)
pnpm --filter @wafflebase/documentation dev       # Dev server at localhost:5174
pnpm --filter @wafflebase/documentation build     # Static site build
pnpm --filter @wafflebase/documentation preview   # Preview built site
```

## Configuration

Site configuration is in `.vitepress/config.ts`:

- **Base path**: `/docs/` (deployed as subpath of the main site)
- **Search**: Local search provider (no external service)
- **Navigation**: Two sidebars. `/developers/` gets its own (Developers, CLI, REST API, Self-hosting) so the user-facing tree stays short; every other page shares one with Get started, Collaborate & organize, Sheets, Docs, Slides, Notes, Board, and Files. Editor sections open collapsed. The top nav carries one entry per product plus Get started and Developers
- **`srcExclude`**: keeps this README and `STYLE.md` out of the built site — neither has a sidebar entry, so each would otherwise publish as an orphan page (`/docs/README.html`) and enter the local search index
- **Theme**: Default VitePress theme with custom CSS overrides

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | VitePress 1.6.4 |
| Styling | Default theme + custom CSS |
| Search | Built-in local search |
| Assets | Static images in `public/images/` |

## Further Reading

- [docs-site.md](https://github.com/wafflebase/wafflebase/blob/main/docs/design/docs-site.md) — Design document for the documentation site setup and deployment
