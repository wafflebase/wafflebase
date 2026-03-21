---
title: docs-site
target-version: 0.1.0
---

# VitePress Documentation Site

## Summary

Add a VitePress-based documentation site as `packages/documentation` to provide user guides
(spreadsheet editing, formulas, collaboration) and developer references (REST API, CLI).
Served at `wafflebase.io/docs` as a subpath of the existing GitHub Pages deployment.

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
├── .vitepress/
│   ├── config.ts             # base: '/docs/', sidebar, nav
│   └── theme/
│       └── style.css         # Brand color overrides (amber/gold)
├── index.md                  # Docs home (VitePress home layout)
├── guide/
│   ├── getting-started.md    # Getting started
│   ├── editing-cells.md      # Cell editing
│   ├── formulas.md           # Formula usage
│   └── collaboration.md      # Real-time collaboration
└── api/
    ├── rest-api.md           # REST API reference
    └── cli.md                # CLI reference
```

### VitePress Configuration

- `base: '/docs/'` so all asset/link paths are prefixed correctly
- Sidebar with two sections: Guide and API Reference
- Top nav linking back to main site (`wafflebase.io`)
- Brand colors via CSS variable overrides to match homepage amber/gold theme
- Built-in local search enabled

### Build & Deployment

**Local development:**
- `pnpm docs dev` runs VitePress dev server independently

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
  - REST API block → `/docs/api/rest-api`
  - CLI block → `/docs/api/cli`

### Content Outline

**Guide section:**
- Getting Started: what Wafflebase is, how to create a document, basic navigation
- Editing Cells: selecting, typing, copy/paste, undo/redo, cell types
- Formulas: supported functions, formula syntax, cell references, examples
- Collaboration: sharing documents, real-time co-editing, presence indicators

**API section:**
- REST API: authentication (API keys), endpoints for documents/tabs/cells, examples
- CLI: installation, configuration, available commands, usage examples

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| VitePress version conflicts with existing Vite | VitePress uses its own bundled Vite; isolated in separate package |
| `/docs` path conflicts with frontend routing | Frontend uses hash/client-side routing; `/docs` serves static files |
| Build output copy step is fragile | Simple `cp -r` command; can upgrade to proper build tool later |
