# Homepage Refresh — content + interop section

Status: **shipped — PR #429** (see Review section for the authoritative final state)
Branch: `homepage-refresh`

## Context

The homepage (`packages/frontend/src/app/home/`) was last given a content
pass in #277 (initial Slides addition). Since then the product gained
large capabilities that the page never advertises: DOCX/PDF export, PPTX
import/export, XLSX import, comments/mentions, spell check, charts/pivots,
SQL datasources, slide shapes/connectors/animations, ~23 themes. Version
strings are already dynamic (`__APP_VERSION__`), so nothing there is stale.

This task does **content + one new section only** — no design-system or
layout-engine changes. Demo-iframe verification was explicitly deferred.

## Verified facts (read from source, not design docs)

Import/export matrix actually shipped in code:

| Capability | Import | Export |
|---|---|---|
| Sheets (XLSX) | ✅ `packages/sheets/src/import/xlsx-importer.ts` | ❌ (none yet) |
| Docs (DOCX)   | ✅ `packages/docs/src/import/docx-importer.ts` | ✅ `packages/docs/src/export/docx-exporter.ts` |
| Docs (PDF)    | — | ✅ `packages/docs/src/export/pdf-exporter.ts` |
| Slides (PPTX) | ✅ `packages/slides/src/import/pptx/` | ✅ `packages/slides/src/export/pptx/` |
| Slides (PDF)  | — | ✅ `packages/slides/src/export/pdf.ts` |

→ Honest framing: **Import** XLSX, DOCX, PPTX · **Export** DOCX, PPTX, PDF.
Do NOT claim XLSX export (not implemented).

Docs-site pages that exist (link targets must resolve to these):
`developers/{cli,rest-api,self-hosting}`, `docs-editor/{keyboard-shortcuts,
writing-a-document}`, `guide/{collaboration,getting-started}`,
`sheets/{build-a-budget,charts,formulas,keyboard-shortcuts}`,
`slides/{build-a-deck,keyboard-shortcuts,themes-and-layouts}`.

## Work items

### 1. Fix broken link 🔴
- [x] `use-cases-section.tsx:15` — `/docs/sheets/sheet` does not exist.
      Replace with `/docs/sheets/build-a-budget` (closest matching the
      "embed an editable grid" internal-tools use case).

### 2. Refresh Features secondary cards 🟠
Keep the 3 hero pillars (Collaboration / REST API & CLI / Self-hosted).
Update the 6 secondary cards (2 per product) to current breadth:

- [x] Sheets · Formulas & Cross-Sheet References — keep (`/docs/sheets/formulas`)
- [x] Sheets · Charts, Pivots & SQL Datasources (BarChart3) —
      "Visualize, aggregate, and pull live data from PostgreSQL" → `/docs/sheets/charts`
- [x] Docs · Page-Based Document Editor — keep (`/docs/docs-editor/writing-a-document`)
- [x] Docs · Comments, Mentions & Spell Check (MessageSquare) —
      "Inline threads, @mentions, and live spell checking" → `/docs/docs-editor/writing-a-document`
      (no dedicated comments page yet; anchor TBD)
- [x] Slides · Themes, Layouts & Shapes (Palette) —
      "23 built-in themes, Google-Slides-parity layouts, 55+ shapes & connectors" → `/docs/slides/themes-and-layouts`
- [x] Slides · Animations & Presentation Mode (Presentation) —
      "Object/slide animations plus a full-screen keyboard-driven player" → `/docs/slides/build-a-deck`

### 3. New Interop section 🟡
- [x] New component `interop-section.tsx`, mounted in `page.tsx` between
      `UseCasesSection` and `WhySection` (pairs with the no-lock-in message).
- [x] Reuse `<SectionHead>` + the existing paper-card style (no new tokens).
- [x] Content: kicker "No lock-in", title "Bring your files — and take
      them with you.", two columns: **Import** (XLSX → Sheets, DOCX → Docs,
      PPTX → Slides) and **Export** (DOCX, PPTX, PDF). lucide file icons.
