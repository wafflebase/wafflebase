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

- [x] Bump `@yorkie-js/sdk` 0.7.18 → 0.7.19 in backend, frontend, notes
- [x] Bump `@yorkie-js/react` 0.7.18 → 0.7.19 in frontend; `pnpm install`
- [x] Extract the read path into `@wafflebase/docs` (`docsTreeToDocument`)
      over the neutral node type; export it
- [x] Repoint backend `readDocsRoot` at it (no behavior change) — keep the
      backend's `writeDocsRoot` where it is
- [x] Frontend `normalizeYsonTreeNode`: `attrs` → `attributes` + per-value
      `JSON.parse`, then delegate
- [x] `parseDocsSnapshot` in `snapshot-adapters.ts`
- [x] `'doc'` in `RevisionPreviewType` + `DocsPreview` mounting
      `initialize(host, MemDocStore, theme, readOnly=true)`
- [x] Wire `docs-detail.tsx`: `previewRevisionId`, `EditingChrome`,
      `PreviewSurface`, `onPreview` (mirror `notes-detail.tsx`)
- [x] Tests: depth-4/6 parse, attribute decode, table/border/header/footer,
      pageSetup scalars, unbalanced-bracket note
- [x] Update the stale "no version to bump to" comments in
      `snapshot-adapters.ts`, `revision-preview.tsx`, `docs-detail.tsx`,
      `history-panel.tsx`
- [x] Update `docs/design/revision-history.md` §4/§6/§7
- [x] `pnpm verify:fast` green (exit 0, 11 suites, 0 failures)
- [ ] **Browser smoke — blocked**, see Review
- [x] Code review over the branch diff (5 reviewers); blocking findings applied:
  - [x] Ghost-image filter missing from the shared reader (would double every
        inline image in a pre-#182 revision preview) — plus a regression test,
        mutation-checked
  - [x] Comments panel (`z-40`) painted above the preview (`z-20`) and stayed
        clickable, mutating the live document — panel withheld and its toggle
        moved into `EditingChrome`
  - [x] Fixture captured but not representative (hand-built document) —
        recaptured through the docs model's own constructors
  - [x] `parseBorderStyle` divergence: the editor's live reader kept a naive
        `split(',')` that dropped any `rgb(r, g, b)` border, so preview and
        editor disagreed — pointed at the shared parser
  - [x] `stylesJson` `typeof` guard restored
  - [x] Stale design docs: index row (0.7.18 + "no job here"), the Risks
        paragraph (present-tense defect, broken tense, fixture provenance)

## Review

Three commits: the version bump, the converter move, the feature.

**What the bump actually fixed.** Measured on a running server, 0.7.18 vs
0.7.19, over the exact failure table in the design doc: depth-4 and depth-6
trees and both unbalanced-bracket cases go from throwing to parsing, with
no change to the cases that already worked. Reading the SDK source
confirmed `preprocessYSON` is now a string-aware scanner rather than a
deeper regex — the fix upstream ask 4 specified.

**The part that was not in the plan.** Making the snapshot parse was
necessary but not sufficient. A `YSON.parse`d tree node and a live Yorkie
proxy node disagree on the attribute key (`attrs` vs `attributes`) and on
whether values are still JSON-encoded, and *neither disagreement throws* —
reusing the backend reader as-is would have rendered every block as a
style-less `paragraph` with no tables. That is caught by an explicit
normalizer, and the tests were mutation-checked (break the decode → 5
failures; read the wrong key → 5 failures) so their passing means
something. Details in the lessons file.

**Not verified: the rendered preview itself.** The local app has no
session and signing in requires GitHub OAuth, which I must not perform.
Everything below the canvas mount is verified against real data; the mount
itself follows the same `initialize(host, store, theme, readOnly)` pattern
as `DocsView` and the other four previews, and no test anywhere in this
repo mounts a canvas engine (jsdom returns `null` from `getContext`). So
**a human needs to open a docs document, name a version, and click Preview
before this merges.** Log in at http://localhost:5173 and it can be driven
from there.

**Pre-existing, untouched:** `packages/docs`'s node entry omits
`BlockMarker`, so a raw `tsc -p packages/backend` reports three errors in
`@wafflebase/slides`. Present on `main` before this branch; out of scope,
but a real gap in the same node-entry mechanism this task had to learn.
