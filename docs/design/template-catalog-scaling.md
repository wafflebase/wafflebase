---
title: template-catalog-scaling
target-version: 0.7.0
---

# Template Catalog Scaling

## Summary

The template gallery ([template-gallery.md](template-gallery.md)) ships 38
hand-written TypeScript seeds, all English, behind a closed list of eight
categories and a substring search. This document plans growing it into a
Canva-lite curated catalog — roughly **230 structures / 440 listings across
English and Korean** — without giving up the review guarantees the gallery
was built around.

The catalog is **authored, not acquired**. Canva, Microsoft Create, Google's
galleries, Slidesgo/Freepik, SlidesCarnival, Vertex42, Smartsheet,
Template.net and Pitch/Gamma are all free to *use* and not free to
*redistribute*; a copy-on-use gallery hands the file itself to users, which
is exactly what their terms forbid. The volume therefore comes from an
agent-authored, human-gated generation pipeline over the builders that
already exist, topped up by a small number of per-file-vetted openly licensed
imports, and later by community submissions.

Five pieces make that possible:

1. A **format × use-case grid** with per-phase targets, a two-level category
   tree, locale as a first-class facet, and theme variants chosen at "Use
   template" time instead of near-duplicate cards.
2. A **generation pipeline**: brief → seed → deterministic gates → offline
   render → independent vision review → human PR review.
3. **Headless, idempotent registration** (`sync:templates`) that replaces the
   Playwright-driven `register:templates`, calling only existing guarded
   `TemplateService` methods.
4. **Gallery browse v2**: locale, collections, combinable filters, trigram
   search, multi-page previews, and prerendered pages crawlers can read.
5. **Openly licensed import with provenance**, and a listing `attribution`
   that travels with user copies.

### Goals

- ~92 structures by the end of Phase 1, ~170 by Phase 2, ~230 by Phase 3,
  each shipped in en and ko unless locale-specific.
- Adding a template is a single new file plus one batch PR; nobody edits a
  central list per template.
- Every template passes deterministic gates in CI and an independent visual
  review before a human sees it.
- Registering 500 templates is a repeatable, resumable command that never
  revokes a preview link and approves only what it seeded.
- A Korean visitor lands on Korean templates; filtered views are linkable;
  `/templates` and `/t/:id` answer 200 with real metadata to crawlers.
- Every non-original template carries machine-checked provenance and a
  non-removable attribution.

### Non-Goals

- Matching Canva's size (≈3.6M templates) or format breadth (social posts,
  video, print). The catalog targets the five document types we have.
- Importing, scraping or converting any template from a source whose license
  forbids redistribution. Not "for now" — ever.
