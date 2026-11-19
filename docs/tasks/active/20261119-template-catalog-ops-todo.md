# Template Catalog: Operations Templates — Todo

Turn eight documents made as sample content for the docs-site screenshots
(#1177, local "Acme Team" workspace) into public-gallery seeds in
`packages/backend/src/template/seed/catalog/`, so a deployment publishes
them with `seed:templates` + `register:templates`.

Seeds are reusable skeletons (placeholders, guidance, a few example rows),
not copies of the screenshot state: no open votes, timers, comments or
stamps. Everything is original to this repository (catalog README
licensing rule).

## Selection

Vendor Contracts 2026 and Website Launch Tracker were first picks but are
empty sheets (their capture agent never filled them), so two other sheets
replace them. Picked to avoid overlap with the 30 existing seeds (budget, retro, project
proposal, roadmap, kickoff and weekly sync already exist):

| Source document | Kind | Catalog file |
|---|---|---|
| Regional Sales by Quarter | sheet | `sheets.ts` |
| Team contacts | sheet | `sheets.ts` |
| Shared Flat Expenses | sheet | `sheets.ts` |
| Q3 partner newsletter | doc | `docs.ts` |
| New vendor setup | doc | `docs.ts` |
| Customer Onboarding Review | slides | `slides-work.ts` + `briefs-work.ts` |
| Pricing workshop | board | `boards.ts` |
| Field visit notes | note | `note-and-board.ts` |

## Plan

- [x] Read each source document through `/api/v1` (local backend).
- [x] One agent per catalog file (disjoint ownership) writes the seeds;
      an independent agent reviews each file against the catalog rules.
- [x] Coordinator registers seeds in `index.ts` (and slides briefs in
      `briefs.ts`), runs `pnpm backend test -- seed`, slides lint.
- [x] Archive the finished docs-site task (`pnpm tasks:archive`).
- [ ] `pnpm verify:fast`, `/self-review`, PR.

## Review

Seeds (slug → title, category): `regional-sales-report` Regional Sales
Report (Business), `team-directory` Team Directory (Business),
`shared-expense-splitter` Shared Expense Splitter (Personal),
`partner-newsletter` Partner Newsletter (Marketing), `vendor-onboarding`
Vendor Onboarding (Business), `customer-onboarding-review` Customer
Onboarding Review (Business, `tropic` theme, with brief),
`board-pricing-workshop` Pricing workshop (Business), `site-visit-notes`
Site Visit Notes (Business).

Five writer agents (one per catalog file), then three independent
reviewers who rendered each seed in the real editor from a local
`seed:templates` run and fixed what they saw: clipped sheet values (seeds
can't set column widths, so every value has to fit ~15 chars), a sales
"How to use" tip that told people to insert a row outside the SUM range, a
checklist claim in a doc that has no checkboxes, a truncated board section
title, an over-long sticky that shrank its font.

Coordinator: registered all eight in `index.ts`, added Pricing workshop to
`boards.spec.ts`'s layout checks, and added cached-total tests for the three
sheets. `jest src/template` 358/358, `verify:fast` green.
