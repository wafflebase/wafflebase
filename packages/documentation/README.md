# @wafflebase/documentation

VitePress-based documentation site for Wafflebase. Serves user guides and developer documentation at the `/docs/` subpath. The site root is [`index.md`](index.md), which redirects to the Getting Started guide.

## Content

The tables below mirror the sidebar in [`.vitepress/config.ts`](.vitepress/config.ts) — same sections, same order. A page added to one belongs in the other.

### Guide

| Page | Description |
|------|-------------|
| [Getting Started](guide/getting-started.md) | Sign in, create sheets, docs, slides, or notes, first steps |
| [Workspaces & Members](guide/workspaces.md) | Workspaces as the container for documents, folders, datasources, and API keys; members and roles |
| [Collaboration & Sharing](guide/collaboration.md) | Share documents, real-time editing, comments, permissions |
| [Version History](guide/version-history.md) | Browse and restore earlier versions of a sheet, doc, deck, note, or board |
| [Templates](guide/templates.md) | Publish a document as a template, and start a new one from it |
| [Import & Export](guide/import-export.md) | XLSX/DOCX/PPTX import, PDF upload, DOCX/PPTX/PDF export, CLI automation |

### Sheets

| Page | Description |
|------|-------------|
| [Build a Budget](sheets/build-a-budget.md) | Learn formulas, formatting, and layout |
| [Formulas](sheets/formulas.md) | Formula syntax, function reference, examples |
| [Charts & Pivot Tables](sheets/charts.md) | Chart types, creation, editing, pivot tables |
| [Data Validation](sheets/data-validation.md) | Checkboxes, dropdowns, date/number/text rules |
| [Conditional Formatting](sheets/conditional-formatting.md) | Rules that paint cells based on what they contain |
| [External Datasources](sheets/datasources.md) | Connect PostgreSQL, run SQL, read-only result tabs |
| [Lakehouse Tables](sheets/lakehouse.md) | Read Apache Iceberg / Delta Lake tables from object storage into a read-only grid |
| [Keyboard Shortcuts](sheets/keyboard-shortcuts.md) | Spreadsheet shortcut reference |

### Docs

| Page | Description |
|------|-------------|
| [Writing a Document](docs-editor/writing-a-document.md) | Text editing, formatting, page layout |
| [Keyboard Shortcuts](docs-editor/keyboard-shortcuts.md) | Document editor shortcut reference |

### Slides

| Page | Description |
|------|-------------|
| [Build a Deck](slides/build-a-deck.md) | Slides, elements, themes, presenting |
| [Themes & Layouts](slides/themes-and-layouts.md) | Theme system and slide layouts |
| [Keyboard Shortcuts](slides/keyboard-shortcuts.md) | Presentation editor shortcut reference |

### Notes & Board

| Page | Description |
|------|-------------|
| [Writing a Note](notes/writing-a-note.md) | Markdown source editor, live preview, view modes, Vim |
| [Using the Board](board/using-the-board.md) | Infinite freeform canvas — sticky notes, shapes, connectors, real-time collaboration |

### PDF & Files

| Page | Description |
|------|-------------|
| [Viewing PDFs](pdf/viewing-pdfs.md) | Upload, read, page-anchored comments, presence |
| [Viewing Images](pdf/viewing-images.md) | Upload and view image files as view-only documents |
| [Organizing with Folders](pdf/organizing-with-folders.md) | Group a workspace's documents into a folder tree |

### Developers

| Page | Description |
|------|-------------|
| [Self-Hosting](developers/self-hosting.md) | Docker Compose setup, environment variables, GitHub OAuth, architecture |
| [Design Editor](developers/design-editor.md) | Change how Wafflebase looks by clicking on it, and open a pull request — written for someone who does not write code. The two commands, what each pane does, and what happens for each of the three ways a person's machine can be set up |
| [REST API](developers/rest-api.md) | API endpoints for documents, tabs, cells, authentication |
| [CLI](developers/cli.md) | CLI tool installation, authentication, usage examples |

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
- **Navigation**: Seven sidebar sections — Guide, Sheets, Docs, Slides, Notes & Board, PDF & Files, and Developers. The top nav carries one entry per section, so every section is one click from anywhere
- **`srcExclude`**: keeps this README out of the built site — it has no sidebar entry, so it would otherwise publish as an orphan page at `/docs/README.html` and enter the local search index
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
