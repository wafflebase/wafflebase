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
- [ ] Conditional-format / data-validation panels fit a 375px viewport
- [ ] Comment / history / PDF side panels don't crush the editor on phones
- [ ] Homepage comparison table no longer clips at 375px
- [ ] PDF region-comment drag surface sets `touch-action: none`
- [ ] Slides panel resizers use pointer events
- [ ] Dialog / Sheet close buttons get a real hit area
- [ ] Data-validation textarea is 16px on mobile

## 3. Harden — keyboard and semantics
- [ ] Replacement focus styles where `outline-none` drops them
- [ ] Labels for placeholder-only inputs
- [ ] Homepage landmarks (nav/footer outside `<main>`)
- [ ] Smooth scrolling respects `prefers-reduced-motion`
- [ ] Missing `DialogDescription`s

## 4. Polish — design-system drift
- [ ] One Accent: empty-state create buttons step down to outline
- [ ] Hand-rolled primaries use `hover:bg-primary-hover`
- [ ] Editor code stops using `--wb-*` brand tokens; inline light-only colors use tokens
- [ ] DESIGN.md: correct the Sheets mobile-shell claim

## Review
