---
title: docs-site
target-version: 0.1.0
---

# VitePress Documentation Site

## Summary

A VitePress-based documentation site at `packages/documentation` provides
user guides for each shipped module (Sheets, Docs, Slides, Notes, Board,
and PDF/Image files) and developer references (self-hosting, REST API,
CLI). Served at `wafflebase.io/docs` as a subpath of the existing GitHub
Pages deployment.

## Goals

- Provide markdown-based documentation for end users and developers
- Deploy under `/docs` subpath alongside the existing frontend
- Integrate into the monorepo build pipeline
- Update homepage navigation to link to the docs site

## Non-Goals

- Replacing internal design docs (`docs/design/`) with VitePress
- i18n support (can be added later)
- Full-text search (VitePress built-in local search is sufficient for now)

## Proposal Details

### Package Structure

```
packages/documentation/
├── package.json              # @wafflebase/documentation
├── STYLE.md                  # Writing rules: page types, titles, steps, screenshots (not built)
├── .vitepress/
│   ├── config.ts             # base: '/docs/', nav, two sidebars ('/' and '/developers/')
│   └── theme/
│       └── style.css         # Brand overrides
├── index.md                  # Landing page: goal cards, per-editor row
├── start/                    # Getting started, concepts, phone, troubleshooting
├── collaborate/              # Workspaces, sharing, comments, history, templates, folders, trash
├── files/                    # Upload, PDFs, images, import and export
├── sheets/ docs-editor/ slides/ notes/ board/
│   ├── index.md              # Section overview: quick start + task map
│   ├── <tutorial>.md         # build-a-budget, write-a-proposal, build-a-deck, run-a-retro
│   ├── <task>.md             # One how-to per task family
│   └── keyboard-shortcuts.md # Reference
├── developers/
│   ├── index.md, claude-code-plugin.md
│   ├── cli/                  # Install and sign in + one reference page per area
│   ├── api/                  # Overview, quickstart, one page per resource family
│   └── self-hosting/         # Overview, local dev, configuration, sign-in, deploy, optional features, troubleshooting
├── guide/ pdf/ …             # Moved-page stubs: `search: false` + meta refresh to the new URL
└── public/images/<section>/  # Screenshots (desktop 1440×900, phone 393×659)
```

### VitePress Configuration

- `base: '/docs/'` so all asset/link paths are prefixed correctly
- Top nav order: **Getting started / Sheets / Docs / Slides / Notes / Board /
  Developers** — mirrors the homepage's product progression
- Two sidebars. Every user page shares one (Get started, Collaborate &
  organize, Sheets, Docs, Slides, Notes, Board, Files; editor sections open
  collapsed); `/developers/` gets its own (Developers, CLI, REST API,
  Self-hosting) so the user-facing tree stays short
- Sidebar labels match page H1s (a section's `index.md` is "Overview"); page
  types and titling follow `STYLE.md`, which follows the
  [Diátaxis](https://diataxis.fr/) split of tutorial / how-to / reference /
  explanation
- Moved pages are never deleted: they stay as `search: false` stubs that
  meta-refresh to the new URL, so links from the homepage, old releases and
  search engines keep landing (anchors into a moved page are not preserved)
- Brand colors via CSS variable overrides to match homepage amber/gold theme
- Built-in local search enabled

### Build & Deployment

**Local development:**
- `pnpm documentation dev` runs VitePress dev server independently

**CI build:**
1. `pnpm frontend build` → `packages/frontend/dist/`
2. `pnpm documentation build` → `packages/documentation/.vitepress/dist/`
3. Copy docs build output into `packages/frontend/dist/docs/`

**Root package.json scripts:**
```json
"documentation": "pnpm --filter @wafflebase/documentation",
"build:all": "pnpm frontend build && pnpm documentation build && cp -r packages/documentation/.vitepress/dist packages/frontend/dist/docs"
```

**GitHub Actions (`.github/workflows/publish-ghpage.yml`):**
- Update build step to use `build:all` instead of `pnpm frontend build`

### Homepage Changes

**nav-bar.tsx:**
- Change "Developers" anchor link (`#developers`) → "Docs" link (`/docs`)

**developer-section.tsx:**
- Keep existing REST API / CLI code examples
- Add links below each code block pointing to full documentation:
  - REST API block → `/docs/developers/rest-api`
  - CLI block → `/docs/developers/cli`

### Content Outline

**Guide section:**
- Getting Started: what Wafflebase is, how to create a document, basic
  navigation
- Collaboration & Sharing: sharing documents, real-time co-editing,
  presence indicators
- Import & Export: importing/exporting documents across formats

**Sheets section:**
- Build a Budget: hands-on tutorial
- Formulas: supported functions, syntax, cell references, examples
- Charts & Pivot Tables: data visualization and aggregation
- Data Validation: in-cell controls and validation rules
- External Datasources: connecting external databases
- Keyboard Shortcuts: full reference

**Docs section:**
- Writing a Document: editor tour, formatting, pagination
- Keyboard Shortcuts: full reference

**Slides section:**
- Build a Deck: hands-on tutorial (counterpart to Build a Budget)
- Themes & Layouts: 4-tier theme model, 11 Google-Slides-parity layouts,
  placeholders
- Keyboard Shortcuts: full reference

**Notes & Board section:**
- Writing a Note: markdown note editor tour
- Using the Board: infinite-canvas board tutorial

**PDF & Files section:**
- Viewing PDFs: the PDF viewer
- Viewing Images: the image viewer
- Organizing with Folders: workspace folder organization

**Developers section:**
- Self-Hosting: deploying Wafflebase on your own infrastructure
- REST API: API key authentication, endpoints for documents/tabs/cells
- CLI: installation, configuration, command reference

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| VitePress version conflicts with existing Vite | VitePress uses its own bundled Vite; isolated in separate package |
| `/docs` path conflicts with frontend routing | Frontend uses hash/client-side routing; `/docs` serves static files |
| Build output copy step is fragile | Simple `cp -r` command; can upgrade to proper build tool later |
