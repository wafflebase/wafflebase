# The scene half of design-sandbox (PR 11c)

Part of #700. Stacked on 11b. Design: `docs/design/design-editor/design-editor-local-plugin.md`
(rollout table row 11c).

## Why

After 11b the editor renders the *fixture* consumer's scene (`verify:frame` 34/34) but
not wafflebase's. Booting `packages/design-sandbox` gives a real scene list, a 17-row
outline of `app/login/page.tsx`, and `tokens: configured` — and a frame reporting
`no scene "login" in the scene manifest`. All 11 scenes are `deferred: true`, which
`renderScenesModule` filters out, so the frame's loader table is empty.

Before 12 because 12's value is judging a token change on a real page, and
`TokenBindingPanel` needs a `component` + `variantState` no surface supplies yet.

## Scope

| Work | Lines | Where |
| --- | --- | --- |
| `providers.tsx` — theme / router / query / tooltip / `app/Layout` | 212 | `design-sandbox/src/scenes/` |
| `fixtures/**` (documents, workspace, datasources, auth, canvas) | 377 | same, rewired |
| deferred `vite.config.ts` rows | ~40 | `design-sandbox/vite.config.ts` |
| drop `deferred` | 11 | `scenes.config.json` |

The deferred rows, from that file's own header: `react()`, `tailwindcss()`, the `@` and
`@wafflebase/*` aliases, the app-libs aliases into `packages/frontend/node_modules`,
`optimizeDeps.include`, the `define` globals, the antlr4ts `util`/`assert` shims,
`yorkieOffline()`.

**The plugin must not change.** If applying the editor to our own app needs a plugin
edit, the package split has failed. Any change under `packages/design-editor/src/plugin/`
is a finding, not a task.

## Known problems to solve

1. **Fixtures are manifest-referenced now.** `scene-entry.tsx` reads them from the
   manifest's `mocks`, not from a `fixtures/` module, so the prototype's `fixturesFor()`
   call shape does not survive. The data does.
2. **`/metadata` does not filter `deferred`.** The shell therefore lists scenes the frame
   cannot mount, and the user sees a frame-side manifest error rather than "deferred".
   Either filter it or report the state — offering an unclickable row is the defect.
3. **`shell: "app"` mounts inside the real `app/Layout.tsx`**, which pulls the sidebar and
   header. Expect the alias and provider set to be driven by what that transitively needs.
4. **`yorkieOffline()` exists so canvas scenes can mount without a server.** Canvas is
   12; only port it if a DOM scene turns out to need it.

## Done when

- [ ] a wafflebase scene paints in the frame, not a manifest error
- [ ] clicking a node in it resolves to a `packages/frontend/**` source anchor
- [ ] a class edit stages and undoes against a real file
- [ ] `verify:frame` (or a sibling gate) covers one wafflebase scene, not only the fixture
- [ ] `packages/design-editor/src/plugin/` is untouched
- [ ] the deferred-scene listing inconsistency is gone

## Parity ledger — nothing the prototype implemented may be missing

Standing constraint for the whole split: features may be added or improved, but no
capability `feat/design-system` shipped may be dropped. Measured against the 57 prototype
`.ts/.tsx/.mjs` files.

**Already dropped once, caught late:** `useTailwindCandidates` was in no PR's file list, so
the port nearly lost Tailwind candidate registration — a composed class would have had no
CSS rule and previewed as nothing. Recovered in 11b. The lesson is that the risk lives in
files no row names, which is why this ledger is per-file rather than per-PR.

| Prototype file | Lines | Status |
| --- | --- | --- |
| `vite.config.ts` | 2538 | refactored into `design-editor/src/plugin/**` (8a) |
| `sandbox/TokenEditorPanel.tsx` | 861 | **12** |
| `sandbox/TokenBindingPanel.tsx` | 668 | **12** — needs `ComponentMeta` + `VariantState` |
| `sandbox/ReviewApproveModal.tsx` | 534 | **12** — until then ⌘S writes directly |
| `sandbox/AddTokenRow.tsx` | 172 | **12** |
| `sandbox/Combobox.tsx` | 170 | **12** (token panels use it) |
| `sandbox/Accordion.tsx` | 65 | **12** |
| `sandbox/ComponentList.tsx` | 86 | **12** — pure population A, reads AST metadata only |
| `sandbox/PreviewPane.tsx` | 204 | **12** — blocked on `registry.tsx`, see below |
| `sandbox/registry.tsx` | 49 | **12** — decide: consumer-supplied seam, or drop the pane |
| `sandbox/AgentPopover.tsx` | 164 | **unassigned** — the Phase 4 agent pipeline was withdrawn; decide keep-or-drop explicitly rather than by omission |
| `scenes/providers.tsx` | 212 | **11c** (this PR) — dom mocks only; `*-store` mocks in 12 |
| `scenes/fixtures/{documents,workspace,datasources,auth}.ts` | 286 | **11c** (this PR) |
| `scenes/fixtures/canvas.ts` | 91 | **12** (canvas scenes) |
| `scenes/canvas/yorkie-offline.tsx` | 315 | **12** |
| `scenes/canvas/seed-{sheets,docs,notes}.ts` | 240 | **12** |
| `scripts/{smoke-scene,smoke-canvas,smoke-layout}.ts` | 730 | superseded by `verify-consumer` (54) + `verify-frame` (34) |
| `scripts/verify-bridge.mjs` | 311 | superseded by `verify-consumer` |
| `scripts/crawl-frame-graph.mjs` | 103 | superseded — frame graph is `?wbFrame=` per-module now |
| `scripts/poke-scene-preview.mjs` | 98 | superseded by `verify-frame` |
| `scripts/extract-design-metadata.mjs` | 59 | superseded by `GET /metadata` |
| `data/mock-metadata.ts` | 908 | superseded by `GET /metadata` (deliberate; see design doc §2) |
| `sandbox/toast.tsx` | 101 | superseded by the header notice strip |
| `sandbox/candidates.ts` | 79 | superseded by `registerCandidates` in `App.tsx` |
| `sandbox.css` | 45 | superseded by `shell/shell.css` |

The remaining 19 files landed under their own names.

## Canvas scenes — corrected findings

Recorded here rather than in the design doc because these are measurements, not design.

**`kind: 'canvas'` is a grouping label, not a code path.** It appears in four places
(`types.ts`, `scenes.ts` ×2, an `extract.mjs` JSDoc) and nothing branches on it. Canvas
scenes mount through the same path as dom scenes. The prototype used it to head a scene-list
group ("Canvas (CP4 preview)").

**Canvas scene files are ordinary, editable JSX.** `sheet-editor` points at
`packages/frontend/src/app/documents/document-detail.tsx` — 41 JSX elements: sidebar,
site header, presence, share dialog, toolbar. All of it stamps, selects and edits. Only the
pixels the engine paints inside `<canvas>` are outside the picker, and those were never a
class-editor target. An earlier note in this file claimed canvas was outside the editing
model; that was wrong and is corrected here.

**What actually blocks them is store mocking.** `document-detail.tsx:1` imports
`{ DocumentProvider, useDocument }` from `@yorkie-js/react`, so the scene needs a live
document. `yorkie-offline.tsx` (315) + `seed-*.ts` (240) are the prototype's unfinished
attempt: its own manifest called these scenes "listed for shape, not function", showing a
mount error rather than the editor. So canvas is **unfinished work, not out-of-scope work**,
and the risk is unmeasured — nobody has mounted one.

**No plugin work.** Everything canvas needs is `design-sandbox` (store providers + seeds),
so 12 inherits 11c's "the plugin does not change" constraint for this half.