- [~] Add one row to the WhySection table: "Import & export PPTX, DOCX, PDF"
      → added, then **reverted at user request** (interop story lives only in
      the dedicated InteropSection, not duplicated in the comparison table).

### 4. Design doc + verify
- [x] Update `docs/design/homepage.md`: add InteropSection to the section
      table + file structure; refresh FeaturesSection card list.
- [x] `pnpm verify:fast` green.
- [x] Self-review via `/code-review` over the branch diff.
- [x] Manual smoke in `pnpm dev` (homepage renders, new section + links).

## Decisions (resolved with user before coding)

1. Interop section placement → UseCases → **Interop** → Why. ✅
2. Secondary-card swaps → dropped "Tables & Pagination" for "Comments/Mentions/
   Spell Check" (tables still noted in the Docs editor card). ✅
3. Docs link for the comments card → points at `/docs/guide/collaboration`
   (where comments/mentions are documented; updated per PR #429 review). ✅

## Phase 2 — Documentation parity (`packages/documentation`)

Docs site was content-frozen since #277 (only version bumps). No broken
links. Two problem classes; user approved Tier 1 + Import/Export page +
other gaps. Kept on the same branch → one combined PR.

### Tier 1 — stale "Slides-omitted" framing (verified against code) ✅
- [x] `.vitepress/config.ts:52` — site description add presentations.
- [x] `developers/rest-api.md:3` — intro: add presentation data.
- [x] `developers/rest-api.md:35` — "two kinds" → three; added Slides column
      to API Surface table; loosened TYPE_MISMATCH wording.
- [x] `developers/rest-api.md` Create — `type` add `"slides"` + slides example;
      Images note includes slides.
- [x] `developers/rest-api.md` Document Content — "(docs only)" → "(docs and
      slides)"; noted SlidesDocument body shape.
- [x] `README.md` — added Slides section + Import & Export row; Getting Started
      desc includes slides; "Four sidebar sections" → Five.

### PPTX export → wire into slides editor UI (new user request)
- [x] `slides/pptx-actions.ts` — add `exportSlidesPptxAndDownload` (reuses
      `exportPptx` from browser entry + credentialed `docsImageFetcher`
      adapter → `{bytes,mime}`).
- [x] `docs/export-utils.ts` — `safeFilename` ext union add `"pptx"`.
- [x] `slides/slides-export-button.tsx` — add "PowerPoint (.pptx)" menu item,
      refactor to a generic `runExport(label, fn)` helper; update header doc.
- [x] Verified: tsc clean, frontend build green (jszip bundles for browser),
      verify:fast green. Manual smoke (open deck → Export → PowerPoint)
      deferred to pre-merge.

### Import/Export — new cross-product page
- [x] New `guide/import-export.md`; added to Guide sidebar (config.ts) +
      README content table. Matrix reflects UI reality: Import XLSX→Sheets,
      DOCX→Docs, PPTX→Slides; Export DOCX+PDF (Docs), **PPTX+PDF (Slides,
      now both)**, Sheets export CLI-only. Fidelity + CLI sections included.
- [x] `pnpm --filter @wafflebase/documentation build` green (dead-link gate).

