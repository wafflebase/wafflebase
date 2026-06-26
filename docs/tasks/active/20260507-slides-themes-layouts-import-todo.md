# TODO — Slides Themes, Layouts, and PPTX Import

Design doc: [docs/design/slides/slides-themes-layouts-import.md](../../design/slides/slides-themes-layouts-import.md)

Three PRs grouped by user-visible value.

## PR1 — Themed authoring

User value: theme switching, eleven Google-Slides-parity layouts,
themed color/font pickers — together as one mental unit.

- [x] commit 1 — `feat(slides): Theme/Master/Layout types and resolve fns`
- [x] commit 2 — `feat(slides): renderer reads through resolveColor/resolveFont`
- [x] commit 3 — `feat(slides): yorkie schema + read-time migration`
- [x] commit 4 — `feat(docs): extend Block/Inline style.color to ThemeColor`
- [x] commit 5 — `feat(slides): five built-in themes`
- [x] commit 6 — `feat(frontend): theme picker side panel`
- [x] commit 7 — `feat(slides): eleven Google-Slides-parity built-in layouts`
- [x] commit 8 — `feat(frontend): themed color picker + themed font picker`
- [x] verify: `pnpm verify:fast` per commit
- [x] verify: 5 themes × 3 deck fixtures = 15 visual snapshots
- [x] verify: zero regression on existing v1 deck snapshots
- [x] verify: two-user Yorkie `applyTheme` convergence test
- [x] verify: PDF export matches canvas under each theme
- [x] PR opened, reviewed, merged

## PR2 — Import existing deck

User value: drag a `.pptx` and start working.

Tracked end-to-end in the paired `20260515-pptx-import-todo.md` (now
archived under `docs/tasks/archive/2026/05/`). Shipped as PR #243
(parser + frontend UI) and PR #245 (CLI + backend writer); benchmark
36-slide Yorkie 캐즘 deck round-trips and is viewable at
`/shared/17025f9e-cd3f-4793-91e3-593cd899e3fe`.

- [x] commit 1 — `feat(slides): pptx unzip + xml parser scaffold`
- [x] commit 2 — `feat(slides): pptx theme/master/layout parsers`
- [x] commit 3 — `feat(slides): pptx slide + shape parsers`
- [x] commit 4 — `feat(slides): pptx fallbacks (table/group/shape)`
- [x] commit 5 — `feat(frontend): import-pptx UI (button + drag-drop)`
- [x] commit 6 — `feat(cli): slides import command`
- [x] verify: 36-slide Yorkie 캐즘 deck round-trip e2e
- [x] verify: `pnpm verify:integration` (DB + Yorkie)
- [x] PR opened, reviewed, merged

## PR3 — Customize the theme

User value: brand-fit edits without leaving the editor.

Re-reviewed 2026-06-25 against current code; commit plan regrounded (see
design doc "Re-review" subsection). Key finding: theme/master colors and
fonts already cascade via render-time role resolution (repaint only), but
background fill was NOT rendered with inheritance, and layout placeholder
**positions** and master placeholder **type-styles** are copied/seeded at
slide-creation and need an explicit cascade.

Decisions (2026-06-25, user-confirmed): (1) background — wire renderer
precedence slide→layout→master→theme (proper inheritance); (2) cascade —
smart: layout position re-flows a slide placeholder only when its frame
still matches the pre-edit layout frame (user-moved placeholders kept);
master type-style re-seeds only empty placeholders (typed text kept).
Plan re-split into 5 commits for reviewability.

- [x] commit 1 — `feat(slides): updateTheme/updateMaster/updateLayout store mutations`
- [x] commit 2 — `feat(slides): background fill/image inheritance (slide→layout→master)`
- [x] commit 3 — `feat(slides): cascade layout geometry + master placeholder styles`
- [x] commit 4 — `feat(frontend): theme builder panel (colors / fonts / background)`
      — entered via the Theme panel's "Customize" tab (no separate toolbar
      button); edits apply live to all slides
### Commit 5 — canvas layout-editing mode (planned 2026-06-27)

Decisions: synthetic-slide reuse (store proxy + editor flag), layouts only on
canvas, entered via Customize-tab button. Design: see the design doc
"Commit 5 — canvas layout-editing mode" subsection.

- [ ] commit 5a — `feat(slides): buildLayoutSlide + LayoutEditStore proxy`
      — pure synthetic slide from a layout; `SlidesStore` proxy routing
      `updateElementFrame` → `updateLayoutPlaceholderFrame`, structural ops
      guarded no-ops, `batch`/`onChange` delegate. Vitest.
- [ ] commit 5b — `feat(slides): editor layoutEditMode + setStore + enter/exit`
      — mode flag suppresses text-edit/delete/insert/structural ops; allows
      move/resize/rotate; store swap reusing setCurrentSlide reset.
- [ ] commit 5c — `feat(slides): mountLayoutListPanel`
      — left-rail layouts list variant; click selects layout to edit.
- [ ] commit 5d — `feat(frontend): layout-edit mode wiring + Customize entry`
      — `layoutEditTarget` state, slides-view rail swap + enter/exit, Customize
      tab "Edit layout positions" button.
- [ ] verify: layout placeholder position edit re-flows only slides on that layout; user-moved/added elements untouched (covered by `mem-theme-builder.test.ts` cascade block; re-confirm via `buildLayoutSlide` round-trip)
- [ ] verify: each edit + cascade is a single undo unit (LayoutEditStore `batch` delegation test)
- [ ] verify: structural ops (delete/insert/text-edit) are inert in layout-edit mode
- [ ] verify: `pnpm verify:fast` per commit
- [ ] verify: `pnpm verify:browser:docker` covers layout-edit entry + a placeholder drag
- [ ] verify (optional/stretch): two-user Yorkie concurrent master/layout + slide edit convergence — no dedicated test today; add if cheap, else note as known gap
- [ ] docs: fold as-built notes into design doc; capture lessons
- [ ] PR opened, reviewed, merged

#### Already verified in commits 1–4 (PR3)

- [x] theme/master color edit repaints all slides <100 ms (role-resolved at render)
- [x] master/layout background edit cascades to inheriting slides on repaint (`mem-theme-builder.test.ts` updateMaster + resolveBackgroundFill)
- [x] master placeholder font-size edit picks up on unmodified placeholders only (`mem-theme-builder.test.ts` master-style cascade block)
- [x] layout geometry cascade — re-flow matching / user-moved untouched / only edited layout (`mem-theme-builder.test.ts` cascade block)

## Cross-cutting

- [x] Update `docs/design/README.md` Slides section with new doc
- [x] Capture lessons in paired `20260507-slides-themes-layouts-import-lessons.md`
- [ ] After all three PRs merged: `pnpm tasks:archive && pnpm tasks:index`

## Review

(filled in at completion)
