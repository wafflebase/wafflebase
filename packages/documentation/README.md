# @wafflebase/documentation

VitePress-based documentation site for Wafflebase. Serves user guides and developer documentation at the `/docs/` subpath.

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
- **Navigation**: Four sidebar sections — Guide, Sheets, Docs, and Developers
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
