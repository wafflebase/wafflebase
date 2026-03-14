---
title: docs-site
target-version: 0.1.0
---

# Documentation Site

## Summary

Wafflebase hosts a public documentation site at `wafflebase.io/docs` using
VitePress. The docs package (`packages/docs`) lives inside the monorepo as a
first-class workspace. Product screenshots are auto-captured from a dedicated
harness page via Playwright and committed to git, so the docs always reflect
the real product UI.

### Goals

- Provide scenario-based user guides with real product screenshots.
- Serve docs as a subpath (`/docs`) of the main frontend domain.
- Keep screenshot generation reproducible and CI-friendly.
- Maintain a single deployment artifact (frontend + docs combined).

### Non-Goals

- Versioned documentation — a single latest version is sufficient for now.
- API docs auto-generation from source code (e.g., TypeDoc).
- Screenshot capture in CI — screenshots are generated locally and committed.

## Proposal Details

### Package Structure

```
packages/docs/
├── .vitepress/
│   ├── config.ts          # VitePress config (base: "/docs/")
│   ├── theme/
│   │   ├── index.ts       # Extends default theme
│   │   └── style.css      # Amber/gold brand color overrides
│   ├── cache/             # .gitignored
│   └── dist/              # .gitignored — vitepress build output
├── guide/
│   ├── getting-started.md
│   ├── build-a-budget.md
│   ├── collaboration.md
│   ├── formulas.md
│   └── keyboard-shortcuts.md
├── api/
│   ├── rest-api.md
│   └── cli.md
├── public/
│   └── images/            # Playwright-captured screenshots (committed)
│       ├── getting-started-contact-list.png
│       ├── budget-complete.png
│       └── formula-examples.png
├── index.md               # Meta-refresh redirect → /docs/guide/getting-started
└── package.json           # @wafflebase/docs workspace
```

### VitePress Configuration

The key config setting is `base: "/docs/"`. This ensures all generated asset
paths, internal links, and image references are prefixed with `/docs/`.

Markdown files reference images with absolute paths like
`/images/getting-started-contact-list.png`. VitePress resolves these relative
to the `base`, so the final URL becomes
`/docs/images/getting-started-contact-list.png`.

The root `index.md` uses a `<meta http-equiv="refresh">` tag to redirect to
`/docs/guide/getting-started`, since VitePress does not support a landing page
redirect natively with the `base` subpath setup.

### Theme

The custom theme extends VitePress's default theme and overrides brand colors
to match Wafflebase's amber/gold palette:

| Token | Light | Dark |
|-------|-------|------|
| `--vp-c-brand-1` | `#d97706` | `#f59e0b` |
| `--vp-c-brand-2` | `#b45309` | `#d97706` |
| `--vp-c-brand-3` | `#92400e` | `#b45309` |

### Screenshot Capture Pipeline

Screenshots are generated from a dedicated **docs harness page** in the
frontend app (`/harness/docs`), then committed to git as static images.

#### Architecture

```
┌─────────────────────────────────┐
│  packages/frontend              │
│  src/app/harness/docs/page.tsx  │  Renders spreadsheet scenarios
│                                 │  using MemStore (no backend needed)
└──────────┬──────────────────────┘
           │  Playwright captures
           ▼
┌─────────────────────────────────┐
│  packages/frontend/scripts/     │
│  capture-docs-screenshots.mjs   │  Headless Chromium + Vite dev server
└──────────┬──────────────────────┘
           │  Saves PNGs to
           ▼
┌─────────────────────────────────┐
│  packages/docs/public/images/   │  Committed to git
└─────────────────────────────────┘
```

#### Harness Page

The harness page (`/harness/docs`) renders spreadsheet scenarios using
`MemStore` with in-memory data — no backend or database required. Each
scenario is a `<SheetScenario>` component that:

1. Creates a `MemStore` with a predefined `Grid` (cell data map).
2. Optionally sets column widths via `store.setDimensionSize("column", index, size)`.
   Column indices are **1-based** (A=1, B=2, etc.).
3. Calls `initialize(el, options)` (async) with `readOnly: true`,
   `hideFormulaBar: true`, and `hideAutofillHandle: true` for clean rendering.
4. Exposes `data-docs-scenario-id` and `data-docs-scenario-ready` attributes
   for Playwright synchronization.

Current scenarios:

| ID | Description | Dimensions |
|----|-------------|------------|
| `getting-started-contact-list` | 3×4 contact list | 700×160, col B=180px |
| `budget-complete` | 5×8 budget tracker with formulas | 700×230, custom col widths |
| `formula-examples` | 4×7 formula showcase | 700×210, custom col widths |

#### Capture Script

`capture-docs-screenshots.mjs` spins up a Vite dev server on port 4177,
launches headless Chromium via Playwright, navigates to the harness page, waits
for all scenarios to report `data-docs-scenario-ready="true"`, then captures
each scenario's sheet container (excluding the title) as a 2× DPI PNG.

