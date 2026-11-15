# Impeccable audit fixes (frontend)

Source: `/impeccable audit` of `packages/frontend` on 2026-11-15, score 12/20
(report: `.impeccable/audit/2026-11-15T13-01-58Z__packages-frontend.md`).
One PR, one commit per area, each reviewed and `pnpm verify:fast` green.

Out of scope: a screen-reader story for the canvas editors (sheets grid,
docs canvas, board). That needs its own design doc.

## 1. Optimize — bundle closures
- [x] `upload-queue.ts` loads the sheet/docx/pptx importers with `import()`
- [ ] ~~`shared-document.tsx` stops pulling the slides/notes engines~~ — deferred: the page also statically imports SheetView/DocsView/NotesView, and the image-resolver install depends on a layout-effect ordering contract; needs a per-type lazy split of its own
- [x] `vendor-yorkie` no longer on the homepage's critical path
- [x] SheetView: skip `setActiveCellForComment` when the cell is unchanged

## 2. Adapt — mobile and touch
- [x] Conditional-format / data-validation panels fit a 375px viewport
- [x] Comment / history / PDF side panels don't crush the editor on phones
- [x] Homepage comparison table no longer clips at 375px
- [x] PDF region-comment drag surface sets `touch-action: none`
- [x] Slides panel resizers use pointer events
- [x] Dialog / Sheet close buttons get a real hit area
- [x] Data-validation textarea is 16px on mobile

## 3. Harden — keyboard and semantics
- [x] Replacement focus styles where `outline-none` drops them
- [x] Labels for placeholder-only inputs
- [x] Homepage landmarks (nav/footer outside `<main>`)
- [x] Smooth scrolling respects `prefers-reduced-motion`
- [x] Missing `DialogDescription`s

## 4. Polish — design-system drift
- [x] One Accent: empty-state create buttons step down to outline (workspace-settings' conditional per-field Save left as is: each appears only while its own field is edited)
- [x] Hand-rolled primaries use `hover:bg-primary-hover`
- [x] Inline light-only colors use tokens (sheet image placeholder)
- [ ] ~~Docs toolbar default swatches stop using `--wb-ink`/`--wb-paper`~~ — deferred: they preview the docs engine's document default, which has no CSS token; values are visually identical in both themes
- [x] DESIGN.md: correct the Sheets mobile-shell claim; docked panels carry no shadow

## Review
