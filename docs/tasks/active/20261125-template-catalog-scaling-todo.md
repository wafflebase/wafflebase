# Template Catalog Scaling — Task Tracking

Design doc: [template-catalog-scaling.md](../../design/template-catalog-scaling.md)
Status: **Design drafted — awaiting review before Phase 1 implementation**

## Decisions taken (defaults, revisit in review)

- Locales: en + ko. A ko listing localizes an en skeleton (`.ko` slug suffix).
- Phase 1 target: 92 structures, slides-heavy.
- Bulk registration: in-process `sync:templates` supersedes the rejected
  service-path decision for operator use only (template-gallery.md § Seeding).

## Phase 0 — design

- [x] Parallel research: Canva model, licensing sources, codebase audit, generation tooling
- [x] Parallel section drafts (taxonomy, pipeline, sync, browse v2, provenance)
- [x] Assemble `docs/design/template-catalog-scaling.md`, index it
- [x] Pointer in template-gallery.md § Seeding; fix stale "tokenless" sentence
- [ ] Maintainer review of the design (esp. §3 reversal and §1.2 locale in `CARD_FIELDS`)

## Phase 1 — PRs (each `pnpm verify:fast` green, self-review)

- [ ] PR1 Taxonomy v2: slug constant in `@wafflebase/core`, DTO alias map, SQL label migration, retype seeds
- [ ] PR2 Per-file catalog registration (`catalog/<kind>/<family>.ts`) + `catalog-files.spec` + slug-rule assertions
- [ ] PR3 `locale` / `familyKey` schema + `CARD_FIELDS` + browse fallback + string-table seeds + parity spec
- [x] PR4 `template:dump` + `render:thumbnails` (slides, note) + `sync:templates` + `TemplateSeedRecord`; `register:templates` kept for sheet/doc/board only (user decision, self-review round 3)
- [ ] Phase 2: offline thumbnail renderers for sheet/doc/board, then delete `register:templates` (script, package.json entries, backend Playwright devDependency)
- [ ] PR5 `near-duplicate.spec` + `.claude/skills/template-author/` (rubric, reviewer prompt)
- [ ] PR6 Browse v2: pg_trgm + Korean fixture, multi-filter, collections, URL-synced chips, locale default, 2-col mobile (Before → After)
- [ ] PR7 SEO prerender (`/templates`, `/t/:id`, sitemap) in `publish-ghpage`
- [ ] Verify Hangul fallback in `themes/font-stack.ts` (blocks ko slides seeds)
- [ ] Catalog batches (≤12 per PR) toward 92 structures

## Open questions

- Does the template preview mount the editor from the share token (needed for §1.4 picker)?
- Does `font-stack.ts` provide a CJK fallback for Playfair Display et al.?
- Does `importXlsxWorkbook` run under xmldom (`parentElement`)?

## Review

_(fill in at the end)_