```bash
# Generate screenshots (requires Playwright + Chromium)
pnpm frontend exec playwright install chromium
node packages/frontend/scripts/capture-docs-screenshots.mjs
```

### Build Pipeline

The frontend and docs are built separately, then combined into a single
deployment artifact.

```bash
pnpm build:all
# Expands to:
#   pnpm frontend build                                    → packages/frontend/dist/
#   pnpm vpdocs build                                      → packages/docs/.vitepress/dist/
#   rm -rf packages/frontend/dist/docs                     → clean previous docs
#   cp -r packages/docs/.vitepress/dist                    → packages/frontend/dist/docs/
#     packages/frontend/dist/docs
```

The `rm -rf` before `cp -r` ensures idempotency — without it, a second
`build:all` run would nest the VitePress output as `dist/docs/dist/`.

#### Final Artifact Structure

```
packages/frontend/dist/           # ← publish_dir for GitHub Pages
├── index.html                    # Frontend SPA
├── 404.html                      # SPA fallback (spa-github-pages)
├── assets/                       # Frontend JS/CSS chunks
├── icon.svg
└── docs/                         # VitePress static site
    ├── index.html                # Meta-refresh → guide/getting-started
    ├── 404.html                  # VitePress 404 (not used by GitHub Pages)
    ├── guide/
    │   ├── getting-started.html
    │   ├── build-a-budget.html
    │   ├── collaboration.html
    │   ├── formulas.html
    │   └── keyboard-shortcuts.html
    ├── api/
    │   ├── rest-api.html
    │   └── cli.html
    ├── images/                   # Screenshots from public/images/
    ├── assets/                   # VitePress JS/CSS/fonts
    ├── hashmap.json              # Local search index
    └── vp-icons.css
```

### Deployment (GitHub Pages)

The GitHub Actions workflow (`.github/workflows/publish-ghpage.yml`) deploys
on push to `main`:

1. Checkout, install pnpm + Node.js
2. `pnpm i` — install all workspace dependencies
3. `pnpm frontend build` — build the SPA
4. `pnpm vpdocs build` — build the VitePress docs
5. `rm -rf` + `cp -r` — merge docs into frontend dist
6. `peaceiris/actions-gh-pages@v4` — deploy `packages/frontend/dist/` to
   GitHub Pages with CNAME `wafflebase.io`

#### URL Routing

| URL Pattern | Served By |
|-------------|-----------|
| `/` | Frontend SPA (`index.html`) |
| `/login`, `/documents`, `/:id` | Frontend SPA (via `404.html` redirect) |
| `/docs/` | VitePress `docs/index.html` → redirect to getting-started |
| `/docs/guide/getting-started` | VitePress static HTML (clean URLs) |
| `/docs/images/*.png` | Static screenshot files |

The frontend SPA uses `404.html` (spa-github-pages pattern) to handle
client-side routing. This does not conflict with the docs subpath because
VitePress pages exist as real `.html` files and are served directly by GitHub
Pages before the 404 fallback triggers.

### Development

During local development, the three packages run concurrently:

```bash
pnpm dev
# Starts:
#   pnpm frontend dev     → http://localhost:5173
#   pnpm backend start:dev → http://localhost:3000
#   pnpm vpdocs dev        → http://localhost:5174
```

The frontend Vite config proxies `/docs` requests to the VitePress dev server:

```ts
// packages/frontend/vite.config.ts
server: {
  proxy: {
    "/docs": {
      target: "http://localhost:5174",
      changeOrigin: true,
      ws: true,  // HMR websocket
    },
  },
}
```

A custom Vite plugin adds a trailing-slash redirect for `/docs` → `/docs/` in
dev mode (GitHub Pages handles this automatically in production).

### Adding a New Screenshot

1. Add a new `Grid` dataset and `<SheetScenario>` in
   `packages/frontend/src/app/harness/docs/page.tsx`.
2. Add a matching entry to the `scenarios` array in
   `packages/frontend/scripts/capture-docs-screenshots.mjs`.
3. Run the capture script:
   ```bash
   node packages/frontend/scripts/capture-docs-screenshots.mjs
   ```
4. Reference the image in a markdown file:
   ```markdown
   ![Description](/images/new-scenario.png)
   ```
5. Commit the new PNG along with the code changes.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Screenshots drift from actual product UI | Regenerate screenshots before docs-related releases; capture script uses the real sheet engine |
| Playwright/Chromium not installed in CI | Screenshots are pre-generated and committed; CI only needs `vitepress build` |
| VitePress `base` mismatch breaks asset loading | `base: "/docs/"` is tested by `pnpm build:all` locally before deploy |
| SPA 404 redirect interferes with docs URLs | VitePress generates real `.html` files; GitHub Pages serves them directly |
| Large PNG files bloat the repository | Screenshots use 2× DPI but are cropped to scenario containers only; currently ~30–50 KB each |