- A creator revenue share. `useCount` stays the metric it would pay on.
- A table-backed category taxonomy or a curator admin UI for categories.
- Per-theme thumbnails or per-theme cards.
- BY-SA / LGPL content in Phase 1 (copyleft would bind users' own decks).

## Proposal Details

### 1. Catalog target and taxonomy grid

#### Starting point

`TEMPLATE_CATALOG` (`packages/backend/src/template/seed/catalog/index.ts:66-105`)
holds 38 entries: 20 slides (17 `themedDeck` decks, each on a different
theme), 7 sheets, 4 docs, 2 notes, 5 boards — every one English, every one
under one of eight closed labels (`template-taxonomy.ts:10-19`). Budgets,
resumes, lesson plans and personal use are empty.

#### Grid

Cells read **existing → P1 / P2 / P3**, cumulative, counting **structures**
(a ko variant is not a new structure). `–` means the format does not fit.

| | Pitch & proposal | Report & review | Plan & roadmap | Meeting & 1:1 | Retro & workshop | Tracker | Budget & finance | Lesson & training | Marketing & content | HR & onboarding | Personal | **Σ P3** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **slides** | 2 → 6/10/14 | 7 → 9/13/16 | 3 → 5/8/10 | 0 → 2/4/5 | 1 → 2/4/5 | 0 → 0/1/2 | 0 → 1/2/3 | 5 → 7/10/14 | 2 → 3/6/8 | 0 → 1/3/4 | 0 → 0/2/4 | 85 |
| **sheet** | 0 → 0/0/1 | 1 → 2/4/6 | 0 → 1/2/3 | 0 → 0/1/1 | – | 1 → 4/7/10 | 3 → 6/10/14 | 0 → 1/3/4 | 1 → 2/3/4 | 1 → 2/4/5 | 0 → 2/4/6 | 54 |
| **doc** | 0 → 2/3/5 | 0 → 2/4/5 | 1 → 2/4/5 | 1 → 2/3/4 | 0 → 0/1/1 | – | 0 → 1/1/2 | 0 → 1/3/4 | 1 → 2/3/4 | 1 → 3/5/7 | 0 → 1/2/3 | 40 |
| **note** | – | 1 → 1/2/3 | 0 → 1/2/2 | 1 → 2/4/5 | 0 → 1/1/2 | 0 → 1/1/2 | – | 0 → 1/2/3 | 0 → 0/1/1 | 0 → 0/1/1 | 0 → 1/3/4 | 23 |
| **board** | 0 → 0/1/1 | – | 0 → 2/3/4 | 1 → 1/2/3 | 4 → 6/9/12 | 0 → 1/2/2 | – | 0 → 1/2/3 | 0 → 1/2/2 | 0 → 0/1/2 | 0 → 0/1/1 | 30 |

Totals: 38 → **92 / 170 / 232 structures**, ≈ **180 / 330 / 440 listings**.
The figures are a proposal, not usage data; Phase 2 zero-result search
logging (§4) is what should re-weight them.

**Structure first.** A new entry must differ from its siblings in structure —
section order, slide or tab count, formulas, board sections. A new palette or
decor alone does not count (§1.4 handles that case). P1 fills the cells people
search for most and we lack entirely: resume, cover letter, lesson plan,
gradebook, kanban, personal budget, lean canvas, postmortem.

#### Locale policy

- **A ko listing is a localization of an en skeleton**, not an independent
  template: a seed becomes `skeleton(strings) → SeedContent`, with en and ko
  string tables side by side in the same catalog file so structure, formulas
  and layout cannot drift. `catalog.spec.ts` asserts key parity and no empty
  ko string.
- **Identity.** Each locale is its own `TemplateSeed` and slug. en slugs never
  change; ko appends `.ko` (`meeting-notes.ko`). One listing per (structure,
  locale), matching today's one-listing-one-document model
  (`schema.prisma:328`), so each locale has its own thumbnail, review and
  `useCount`.
- **Locale-specific structures** (≈5–8% of P3) exist where the *form* differs,
  not just the language: ko-only 품의서, 견적서, 주간업무보고, 가계부; en-only
  US resume.
- **Schema.** `TemplateListing.locale String @default("en")` and
  `familyKey String?` (the en slug, shared by variants; drives "also in
  English" and ko→en fallback in browse). `locale` joins `CARD_FIELDS`
  (`template.service.ts:58-63`): the language a card claims is something a
  reviewer checks (a mismatch is a rejection reason, §2.2), so changing it on
  an approved card returns it to review.
- **Fonts.** Several theme heading fonts lack Hangul (e.g. Playfair Display,
  `packages/slides/src/themes/luxe.ts:5`). Before ko ships, verify
  `themes/font-stack.ts` supplies a CJK fallback, or restrict ko seeds and the
  theme picker (§1.4) to Hangul-capable themes. *(Unverified — open item.)*

#### Taxonomy v2

Two levels; sort order in steps of 10.

| Top (sort) | Leaves |
|---|---|
| `work` Work (10) | `pitch-proposal`, `report-review`, `plan-roadmap`, `meeting`, `retro-workshop`, `project-tracker` |
| `finance` Finance (20) | `budget`, `invoice-quote`, `financial-model` |
| `education` Education (30) | `lesson-lecture`, `study-notes`, `classroom-admin` |
| `marketing` Marketing (40) | `campaign`, `content-calendar`, `brand-press` |
| `people` HR & people (50) | `resume-cover-letter`, `onboarding`, `directory-org` |
| `personal` Personal (60) | `personal-finance`, `planner-journal`, `travel-events` |
| `design` Design (70) | `design-review`, `moodboard` |
| `other` Other (990) | — |

It **stays a code constant**: the reasons at `template-taxonomy.ts:4-8` (a
closed facet makes filtering meaningful; ~30 values change at release cadence)
still hold, and a table would need an admin UI and a translated-label store
for edits only maintainers make. Values become slugs; labels move to frontend
i18n keyed by slug. `category` stores `"top/leaf"` or a bare `"top"`; browsing
a top expands to an `IN` over its children.

Migration:

1. Both `@IsIn(TEMPLATE_CATEGORIES)` sites (`template.dto.ts:83`, `:163`)
   switch to `ALL_CATEGORY_SLUGS`; browse accepts the legacy labels through an
   alias map for one release.
2. The hand-copied frontend mirror (`frontend/src/api/templates.ts:73`, used
   by `template-gallery.tsx:177` and `template-share-section.tsx:611`) moves to
   a shared `@wafflebase/core` subpath so it cannot drift.
3. Retyping `seed/types.ts:57` makes every seed a compile error until it is
   re-categorized to a leaf — the intended forcing function.
4. A **Prisma SQL** data migration maps old labels (Business → `work`, Project
   management → `work/project-tracker`, Education → `education`, …). It must
   bypass the service: `category` is a `CARD_FIELD`, and a service update
   would knock every approved card back into review for a relabel that changed
   no content.

*Shipped (PR1 of Phase 1).* The tree, `ALL_CATEGORY_SLUGS`, `childrenOf`,
`categoryLabel` and `LEGACY_CATEGORY_ALIASES` live in
`packages/core/src/templates/`, which makes `@wafflebase/core` a runtime
dependency of the backend (the image now copies `packages/core/dist`, and core
gained `typesVersions` because the backend's CommonJS resolution ignores
`exports`). Labels are English strings in that module for now; moving them to
frontend i18n keyed by slug is deferred to the ko locale work. The migration is
`20261126000000_template_category_slugs`, and a backend spec pins its `CASE`
arms to the alias map. Seeds are filed under a leaf (`catalog.spec.ts` refuses
a bare top), and the picker lists each top followed by its leaves.

#### Theme variants at "Use template"

One listing per slides structure; the "Use template" dialog offers theme
swatches and the copy is created already re-themed — instead of 23
near-duplicate cards, one per `BUILT_IN_THEMES` entry
(`packages/slides/src/themes/index.ts:38-42`).

The model already supports it: colours are role-based
(`packages/slides/src/model/theme.ts:50-61`), fonts are theme roles, the seed
slides contain no `srgb` colour, and `themedDeck` writes `themes: [theme]` +
`meta.themeId` (`builders.ts:525-535`). The editor already performs the swap
(`applyBuiltInTheme`, `frontend/src/app/slides/theme-panel-helpers.ts:33-51`).
What blocks it is the copy path: `use()` (`template.service.ts:969-1027`)
copies verbatim and `UseTemplateDto` (`template.dto.ts:274-291`) takes only a
destination. Changes:

1. A pure `rethemeSlidesRoot(root, theme)` in `@wafflebase/slides`, shared by
   the frontend helper and the backend, so there is one definition of "apply a
   theme".
2. `themeId?: string` on `UseTemplateDto`, validated against built-in ids;
   `400` on non-slides listings.
3. `slidesThemeId?` on `CopyDestination` (`document-copy.service.ts:56`),
   applied after `stripComments`, before writing.
4. The picker re-themes the mounted read-only preview in memory. The card
   keeps the publisher's theme. *(Assumes the preview mounts the editor from
   the share token — verify before building.)*

Review is unaffected: built-in themes are product code, so
`reviewedContentAt` still attests to the same document. Docs, sheets and
boards get no variants (no theme model; the board is pinned to `defaultLight`).

### 2. Generation pipeline (agent-authored, human-gated)

An agent can write a correct seed today. What doesn't scale is everything
around it: each template is registered by hand twice (`catalog/index.ts:63-102`,
`catalog/briefs.ts:35-56`), there is no project skill for authoring seeds
(the CLI's `packages/cli/skills/deck-author.md` targets a live deck, not a
catalog file), and the near-duplicate judgement lives in nobody's head.

#### 2.1 The loop

| # | Step | Run by | Input → output |
|---|---|---|---|
| 1 | Pick a grid cell | Human / orchestrator | grid row → cell id, e.g. `slides/education/lesson-lecture` |
| 2 | Write the brief | Author agent | cell → `TemplateBrief` (`catalog/brief.ts:34-40`) written *before* the content, so it drives it |
| 3 | Write the seed | Author agent | brief → `TemplateSeed` in a per-family file (§2.3), using `themedDeck()` (`builders.ts:463`) and `compositions.ts`; no raw frames, ids or colours |
| 4 | Deterministic gates | Agent locally, CI on the PR | `pnpm backend test -- seed`: `catalog.spec`, `briefs.spec`, `lint.spec`, `boards.spec`, new `near-duplicate.spec`, `provenance.spec`. A lint baseline entry needs a design reason (`lint-baseline.ts:3-8`) |
| 5 | Render | Author agent | `pnpm backend template:dump <slug>` → JSON → `pnpm frontend render:thumbnails` (§3) → per-page PNGs under `out/template-review/<slug>/` |
| 6 | Vision review | **Separate** reviewer agent, fresh context | PNGs + listing metadata + brief, never the TS source → `review.json` `{verdict: pass\|fix\|reject, findings[]}`; `fix` loops to step 3 at most twice, then the cell is dropped |
| 7 | Open the PR | Author agent | one batch; body carries a contact sheet per template on an `assets/pr-<n>` branch (the `capture-before-after.mjs` convention) plus the verdicts |
| 8 | Human review, merge | Maintainer | reads contact sheets, not TS; then `seed:templates` + `sync:templates` |

#### 2.2 Vision review rubric

Any **R** finding rejects; any **F** finding sends it back for a fix.

Per page: (1) typos and grammar, including placeholder syntax `<team>`
(`slides/work.ts:22`) — F; (2) language mismatch between title, description,
canvas text and listing locale — R; (3) hierarchy: one focal element, title
visibly dominant — F; (4) contrast where the `contrast` lint rule cannot see,
e.g. text over images (`packages/slides/src/lint/index.ts:36-43`) — F;
(5) whitespace and balance — F; (6) visual-only breakage the lint rules
passed (clipped glyphs, misaligned cards), each also filed as a lint-rule
candidate — F.

Per deck: (7) misleading title or description — R; (8) fabricated specifics
(real companies, people, real-looking figures presented as fact) — F;
(9) coherence with the brief's narrative — F; (10) near-duplicate — R.

**Near-duplicate detection**, two layers:

- *Structural, deterministic, in CI* (`near-duplicate.spec.ts`). Fingerprint
  per type — slides: theme + `(layoutId, decor)` sequence; sheets: header
  tuple + formula function set; board: section titles + grid shape;
  docs/notes: heading sequence. Jaccard over 2-shingles plus title/tag
  token-set similarity; >0.8 structure **and** >0.5 text fails unless listed
  in `near-duplicate-allow.ts` with a reason (mirrors the lint baseline,
  including a stale-entry check).
- *Perceptual, in the review script* (PNGs are not committed). 64-bit dHash
  per page against a manifest regenerated from `main`; a cover within Hamming
  6, or mean page distance ≤10, is put to the reviewer as a pair.

#### 2.3 How it runs

- **Project skill** `.claude/skills/template-author/` (`SKILL.md` = steps 2–7,
  `reference/rubric.md`, `reference/reviewer.md`), pointing at
  `packages/cli/skills/slides-author.md` for layout vocabulary instead of
  copying it. The skill authors one cell; fan-out is a Workflow with one
  worker per cell in its own worktree.
- **Per-file registration.** Catalog files move to `catalog/<kind>/<family>.ts`,
  each exporting `seeds` (and `briefs` for slides). `index.ts`/`briefs.ts`
  hold one sorted import per *file*. `catalog-files.spec.ts` asserts the files
  on disk equal the files imported — a runtime glob is not available under
  Jest + `nest build`. Parallel workers then never touch a shared file.
- **Batch size.** ≤12 templates per PR, one document type, ideally one grid
  row — what a reviewer can judge in one sitting and revert as one file.
- **Slug rules** (asserted in `catalog.spec`): `^[a-z0-9]+(-[a-z0-9]+)*(\.ko)?$`,
  ≤48 chars, never renamed, never reused, no theme or version in the slug.
  The slug derives the seeded document id (`catalog.spec.ts:38-56`).

#### 2.4 Readiness per type, and the gate to add before scaling it

| Type | Has today | Gate to add before scaling |
|---|---|---|
| **Slides** | validators, `lintSlides` (6 rules), brief capacity check, `render:slides` | Ready. Needs only `template:dump` and the near-duplicate spec |
| **Sheets** | validators, cached-`v` invariant (`catalog.spec.ts:107-119`); totals re-derived per slug by hand (`:131-272`) | Export a Node-safe `evaluateCells(cells)` from `@wafflebase/sheets`; one generic test asserting every cached value equals its evaluation, no `#REF!`/`#NAME?`, ranges inside the populated block, header + `frozenRows: 1`. Model-driven thumbnail module (§3) |
| **Board** | validators, finite frames, section/sticky rules (`boards.spec.ts:76-146`) | Run `lintSlides` over the board's elements (they are `SlidesElement`) with `overflow`/`overlap`/`contrast`/`min-font` on and `out-of-bounds`/`edge-margin` off (`lint/index.ts:51`). Model-driven thumbnail module (§3) |
| **Docs** | validators, unique block ids | Render via the Node `PdfExporter` (`packages/docs/src/export/pdf-exporter.ts`) then rasterize; `docs-lint.spec`: single title first, no skipped heading levels, ≤2 consecutive empty paragraphs, page count from `paginateLayout` within the brief's budget |
| **Notes** | validators | Heading-structure lint; thumbnails are already synthesized from text |

Rollout order: slides → sheets → boards → docs; each type's first scaled PR
adds its fingerprint to `near-duplicate.spec`.

### 3. Headless bulk registration and thumbnails

#### Why `register:templates` stops at ~40

It drives the Share dialog with Playwright, serially, 10–30 s per template
(`register-templates.ts:259-275`), and:

- **is not idempotent**: an existing listing is skipped (`:238-242`); the only
  update is `--reset`, whose `unpublish` revokes the preview share link and
  breaks every link already handed out (`:251-256`);
- **approves by substring title match** (`page.locator('li').filter({ hasText })`,
  `:430` — "Budget" matches "Budget Tracker") against a queue capped at
  `REVIEW_QUEUE_LIMIT = 100` (`template.service.ts:50`), so behind 100 real
  submissions a seed never appears;
- **mints a real session JWT** into a browser (`:170-205`).

#### Re-examining the rejected service path

[template-gallery.md](template-gallery.md) § Seeding rejected a service-level
publish path for two reasons: a headless publish has no editor and so no
thumbnail, and "it would be a second, unguarded way to swap an approved
gallery card". Neither holds for an operator command that calls the service:

- **"Unguarded"** quotes the comment on `publish()`'s upsert
  (`template.service.ts:407-413`), which explains why `publish()` must apply
  `cardReviewReset` *itself*. The guards — `CARD_FIELDS`, `assertCardEditable`,
  `cardReviewReset` (`:58-138`) — live in the service methods, not in the
  dialog. A command calling `publish`/`update`/`submit`/`review` is exactly as
  guarded as the UI. What remains forbidden is a second implementation that
  writes `TemplateListing` fields directly.
- **"No thumbnail without an editor"** is mostly no longer true: four of five
  capture sources already render from the model — slides
  `renderDeckThumbnail(store.read())` (`slides-thumbnail.ts:24`), board
  `renderBoardThumbnail` (`board-view.tsx:1382`), sheet `renderSheetThumbnail`
  on a `MemStore` offscreen (`sheet-view.tsx:1550`), note
  `renderNoteThumbnail(text)` (`notes-thumbnail.ts:110`). Only docs
  photographs the mounted container (`docs-view.tsx:695-711`).
- **The ordering constraint stays**, and a command satisfies it trivially by
  passing `thumbnailId` into `publish()`, before `submit`.

This document therefore **supersedes the rejection for an in-process operator
command**, and keeps it for any network-reachable path.

#### Proposal

1. **`pnpm frontend render:thumbnails <catalog.json> --out <dir>`** extends
   the `render:slides` harness (`scripts/render-slides.mjs`,
   `render-slides-entry.ts`): Vite-served renderer, no backend, Yorkie or
   login. `renderBoardThumbnail` and `renderSheetThumbnail` move out of their
   views into `*-thumbnail.ts` modules; docs gets a model-driven renderer by
   mounting its editor on an in-memory store offscreen, as sheet does. All
   types share `encodeThumbnail` (`thumbnail-capture.ts:145`), so the 1280 px
   WebP contract is unchanged. Headless Chromium is a rasterizer holding no
   session; non-loopback requests are blocked. It also emits up to six
   per-page images for `previewImageIds` (§4).
2. **`pnpm backend sync:templates --author <userId>`** replaces
   `register:templates`. In-process, it uploads images with
   `ImageService.upload` (`image.service.ts:102`) and calls only existing
   `TemplateService` methods. It is a sequence of compare-and-set steps, not a
   transaction — `publish()` mints a share link and reads Yorkie, `submit` and
   `review` commit their own CAS — and every intermediate state is one the
   next run continues from.

#### Idempotency, keyed on slug

A sidecar `TemplateSeedRecord { documentId PK, slug, contentHash, cardHash,
thumbnailHash, appliedAt }` keeps seed-only state off `TemplateListing`.

| Listing state | Action |
|---|---|
| none | `publish({…, thumbnailId, visibility: 'unlisted', acceptLicense: true })` → `submit` → `review(approve, contentAt)` |
| `listed`, hashes equal | no-op |
| card or thumbnail changed | `update()` (resets to `pending`, discards the old thumbnail, `:458-462`) → approve. `shareLinkId` is never touched, so the preview link survives |
| content changed | write content → wait until `contentChangedAt` ≥ write time → approve echoing that `contentAt` |
| `pending`, hashes equal | approve (resumes an interrupted run) |
| `rejected` | `submit` → approve |
| `removed` | skip and report; a takedown is terminal and the operator path never reverses moderation |

**Race.** A content write reaches the listing only through Yorkie's
`DocumentRootChanged` event (`yorkie-event.controller.ts:55-63`), which moves
a listed listing to `pending` whenever `reviewedContentAt` is older
(`template-review-sync.service.ts:80-90`). Approving before the event lands
would be undone by it — today's script avoids this only by being slow. So the
command polls for `contentChangedAt` with a bounded timeout and fails that
seed loudly on timeout; the next run finds `pending` with equal hashes and
approves. If `contentChangedAt` is later than `appliedAt`, someone else edited
the seeded document: the command refuses to approve and reports it — an
operator does not attest to content it did not write.

#### Thumbnail freshness

`thumbnailHash = sha256(contentHash, rendererVersion, theme, encoder settings)`,
where `rendererVersion` hashes the `*-thumbnail.ts` sources and the font
catalog. Identical bytes skip the upload, so a deterministic renderer causes no
card churn; rendering happens in the Docker browser image to pin fonts
(today `render:slides` uses whatever fonts the machine has). One 1280 px size
until a 500-card page weight is measured; a future small variant derives its
key from `thumbnailId` (e.g. `<id>.sm`) rather than adding a card-visible
column outside `CARD_FIELDS`.

#### Approval and notifications

The command approves by listing id, and only listings whose `documentId` is
`seedDocumentId(slug)` for a seed it applied in this run — a real user's
submission in the same queue is never its business. **No bulk-approve button**
in `/admin/templates`: each approval attests to the `contentAt` the reviewer
read (`template.service.ts:636-648`), and select-all turns that into
rubber-stamping. `submit()` gains an internal quiet option for submissions
the same run decides, or 500 stale "queued" notifications land in reviewers'
bells (`:561-566`).

#### Security of the operator path

- **Who:** anyone with a shell and the environment on a backend host — who
  already holds the database credentials. No HTTP route, admin button or API
  key verb; exposing one would recreate the rejected network-reachable path.
- **Authority minted:** none. No session cookie (removes today's minted JWT),
  no API key, no share link beyond the one `publish()` mints. The command
  re-checks `--author` against `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` (the guard
  sits on the route, not the service); `submit`/`approve` still run
  `assertPublicTierOpen`, `assertYorkieAuthEnforced` and
  `assertReviewersConfigured`; `visibility: 'public'` is still written only by
  `review()`'s approve arm.
- **Failure modes:** interrupted run resumes per the table; concurrent runs
  are serialized by `pg_try_advisory_lock` and the CAS writes; a render
  failure fails that seed instead of publishing an icon-only card; trashed or
  cross-workspace seeds are refused (`seed-templates.ts:191-208`); an
  unobserved event webhook is reported, not attested.

#### As implemented (Phase 1, PR4)

Where the shipped command differs from the proposal above, and why:

- **`contentHash` canonicalizes ids.** The catalogue is not deterministic
  across module loads — `applyLayoutToSlide` keys placeholders with
  `generateId()`, and the builder counters shift with import order — so a
  hash over raw content changed on every run. `seedContentHash` renumbers
  every `id` (and strings that are, or are prefixed by, one) in traversal
  order before hashing, so it captures which element refers to which, not the
  names. A spec loads the catalogue twice and asserts equal hashes.
- **`thumbnailHash` is the sha256 of the uploaded bytes**, the literal
  "identical bytes skip the upload" condition. Freshness against content is
  enforced separately: `render:thumbnails` echoes the `contentHash` it
  rendered from into its manifest, and `sync:templates` refuses a thumbnail
  whose hash no longer matches the catalogue. `rendererVersion` is not
  computed; a renderer change shows up as different bytes.
- **`appliedAt` is a Yorkie instant, observed — never this host's clock.** A
  write snapshots the listing's `contentChangedAt`, writes, and waits for the
  watermark to strictly advance past the snapshot; that observed value is
  `appliedAt`. Clock skew between the sync host and Yorkie therefore cannot
  wedge a seed. `appliedAt` is nullable: null means no write of ours has been
  observed, and nothing is approved.
- **Fails closed without the event webhook.** An event never observed within
  `--event-timeout` fails the seed with a message naming the webhook, and no
  approval is attempted — `review()` is never called with an undefined
  `contentAt` for content this command wrote. The record keeps `appliedAt`
  null, so the next run rewrites and waits again rather than resuming a wait
  whose event it could not tell from a stranger's.
- **First publish writes the content too.** "No record" is treated as "content
  changed": publish (thumbnail attached), then write the catalogue content —
  after the listing exists, since the watermark is kept only on a listing —
  then wait for its event, submit, and approve that watermark. An approval
  never attests to what `seed:templates`, or anyone since, left in the
  document.
- **Authorization lives in `TemplateSync`.** The reviewer allowlist (enforced
  by a route guard, not inside `review()`) and the Yorkie-enforced setting are
  checked by the class at construction and before every seed, so any in-process
  caller is gated, not only the CLI.
- **Two table rows cannot be reached through the service and are reported
  instead.** A `public` listing that a reviewer *rejected* after an edit
  cannot be resubmitted (`submit()` refuses `visibility: 'public'`), and a
  `pending` listing whose card the catalogue changed cannot be updated
  (`assertCardEditable`) or honestly approved. Both are skipped with a reason.
- **Card before content.** When both changed on an approved listing, `update()`
  runs first: it moves the listing to `pending` synchronously, whereas the
  content event does so asynchronously, after which a card edit is refused.
- **The event wait has two halves**: the watermark reaching the write, and —
  for a listing that was `public` + `listed` — the status flip that follows it.
- **Two commands until Phase 2; `register:templates` is kept, not retired.**
  Thumbnails cover slides and notes only, so sheet, board and doc seeds are
  `skipped` in the manifest and left unpublished by `sync:templates`, per
  "fail that seed instead of publishing an icon-only card". Deleting
  `register:templates` would have left those 16 seeds with no operator path,
  so it stays — restricted to sheet, doc and board, refusing slides and note
  with a pointer at `sync:templates`, while sync's skip message for the other
  three points at `register:templates` (`seed-routing.ts` holds the split, so
  the two never write the same listing). Its approve step now matches the
  queue row's title exactly and refuses when two rows share it, instead of
  the substring match that let "Budget" approve "Budget Tracker". When the
  Phase 2 renderers land, `register-templates.ts`, its scripts and the
  backend Playwright devDependency are deleted.
- **A listing with no record** (one `register:templates` made) counts as
  entirely changed, so its card, thumbnail and content are reapplied and
  re-approved once.
- **Card drift is read from the listing, not the record.** The Share dialog
  edits card columns through the same `update()` and never touches
  `TemplateSeedRecord`, so a record-held card hash reported a hand-edited card
  as `unchanged` — and, for a listing the edit returned to `pending`, approved
  it. `cardDrift` compares the listing's own title, description, category and
  tags (after `normalizeTags`) with the catalogue; the record keeps only what
  nothing else knows: which thumbnail bytes it uploaded as which `thumbnailId`
  (a different `thumbnailId` on the listing means "Update preview" replaced
  it), plus `writtenHash` / `appliedAt`.
- **The write replaces the whole root, and attests to the catalogue's root.**
  `writeContent` deletes every existing root key before writing, so nothing
  that was there — an injected sheet tab, slide, board element or comment
  thread — survives under an approved listing. It returns the hash of the root
  the catalogue *defines* (`expectedRootHash`: the same replacement applied to
  a detached, never-synced Yorkie document), refuses to push unless the live
  document hashes to exactly that, and that hash is `writtenHash`.
- **"Edited by someone else" is decided by content, not by the watermark.**
  The first watermark advance after a write is not necessarily ours, so the
  wait alone cannot attribute it. Before approving, the command reads the
  watermark, then re-reads the document and refuses unless it still hashes to
  `writtenHash` — the catalogue's root — whichever event it observed. The hash
  is of the parsed root re-serialized with sorted keys (a `Tree` node's
  attributes come back from the server in a different order than they were
  written) and with worksheet axis ids renamed by position
  (`replaceWorksheetCells` mints random ids on every write); both were found
  by `test/seed-content-attached.e2e-spec.ts`, which runs this path against a
  real Yorkie server for every seed type.
  Approval then echoes the watermark read *before* the content, so an edit
  after that read either changes the content (refused here) or moves
  `contentChangedAt` past `contentAt`, which `review()` refuses
  (`template.service.ts`, the `seen !== actual` CAS in `review()`). A
  content-identical late event of our own — the case that used to wedge a seed
  on "edited by someone else" — now just approves the newer watermark.
- **Residual window:** an edit made after the read-back whose event has not
  reached the backend when `review()` runs is approved with the older
  watermark. It is not served: when its event lands,
  `TemplateReviewSyncService` returns the listing to `pending`, and
  `isVisibleTo` hides any listing whose `contentChangedAt` is past
  `reviewedContentAt` even if that write never happens.
- **A record without a listing is stale and discarded.** `unpublish` deletes
  the listing but not the `TemplateSeedRecord`; the next run treats the seed as
  never published (publish → write → observe → submit → approve). Handled in
  the command, not by making `TemplateService.unpublish` aware of seed
  records: the record is the operator tool's own bookkeeping.
- **Contract-tested against the real service.**
  `test/template-sync.e2e-spec.ts` (`RUN_DB_INTEGRATION_TESTS`) drives
  `TemplateSync` against the real `TemplateService` and
  `TemplateReviewSyncService` on Postgres, with a fake Yorkie document store
  and event source: first publish, card change, content change, a
  third-party edit before and inside the wait, re-sync after unpublish, and
  the `contentAt` CAS.

### 4. Gallery browse v2

Today: one `type`, one `category`, one `tag`, and an unindexed `ILIKE`
(`template.dto.ts:137-209`, `template.service.ts:1120-1150`); filter state in
component `useState` (`template-gallery.tsx:85-93`), so a filtered view cannot
be linked; a one-column grid on mobile (`:202`). At 440 listings in two
languages, a popularity-ranked flat grid shows every Korean visitor English
decks and buries everything past page one.

#### Data model (one additive migration)

```prisma
model TemplateListing {
  // ...existing
  locale          String   @default("en")   // CARD_FIELD (§1.2)
  familyKey       String?                   // en slug shared by locale variants
  format          String?                   // derived at publish: '16:9' | '4:3' | 'a4' | 'letter'; null for sheet/board
  previewImageIds String[]                  // ≤6 page images; CARD_FIELD
  searchText      String   @default("")     // lower(title ‖ description ‖ tags), written by the service
  attribution     String?                   // §5; CARD_FIELD
  sourceLicense   String?                   // SPDX id; CARD_FIELD

  @@index([visibility, status, locale, useCount])
  @@index([tags], type: Gin)
  @@index([searchText(ops: raw("gin_trgm_ops"))], type: Gin)
}

model TemplateCollection {
  id       String    @id @default(uuid())
  slug     String
  locale   String
  title    String
  kind     String              // 'featured' | 'seasonal' | 'editorial'
  rank     Int       @default(0)
  startsAt DateTime?
  endsAt   DateTime?
  items    TemplateCollectionItem[]
  @@unique([slug, locale])
  @@index([locale, rank])
}

model TemplateCollectionItem {
  collectionId String
  listingId    String           // FK Cascade
  rank         Int
  @@id([collectionId, listingId])
}
```

- `format` is derived from the document, never typed, so the facet cannot
  drift from content.
- Collections are a table while categories are a constant because they change
  when an editor curates, not when we release. Writes sit behind
  `TemplateReviewerGuard`; `sync:templates` seeds them from the catalog.
- **Collections grant no visibility**: their reads reuse `browse()`'s `where`,
  so a listing that leaves `public`/`listed` — or whose content moved past
  `reviewedContentAt` — drops out of every row.
- The migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` by hand (trusted
  since PostgreSQL 13; no new infrastructure).

#### API

`GET /templates` gains `locale`; repeatable `type`/`category`/`format` (OR
within a facet); repeatable `tags` (AND, GIN `hasEvery`; `tag` stays as an
alias); `collection` (ordered by item rank); and in Phase 2 `facets=1`
(per-facet counts excluding their own filter). `GET /templates/collections?locale=`
returns active collections with their first 12 cards in two queries. In a ko
browse, each `familyKey` shows its ko variant and falls back to en.

**Search uses pg_trgm, not full-text search.** Postgres FTS has no Korean
dictionary and `simple` splits on whitespace, so `보고서` never matches
`주간보고서` or `보고서를`; fixing that means shipping a morphological analyzer
in every self-host image. Trigrams match substrings in both languages and
tolerate English typos. Predicate: `searchText ILIKE '%q%' OR searchText % q`;
score `word_similarity(q, title)*2 + word_similarity(q, searchText) + (exact
tag ? 1 : 0)`; keyset on `(score, id)` via `$queryRaw`. pg_trgm keeps only
characters the database locale deems alphanumeric — under `LC_CTYPE=C` Hangul
may be dropped, degrading ranking and the index but not correctness (the
`ILIKE` arm still matches). Phase 1 ships a Korean fixture test against the CI
database.

#### UI

- `/templates`: search hero, type chips, one scroll-snap row per collection
  with "See all" → `/templates/c/:slug`, category tiles.
  `/templates/category/:category` is a path route so it can be prerendered.
- Filter chips replace the Selects; all state in `useSearchParams` (linkable,
  back button).
- Locale defaults from `navigator.language`'s primary subtag (`ko-KR` → `ko`),
  falling back to `en`, with a visible language chip; an explicit choice is
  remembered in `localStorage` (try/catch).
- `/t/:id` gains a `previewImageIds` strip above the live preview
  (`template-landing.tsx:162-176`).
- **393 px:** two columns; chips on one scrolling line with the rest behind a
  "Filters (n)" bottom sheet; collection rows show ~1.3 cards; the preview
  strip becomes a swipe carousel.

#### SEO

The frontend is a static SPA on GitHub Pages (`publish-ghpage.yml:291`); deep
links work through the spa-github-pages `404.html` redirect, so `/templates`
and `/t/:id` **answer HTTP 404** to crawlers, and unfurlers (Slack,
KakaoTalk, X) and Naver see only the generic tags in `index.html:21-31`. That
is actively harmful today.

| Option | Verdict |
|---|---|
| A. Build-time prerender in `publish-ghpage` from the public API | **Recommended** |
| B. Backend-rendered HTML for `/t/:id` | Wrong origin for canonical URLs; Pages cannot proxy. Self-host-only |
| C. Move hosting to an SSR/edge platform | Out of proportion |
| D. Dynamic rendering for bots | Cloaking risk; rejected |

A post-build script pages through the public listings and writes
`dist/templates/index.html`, `dist/templates/category/<c>/index.html`,
`dist/t/<id>/index.html`, `sitemap.xml` and `robots.txt` — each a copy of
`index.html` with its own title, description, canonical, `og:image`
(`/images/:thumbnailId`), `<html lang>` from `locale`, JSON-LD, and static
card markup that `createRoot` replaces. Pages serves `dir/index.html` with a
200. The files join the deploy's prune manifest; a daily `schedule:` trigger
keeps them fresh. Residual: a taken-down listing's static metadata can linger
≤24 h until Phase 2 fires a `repository_dispatch` on takedown.

### 5. Openly licensed import and provenance

The catalog rule stays "authored here, Apache-2.0"
(`seed/catalog/README.md:5-7`), with one extension: `imported/**`, each under
the license its `provenance.json` names.

**Usable sources (per-file vetting):** Figma Community files marked CC BY 4.0
or MIT; LibreOffice extension templates and
`dohliam/libreoffice-impress-templates` items under CC BY or public domain;
Excalidraw libraries (MIT) as board building blocks. **Safe ingredients:**
Google Fonts (OFL/Apache/UFL), Lucide/Tabler/Phosphor icons, Unsplash/Pexels
photos *embedded in a template's composition* (Unsplash forbids compiling a
competing service, so never a browsable image library). **Excluded:** every
source listed in the Summary, and any NC, ND, or — in Phase 1 — BY-SA / LGPL
item.

#### File → `SeedContent` loader

Every `SeedContent` arm is already what the v1 writers accept
(`seed/types.ts:15-37`), so importing is a **build step producing a
`SeedContent`**, not a new write path:

```
catalog/imported/<slug>/
  provenance.json       # committed, reviewed
  content.json          # committed SeedContent snapshot
  assets/<sha256>.webp  # committed, content-addressed
  (source.pptx)         # not committed; fetched by sourceUrl + sha256
```

A **committed snapshot, not convert-at-seed-time**: approval is pinned to
content, so re-importing on every seed would let an importer fix silently
rewrite approved decks; with a snapshot, importer drift is a reviewable diff
from `pnpm backend catalog:reimport <slug>`. It also keeps
`seedDocumentId(slug)`'s "same slug, same document" true for content, and
keeps only referenced images (WebP, ≤400 KB each, ≤3 MB per template, enforced
in CI).

- **PPTX** `importPptx` (`packages/slides/src/node.ts:207-217`) with the xmldom
  polyfill the CLI installs; **DOCX** `DocxImporter.import`
  (`packages/docs/src/import/docx-importer.ts:75`); **XLSX**
  `importXlsxWorkbook` (`packages/sheets/src/import/xlsx-importer.ts:410`) is
  browser-entry only and relies on `parentElement` (`xlsx-xml.ts:25`), which
  is unverified under xmldom — a Node smoke test precedes any xlsx import.
- **Images.** The loader passes its own `uploadImage` that records bytes under
  `assets/` and returns `asset:<sha256>` — not the CLI's `data:` URL uploader
  (`pptx-import.ts:19`), which inlines every image into the CRDT and every
  user's copy, and which `DocumentCopyService` does not re-host
  (`document-image-refs.ts:33`). At seed time `writeContent` uploads each
  asset via `ImageService.upload` and rewrites it to
  `/api/v1/workspaces/{wid}/images/{id}`, the pattern `miro.service.ts:476-486`
  uses. BMP is re-encoded; EMF/WMF/SVG land in `report.skippedImages` and fail
  conversion unless provenance records a reason.
- **Fonts.** The importer keeps the typeface string verbatim
  (`import/pptx/font.ts`). The loader maps every family through
  `provenance.fontMap`, and a frontend-side test requires each resulting family
  to be in `FONT_CATALOG_DATA` with an OFL/Apache/UFL license (the catalog
  lives in the frontend; the backend cannot import it).

#### `provenance.json` and its CI gate

```json
{
  "slug": "impress-blue-lines",
  "license": "CC-BY-4.0",
  "source": { "url": "https://…", "sha256": "…", "author": "…", "retrievedAt": "2026-11-20" },
  "attribution": "“Blue Lines” by Jane Doe, CC BY 4.0, adapted by Wafflebase",
  "modifications": "Re-typeset in Nunito Sans; recoloured to theme roles",
  "fontMap": { "Avenir Next": "Nunito Sans" },
  "assets": [{ "sha256": "…", "sourceUrl": "https://unsplash.com/photos/…",
               "license": "LicenseRef-Unsplash", "author": "…", "retrievedAt": "…" }],
  "checkedBy": "github-handle",
  "checkedAt": "2026-11-21"
}
```

`provenance.spec.ts` enforces: template and asset licenses on the allowlist
(`CC0-1.0`, `CC-BY-4.0`, `MIT`, `Apache-2.0`, `OFL-1.1`, `LicenseRef-Unsplash`,
`LicenseRef-Pexels`, `LicenseRef-PD`); NC, ND, `NOASSERTION` and unknown ids
rejected, BY-SA / LGPL on a copyleft list that fails; any CC-BY requires
non-empty `attribution` **and** `modifications` (CC BY 4.0 §3(a)(1)(B));
every file under `assets/` has exactly one matching entry; `checkedBy` /
`checkedAt` set. The README's Attribution section is generated from these
files.

#### Listing attribution

`attribution String?` (≤500 chars) and `sourceLicense String?` (SPDX) on
`TemplateListing`, both in `CARD_FIELDS` — stripping a credit is precisely the
swap review exists to catch. Credit lives in listing metadata, never in an
in-slide credits page the first user deletes. Shown as one line on the card
("Jane Doe · CC BY 4.0"), in full on `/t/:id`.

**Copy-on-use.** CC BY obligations attach when someone *shares* the work or
an adaptation. `use` writes the text into a new `Document.sourceAttribution`
column — Postgres, not CRDT `meta`, which any collaborator can delete by
accident. It is shown in document info, surfaced in the Share dialog when a
public link is made, prefilled and not removable when that copy is itself
published as a template, and optionally exported to `docProps/core.xml`
`dc:rights`.

#### Community submissions (later phase)

Already in place: `acceptLicense` → `licensedAt` (`template.dto.ts:224`,
`template.service.ts:510`), publisher identity on the card, `useCount`, report
intake, takedown and content-pinned approval. Needed:

1. **License choice** — `license` (`CC0-1.0` | `CC-BY-4.0` | `Apache-2.0`) on
   `SubmitTemplateDto`; `licensedAt` records *that* a grant happened, not
   *which*. Fills `sourceLicense`; `attribution` defaults to the submitter.
2. **Asset attestation** — a submit checklist stored as `assetAttestation
   Json`, backed by automatic reviewer hints: fonts outside the catalog,
   foreign-origin image references.
3. **Creator profile** — public `/u/:username/templates` with total uses.
4. Imported and community templates share `attribution`/`sourceLicense`; only
   imported ones get `provenance.json` and its CI gate — community ones rely
   on the human review queue.

### 6. Phasing

| Phase | Infrastructure | Catalog |
|---|---|---|
| **P1** | Taxonomy v2 + label migration; `locale`/`familyKey`; per-file catalog registration; `template-author` skill + rubric + near-duplicate spec; `render:thumbnails` (slides, note) + `sync:templates`; browse: multi-filter, trigram search, collections, URL-synced chips, locale default, 2-col mobile; SEO prerender of `/templates`, `/t/:id`, sitemap; Hangul font check | 92 structures, slides-heavy, en + ko |
| **P2** | Theme picker at use (`rethemeSlidesRoot`); sheet + board thumbnail modules and lint gates; `previewImageIds`; `facets=1`; prerendered category pages; takedown-triggered rebuild; zero-result logging | 170 structures; sheets and boards scale |
| **P3** | Docs PDF→PNG render + `docs-lint`; import loader + `provenance.spec` + `attribution` / `sourceAttribution`; community license choice, attestation, creator profiles | 232 structures; first vetted imports |

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| AI-authored templates look generic or same-y | Structure-first grid rule; independent reviewer agent that never sees the source; deterministic + perceptual near-duplicate gates; ≤12 per PR with contact sheets for a human |
| Fabricated or misleading content in samples | Rubric criteria (7) and (8); placeholders over invented facts |
| `sync:templates` reopens the "second publish path" concern | In-process only, calls only guarded service methods, no route; approves only listings it seeded in this run; refuses content it did not write |
| Approval undone by a late Yorkie root-change event | Poll for `contentChangedAt` before approving; fail loudly, resume next run |
| Renderer non-determinism churns every card through review | Hash-identical bytes skip upload; render inside the Docker browser image with pinned fonts |
| Hangul missing from theme fonts | P1 verification of `font-stack.ts` fallback; restrict ko seeds / picker otherwise |
| pg_trgm drops Hangul under `LC_CTYPE=C` | `ILIKE` arm keeps correctness; Korean fixture test in CI; document the locale requirement for self-hosts |
| Prerendered metadata outlives a takedown | ≤24 h daily rebuild; P2 dispatch on takedown |
| A license misread lets in non-redistributable content | Allowlist-only SPDX gate, `checkedBy` human sign-off, committed provenance; excluded sources listed by name |
| CC BY obligations lost in user copies | `Document.sourceAttribution` in Postgres, surfaced on share and re-publish |
| Category relabel bounces approved cards into review | Data migration in SQL, bypassing `CARD_FIELDS` intentionally |