### Other coverage gaps (facts gathered via 4 parallel Explore agents)
- [x] `guide/collaboration.md` — Comments & Mentions section (Sheets cell +
      Docs text-range comments, resolve, docs comments panel, @mention
      autocomplete). Intro now says sheet/document/**presentation**.
- [x] `docs-editor/writing-a-document.md` — Images, Headers & Footers, Spell
      Check sections.
- [x] `slides/build-a-deck.md` — Add a Table, Connect Shapes, Animations &
      Transitions sections.
- [x] `slides/themes-and-layouts.md` — enumerated all 23 built-in themes
      (Simple Light default … Wafflebase brand), from code registry.
- [x] New `sheets/datasources.md` — added to Sheets sidebar (config.ts) +
      README content table.

**Vaporware deliberately NOT documented** (flagged deferred by agents):
docs Image Options panel / rotation / crop, spell-check toggle UI, Sheets
comments side panel, @mention notifications, connector arrowhead picker.

### Verify
- [x] `pnpm --filter @wafflebase/documentation build` green (dead-link gate
      passes; all new pages + sidebar links resolve).
- [x] Each new section sourced from verified code/design facts with exact UI
      labels (button/menu text, shortcuts).

## Review

Status: **Shipped as PR #429** (homepage-refresh → main). CI `verify-self`
running; MERGEABLE.

### Commits (3, rebased onto origin/main)
1. Refresh homepage for the three-product suite
2. Add PPTX export to the slides editor toolbar
3. Refresh documentation for Slides and import/export

### Rebase conflict with #428 (resolved by integration, not just merge)
While the branch was in review, `origin/main` gained **#428 "Show progress
toast during docs/slides export"**, which touched the same export files
(`slides-export-button.tsx`, `export-utils.ts`, and added an `onProgress`
option to `exportPptx`). Rather than pick a side:
- Merged `runExport(label, fn)` with #428's progress-toast pattern so **both**
  PDF and PPTX exports now drive `updateExportToast` + success/error toast id.
- Added an `onProgress?` param to `exportSlidesPptxAndDownload`, forwarded to
  `exportPptx`'s new per-slide progress callback.
- `export-utils.ts` auto-merged cleanly (#428's `updateExportToast` + this
  branch's `safeFilename` `"pptx"` union).
Re-verified post-rebase: `verify:fast` green, frontend build green, docs build
green.

### Lesson
Long-lived branches touching a hot area (exports) should `git fetch` + check
`origin/main` before the final commit — #428 landed mid-task and would have
been a silent semantic conflict (PPTX export with no progress toast) if merged
naively instead of integrated.

### Non-blocking review notes (from /code-review, accepted)
- PPTX image-fetch failure aborts the export — same behavior as the PDF path,
  not a regression.
- Home card-shadow / card-shell duplication mirrors the existing home/ pattern;
  promoting a shared primitive is a separate cleanup.

### What changed
- `use-cases-section.tsx` — broken `/docs/sheets/sheet` → `/docs/sheets/build-a-budget`.
- `features-section.tsx` — 4 of 6 secondary cards refreshed to current breadth
  (Charts/Pivots/SQL Datasources, Comments/Mentions/Spell Check, Themes/Layouts/
  Shapes, Animations & Presentation Mode); swapped `Rows3` icon for `MessageSquare`.
- `interop-section.tsx` — new "No lock-in" section, Import/Export format cards.
- `page.tsx` — mounted `<InteropSection>` between UseCases and Why.
- `why-section.tsx` — no change to rows; the proposed "Import & export PPTX,
  DOCX, PDF" row was added then **removed at user request** (interop story now
  lives solely in the dedicated InteropSection, not duplicated in the table).
- `docs/design/homepage.md` — section table, file structure, Features + Interop +
  Why subsections updated.

### Decisions confirmed with user
- Docs card 2 → Comments/Mentions/Spell Check (drop Tables & Pagination card;
  tables now noted in the Docs editor card description).
- Interop placement → UseCases → **Interop** → Why.

### Verification
- `pnpm verify:fast` — green (lint + unit).
- `pnpm --filter @wafflebase/frontend build` — green.
- Frontend typecheck (`tsc --noEmit`) — clean.
- Visual smoke (puppeteer, dark theme): Interop section renders with Import
  (XLSX→Sheets, DOCX→Docs, PPTX→Slides) / Export (DOCX, PPTX, PDF) cards;
  Why table shows the new interop row; all section headings present in order.

### Honesty guardrails applied
- No XLSX export claim (Sheets is import-only in code).
- Theme card says "Built-in themes" (no hard count) to avoid over-claiming.

### Follow-ups (not in scope)
- Demo iframe liveness check (3 hardcoded shared tokens) — deferred by user.
- No dedicated `/docs/.../comments` page exists; comments card points at
  `writing-a-document`. Consider a comments doc page later.
