# VitePress Documentation Site

Spec: `docs/specs/2026-03-14-docs-site-design.md`

## Tasks

### Phase 1: Package Setup
- [ ] Create `packages/docs/package.json` with VitePress dependency
- [ ] Create `.vitepress/config.ts` with base, sidebar, nav configuration
- [ ] Create `.vitepress/theme/style.css` with brand color overrides
- [ ] Create `index.md` (docs home page)
- [ ] Verify `pnpm docs dev` works

### Phase 2: Guide Content
- [ ] Write `guide/getting-started.md`
- [ ] Write `guide/editing-cells.md`
- [ ] Write `guide/formulas.md`
- [ ] Write `guide/collaboration.md`

### Phase 3: API Reference Content
- [ ] Write `api/rest-api.md`
- [ ] Write `api/cli.md`

### Phase 4: Homepage Integration
- [ ] Update `nav-bar.tsx`: "Developers" → "Docs" linking to `/docs`
- [ ] Update `developer-section.tsx`: add links to `/docs/api/rest-api` and `/docs/api/cli`

### Phase 5: Build Pipeline
- [ ] Add `docs` and `build:all` scripts to root `package.json`
- [ ] Update `publish-ghpage.yml` to use `build:all`
- [ ] Verify full build produces correct output structure
