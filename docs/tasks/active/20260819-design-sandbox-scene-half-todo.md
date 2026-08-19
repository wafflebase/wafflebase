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

- [x] a wafflebase scene paints in the frame, not a manifest error — all six dom scenes
- [x] clicking a node in it resolves to a `packages/frontend/**` source anchor
- [ ] a class edit stages and undoes against a real file — not yet exercised
- [x] a gate covers wafflebase scenes, not only the fixture — `pnpm --filter
      @wafflebase/design-sandbox verify:scenes` (18 checks), a sibling of `verify:frame`
- [ ] ~~`packages/design-editor/src/plugin/` is untouched~~ — it was NOT. See the finding below.
- [x] the deferred-scene listing inconsistency is gone — `analyzeScene` carries `deferred`,
      and the shell renders those rows disabled with a reason instead of omitting them or
      offering a click whose only outcome is a frame-side manifest error

## Findings

**The plugin needed one option, and the constraint did its job.** The rule was "a change
under `src/plugin/` is a finding, not a task", and the finding is real:
`SceneConfig.fixtures` has been in the manifest type since 10a with nothing reading it, and
11b compounded it by passing `config.mocks` — a string array documenting the scene's
dependency surface — as the URL-keyed fixture table. It went unnoticed because the fixture
consumer declares `"mocks": []`, which degrades to an empty table and passes.

The resolver cannot ride along with `providers`: the fetch guard has to be installed before
the first scene import (real API modules read their base URL at module scope), and
`providers` is loaded lazily with the scene. So `options.fixtures` is a separate module,
imported statically by `virtual:wb-scenes`, defaulting to `() => ({})`.

**Four things had to be supplied, each found by the failure it caused:**

| Missing | Symptom |
| --- | --- |
| `@wafflebase/board` in the engine aliases | 500 on a transitive import; the frame reported a mount error naming `providers.tsx`, not the failing file |
| `optimizeDeps.include` | one frame load mixed optimizer generations → "Invalid hook call", then a frame that paints nothing. `resolve.dedupe` does NOT fix this |
| `define` globals | `process is not defined` |
| `providers.tsx` + `fixtures/**` | `no scene "<id>" in the scene manifest` |

`@wafflebase/board` postdates the prototype's alias list — the list was stale, not wrong.

**The frontend is NOT typechecked from here.** Mapping `@/*` makes `tsc` follow into the
whole frontend graph (engines included) under this package's options: 471 errors, none of
them real defects. Aligning `types` and `verbatimModuleSyntax` gets it to 184, and closing
the rest would mean maintaining a copy of the frontend's tsconfig forever. So the three
modules `providers.tsx` imports are declared in `src/scenes/frontend-modules.d.ts` with
their real shapes, and the frontend keeps being checked by `pnpm frontend typecheck`. What
is lost: a props change in those three fails in the browser, not here.

**The app's libraries are aliased, not depended on.** `react-router-dom` and
`@tanstack/react-query` resolve to `packages/frontend/node_modules` — declaring them would
give this package a second copy, and the day the versions drift the scene's `useNavigate`
and our `MemoryRouter` come from different instances. `react`/`react-dom` ARE declared:
measured, pnpm already points both packages at the same `react@19.1.0`.

**Cold load is slow, warm load is not.** ~6,000 modules, no duplicates, 3 engine modules
(so `opaqueRoots` is working). First paint of a scene took 55–158 s on WSL2/drvfs; the same
scene repainted in 3 s. That is why the gate polls rather than waiting on a load event.

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
| `sandbox/TokenEditorPanel.tsx` | 861 | **12a — landed** |
| `sandbox/TokenBindingPanel.tsx` | 668 | **12a — landed**, fed by the component list |
| `sandbox/ReviewApproveModal.tsx` | 534 | **12a — landed**; ⌘S opens it |
| `sandbox/AddTokenRow.tsx` | 172 | **12a — landed** |
| `sandbox/Combobox.tsx` | 170 | **12a — landed** |
| `sandbox/Accordion.tsx` | 65 | **12a — landed** |
| `sandbox/ComponentList.tsx` | 86 | **12a — landed** |
| `sandbox/PreviewPane.tsx` | 204 | **DROPPED** (12a) — its renderer map cannot be derived from source |
| `sandbox/registry.tsx` | 49 | **DROPPED** (12a) — hand-written per component; the scene frame is the preview |
| `sandbox/AgentPopover.tsx` | 164 | **DROPPED** (12a) — the Phase 4 agent pipeline was withdrawn |
| `scenes/providers.tsx` | 212 | **11c — landed**; the canvas `*-store` mocks became 12b's shim |
| `scenes/fixtures/{documents,workspace,datasources,auth}.ts` | 286 | **11c — landed** |
| `scenes/fixtures/canvas.ts` | 91 | **12b — landed** |
| `scenes/canvas/yorkie-offline.tsx` | 315 | **12b — landed** |
| `scenes/canvas/seed-{sheets,docs,notes}.ts` | 240 | **12b — landed** |
| `scripts/{smoke-scene,smoke-canvas,smoke-layout}.ts` | 730 | superseded by `verify-consumer` (54) + `verify-frame` (37, 41 with `--write`) + `verify-scenes` (27) |
| `scripts/verify-bridge.mjs` | 311 | superseded by `verify-consumer` |
| `scripts/crawl-frame-graph.mjs` | 103 | superseded — frame graph is `?wbFrame=` per-module now |
| `scripts/poke-scene-preview.mjs` | 98 | superseded by `verify-frame` |
| `scripts/extract-design-metadata.mjs` | 59 | superseded by `GET /metadata` |
| `data/mock-metadata.ts` | 908 | superseded by `GET /metadata` (deliberate; see design doc §2) |
| `sandbox/toast.tsx` | 101 | superseded by the header notice strip |
| `sandbox/candidates.ts` | 79 | superseded by `registerCandidates` in `App.tsx` |
| `sandbox.css` | 45 | superseded by `shell/shell.css` |

The remaining 19 files landed under their own names.

**The ledger is closed as of 12b.** Every one of the 57 prototype `.ts/.tsx/.mjs` files is
landed, dropped as a recorded decision, or superseded by something that does the same job —
nothing is unaccounted for. Deleting `packages/design-sdk` is now a separate, reviewable step
rather than a leap of faith.

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
