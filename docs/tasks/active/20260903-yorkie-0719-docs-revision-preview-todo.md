# Yorkie 0.7.19 + docs revision preview

Bump `@yorkie-js/sdk` / `@yorkie-js/react` to 0.7.19 and land the docs
revision preview the previous PR had to leave out.

## Why now

`docs/design/revision-history.md` §6 ask 4 (upstream
[yorkie#1966](https://github.com/yorkie-team/yorkie/issues/1966)) was the
only thing blocking docs preview. It is fixed in 0.7.19, published
2026-09-03: `preprocessYSON`'s regex chain is replaced by a string-aware
scanner (`skipString` / `findMatchingParen` / `splitTopLevelArgs`).

Measured, 0.7.19 vs 0.7.18, on the two documented defects:

| Case | 0.7.18 | 0.7.19 |
| --- | --- | --- |
| docs `Tree` depth 4 (`doc > block > inline > text`) | fails | **OK** |
| docs `Tree` depth 6 (tables) | fails | **OK** |
| note with unbalanced `]` (`Fix issue 3] later`) | fails | **OK** |
| note with 4-level brackets | fails | **OK** |
| sheets / slides / board, scalars | OK | OK |

So this bump fixes docs preview *and* retires the note caveat (a note whose
text held an unmatched bracket previewed as "Couldn't read this version").

## The two format traps

Verified against the running server (`docker compose`), attaching a real
depth-4 docs-shaped `Tree` and reading back its revision snapshot. Both
would have rendered a **plausible but wrong** preview rather than throwing,
which is the failure mode this feature's design explicitly rejects.

1. **The YSON tree node key is `attrs`, not `attributes`.**
   `postprocessTreeNode` whitelists `{type, value, attrs, children}`. The
   backend's `treeNodeToBlock` reads `el.attributes` (the *live proxy*
   shape). Reused as-is on a parsed snapshot every attribute reads
   `undefined` → every block falls back to `paragraph`, all inline style is
   dropped, and tables are not recognised as tables at all.
2. **YSON attribute values stay JSON-encoded.** The server emits
   `"align": "\"center\""`. The live path decodes them
   (`parseObjectValues` = `JSON.parse` per value); `YSON.parse` assigns
   `attrs` verbatim. So `align` would compare as `"center"` *with quotes*
   and every style lookup would miss.

Design: extract the tree→document read path into `@wafflebase/docs` over a
**neutral node type** (`{type, value?, attributes?, children?}`), and put
the YSON dialect difference in one small normalizer on the frontend side.
`@wafflebase/docs` must not gain a `@yorkie-js/sdk` dependency.

## Items

- [ ] Bump `@yorkie-js/sdk` 0.7.18 → 0.7.19 in backend, frontend, notes
- [ ] Bump `@yorkie-js/react` 0.7.18 → 0.7.19 in frontend; `pnpm install`
- [ ] Extract the read path into `@wafflebase/docs` (`docsTreeToDocument`)
      over the neutral node type; export it
- [ ] Repoint backend `readDocsRoot` at it (no behavior change) — keep the
      backend's `writeDocsRoot` where it is
- [ ] Frontend `ysonTreeToDocsDocument`: `attrs` → `attributes` + per-value
      `JSON.parse`, then delegate
- [ ] `parseDocsSnapshot` in `snapshot-adapters.ts`
- [ ] `'doc'` in `RevisionPreviewType` + `DocsPreview` mounting
      `initialize(host, MemDocStore, theme, readOnly=true)`
- [ ] Wire `docs-detail.tsx`: `previewRevisionId`, `EditingChrome`,
      `PreviewSurface`, `onPreview` (mirror `notes-detail.tsx`)
- [ ] Tests: depth-4/6 parse, attribute decode, converter parity with the
      backend path, unbalanced-bracket note
- [ ] Update the stale "no version to bump to" comments in
      `snapshot-adapters.ts`, `revision-preview.tsx`, `docs-detail.tsx`
- [ ] Update `docs/design/revision-history.md` §4/§6/§7
- [ ] `pnpm verify:fast`, browser smoke, code review before PR

## Review

(filled in at the end)
