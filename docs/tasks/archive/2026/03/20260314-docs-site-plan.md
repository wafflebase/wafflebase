# VitePress Documentation Site — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VitePress documentation site at `wafflebase.io/docs` with user guides and API reference.

**Architecture:** VitePress as `packages/docs` in the monorepo. Builds to static HTML, copied into `packages/frontend/dist/docs/` during CI. Homepage nav updated to link to `/docs`.

**Tech Stack:** VitePress 2.x, Markdown, CSS custom properties

**Spec:** `docs/specs/2026-03-14-docs-site-design.md`

---

## Task 1: Create VitePress package

**Files:**
- Create: `packages/docs/package.json`
- Create: `packages/docs/.vitepress/config.ts`
- Create: `packages/docs/.vitepress/theme/style.css`
- Create: `packages/docs/index.md`

- [ ] **Step 1: Create `packages/docs/package.json`**

```json
{
  "name": "@wafflebase/docs",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vitepress dev",
    "build": "vitepress build",
    "preview": "vitepress preview"
  },
  "devDependencies": {
    "vitepress": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `.vitepress/config.ts`**

```ts
import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Wafflebase Docs",
  description: "Documentation for Wafflebase — collaborative spreadsheet",
  base: "/docs/",

  themeConfig: {
    logo: { light: "/logo-light.svg", dark: "/logo-dark.svg" },
    siteTitle: "Wafflebase",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API Reference", link: "/api/rest-api" },
      { text: "Home", link: "https://wafflebase.io" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Editing Cells", link: "/guide/editing-cells" },
          { text: "Formulas", link: "/guide/formulas" },
          { text: "Collaboration", link: "/guide/collaboration" },
        ],
      },
      {
        text: "API Reference",
        items: [
          { text: "REST API", link: "/api/rest-api" },
          { text: "CLI", link: "/api/cli" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/niceplugin/wafflebase" },
    ],

    search: {
      provider: "local",
    },
  },
});
```

- [ ] **Step 3: Create `.vitepress/theme/style.css`**

Override VitePress brand colors to match Wafflebase amber/gold theme:

```css
:root {
  --vp-c-brand-1: #d97706;
  --vp-c-brand-2: #b45309;
  --vp-c-brand-3: #92400e;
  --vp-c-brand-soft: rgba(217, 119, 6, 0.14);
}

.dark {
  --vp-c-brand-1: #f59e0b;
  --vp-c-brand-2: #d97706;
  --vp-c-brand-3: #b45309;
  --vp-c-brand-soft: rgba(245, 158, 11, 0.16);
}
```

- [ ] **Step 4: Create `index.md` (docs home page)**

```markdown
---
layout: home

hero:
  name: Wafflebase
  text: Documentation
  tagline: Learn how to use Wafflebase — the collaborative spreadsheet
  actions:
    - theme: brand
      text: Getting Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/rest-api

features:
  - title: Spreadsheet Editing
    details: Create, edit, and format cells with familiar spreadsheet controls
  - title: Formulas
    details: Use built-in functions like SUM, VLOOKUP, and IF for calculations
  - title: Real-time Collaboration
    details: Work together with your team in real-time with presence indicators
---
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`

- [ ] **Step 6: Verify dev server starts**

Run: `pnpm docs dev`
Expected: VitePress dev server launches, home page renders at localhost

- [ ] **Step 7: Commit**

```bash
git add packages/docs/
git commit -m "Add VitePress documentation package

Scaffold packages/docs with VitePress config, brand theme overrides,
and home page. Served at /docs/ base path."
```

---

## Task 2: Write guide content

**Files:**
- Create: `packages/docs/guide/getting-started.md`
- Create: `packages/docs/guide/editing-cells.md`
- Create: `packages/docs/guide/formulas.md`
- Create: `packages/docs/guide/collaboration.md`

- [ ] **Step 1: Write `guide/getting-started.md`**

Cover: what Wafflebase is, creating a document, basic navigation (rows/columns/tabs).

- [ ] **Step 2: Write `guide/editing-cells.md`**

Cover: selecting cells, typing values, copy/paste, undo/redo, cell types (text, number, date).

- [ ] **Step 3: Write `guide/formulas.md`**

Cover: formula syntax (`=`), cell references (A1, A1:B10), supported functions (SUM, AVERAGE, IF, VLOOKUP, etc.), examples.

- [ ] **Step 4: Write `guide/collaboration.md`**

Cover: sharing documents, real-time editing, presence cursors, conflict resolution.

- [ ] **Step 5: Verify all pages render**

Run: `pnpm docs dev`
Expected: All guide pages accessible via sidebar navigation.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/guide/
git commit -m "Add user guide documentation

Getting started, cell editing, formulas, and collaboration guides."
```

