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
Pages deployment. Pages are organized by task and Diátaxis page type, and
`packages/documentation/STYLE.md` holds the writing rules.

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

**developer-section.tsx, features-section.tsx, use-cases-section.tsx,
footer.tsx:** link each card to the page that covers it — for example the
REST API block → `/docs/developers/api/`, the CLI block →
`/docs/developers/cli/`, collaboration → `/docs/collaborate/edit-together`,
datasources → `/docs/sheets/connect-a-database`. Link to a page, never to
an old URL that only survives as a redirect stub.

### Content Outline

The sidebar in `.vitepress/config.ts` is the outline, and the package
README mirrors it page by page. Its shape:

- **Get started**: getting started, concepts, phone, troubleshooting
  (symptom-titled entries other pages deep-link to).
- **Collaborate & organize**: workspaces, sharing, editing together,
  comments, version history, templates, folders, trash.
- **Sheets / Docs / Slides / Notes / Board**: overview (quick start + task
  map), one tutorial, one how-to per task family, keyboard shortcuts.
- **Files**: upload, PDFs, images, import and export.
- **Developers** (own sidebar): overview, Claude Code plugin, CLI (install
  and sign in + per-area reference), REST API (overview, quickstart,
  per-resource reference), self-hosting (local development, configuration,
  sign-in, deploy, optional features, troubleshooting).

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| VitePress version conflicts with existing Vite | VitePress uses its own bundled Vite; isolated in separate package |
| `/docs` path conflicts with frontend routing | Frontend uses hash/client-side routing; `/docs` serves static files |
| Build output copy step is fragile | Simple `cp -r` command; can upgrade to proper build tool later |
