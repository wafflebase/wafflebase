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

- [ ] commit 1 — `feat(slides): theme builder mode flag + thumbnail panel switch`
- [ ] commit 2 — `feat(slides): master / layout editing routes`
- [ ] commit 3 — `feat(frontend): theme builder UI shell`
- [ ] commit 4 — `feat(slides): batch updates for cascading edits`
- [ ] verify: master color edit propagates to all slides <100 ms
- [ ] verify: layout placeholder edit only affects slides on that layout
- [ ] verify: `pnpm verify:browser:docker` covers theme builder entry
- [ ] PR opened, reviewed, merged

## Cross-cutting

- [x] Update `docs/design/README.md` Slides section with new doc
- [x] Capture lessons in paired `20260507-slides-themes-layouts-import-lessons.md`
- [ ] After all three PRs merged: `pnpm tasks:archive && pnpm tasks:index`

## Review

(filled in at completion)
