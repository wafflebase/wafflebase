# TODO — Slides Themes, Layouts, and PPTX Import

Design doc: [docs/design/slides/slides-themes-layouts-import.md](../../design/slides/slides-themes-layouts-import.md)

Three PRs grouped by user-visible value.

## PR1 — Themed authoring

User value: theme switching, eleven Google-Slides-parity layouts,
themed color/font pickers — together as one mental unit.

- [ ] commit 1 — `feat(slides): Theme/Master/Layout types and resolve fns`
- [ ] commit 2 — `feat(slides): renderer reads through resolveColor/resolveFont`
- [ ] commit 3 — `feat(slides): yorkie schema + read-time migration`
- [ ] commit 4 — `feat(docs): extend Block/Inline style.color to ThemeColor`
- [ ] commit 5 — `feat(slides): five built-in themes`
- [ ] commit 6 — `feat(frontend): theme picker side panel`
- [ ] commit 7 — `feat(slides): eleven Google-Slides-parity built-in layouts`
- [ ] commit 8 — `feat(frontend): themed color picker + themed font picker`
- [ ] verify: `pnpm verify:fast` per commit
- [ ] verify: 5 themes × 3 deck fixtures = 15 visual snapshots
- [ ] verify: zero regression on existing v1 deck snapshots
- [ ] verify: two-user Yorkie `applyTheme` convergence test
- [ ] verify: PDF export matches canvas under each theme
- [ ] PR opened, reviewed, merged

## PR2 — Import existing deck

User value: drag a `.pptx` and start working.

- [ ] commit 1 — `feat(slides): pptx unzip + xml parser scaffold`
- [ ] commit 2 — `feat(slides): pptx theme/master/layout parsers`
- [ ] commit 3 — `feat(slides): pptx slide + shape parsers`
- [ ] commit 4 — `feat(slides): pptx fallbacks (table/group/shape)`
- [ ] commit 5 — `feat(frontend): import-pptx UI (button + drag-drop)`
- [ ] commit 6 — `feat(cli): slides import command`
- [ ] verify: 36-slide Yorkie 캐즘 deck round-trip e2e
- [ ] verify: `pnpm verify:integration` (DB + Yorkie)
- [ ] PR opened, reviewed, merged

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

- [ ] Update `docs/design/README.md` Slides section with new doc
- [ ] Capture lessons in paired `20260507-slides-themes-layouts-import-lessons.md`
- [ ] After all three PRs merged: `pnpm tasks:archive && pnpm tasks:index`

## Review

(filled in at completion)