---

## Task 3: Write API reference content

**Files:**
- Create: `packages/docs/api/rest-api.md`
- Create: `packages/docs/api/cli.md`

- [ ] **Step 1: Write `api/rest-api.md`**

Cover: authentication (API keys), base URL, endpoints for documents, tabs, cells. Include curl examples. Reference `packages/backend/README.md` for accurate endpoint details.

- [ ] **Step 2: Write `api/cli.md`**

Cover: installation, configuration, commands (document list, cell get/set). Reference `packages/cli/` for accurate command details.

- [ ] **Step 3: Verify all pages render**

Run: `pnpm docs dev`
Expected: API reference pages accessible via sidebar.

- [ ] **Step 4: Commit**

```bash
git add packages/docs/api/
git commit -m "Add API reference documentation

REST API endpoints and CLI usage guide."
```

---

## Task 4: Update homepage

**Files:**
- Modify: `packages/frontend/src/app/home/nav-bar.tsx:13`
- Modify: `packages/frontend/src/app/home/developer-section.tsx:143-160`

- [ ] **Step 1: Update nav-bar.tsx**

Change line 13 from:
```tsx
<a href="#developers" className="hidden md:inline text-sm text-homepage-text-secondary no-underline">Developers</a>
```
To:
```tsx
<a href="/docs" className="hidden md:inline text-sm text-homepage-text-secondary no-underline">Docs</a>
```

- [ ] **Step 2: Update developer-section.tsx**

Add documentation links below each code block. After each `</pre>` closing tag inside the code block divs, add a link:

REST API block — add after `</pre>` (after line 150):
```tsx
<a href="/docs/api/rest-api" className="inline-block mt-4 text-sm text-amber-400 hover:text-amber-300 no-underline">
  View full API documentation →
</a>
```

CLI block — add after `</pre>` (after line 157):
```tsx
<a href="/docs/api/cli" className="inline-block mt-4 text-sm text-amber-400 hover:text-amber-300 no-underline">
  View CLI documentation →
</a>
```

- [ ] **Step 3: Verify homepage renders correctly**

Run: `pnpm frontend dev`
Expected: Nav shows "Docs", developer section has documentation links.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/home/nav-bar.tsx packages/frontend/src/app/home/developer-section.tsx
git commit -m "Update homepage nav and developer section

Change Developers nav link to Docs pointing to /docs. Add links
to full API and CLI documentation from developer section."
```

---

## Task 5: Build pipeline & CI

**Files:**
- Modify: `package.json:26` (root)
- Modify: `.github/workflows/publish-ghpage.yml:29-30`

- [ ] **Step 1: Add scripts to root `package.json`**

Add after the `cli` filter line (line 29):
```json
"docs": "pnpm --filter @wafflebase/docs",
"build:all": "pnpm frontend build && pnpm docs build && cp -r packages/docs/.vitepress/dist packages/frontend/dist/docs"
```

- [ ] **Step 2: Update `publish-ghpage.yml`**

Change the build step (line 30) from:
```yaml
          pnpm frontend build
```
To:
```yaml
          pnpm frontend build
          pnpm docs build
          cp -r packages/docs/.vitepress/dist packages/frontend/dist/docs
```

- [ ] **Step 3: Verify full build locally**

Run: `pnpm build:all`
Expected: `packages/frontend/dist/docs/` contains VitePress output with `index.html`.

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/publish-ghpage.yml
git commit -m "Add docs to build pipeline and CI

Add docs filter script and build:all command. Update GitHub Pages
workflow to build and deploy VitePress docs alongside frontend."
```
