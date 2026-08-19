# Canvas scenes (PR 12b)

Part of #700. Stacked on the loose-ends branch. Design:
`docs/design/design-editor/design-editor-local-plugin.md` (rollout table row 12b).

## Outcome

The four editor scenes — `sheet-editor`, `docs-editor`, `notes-editor`, `slides-editor` —
render inside the real app shell with their fixture content. `pdf-viewer` stays deferred.

The prototype's own manifest called these scenes "listed for shape, not function", showing a
mount error rather than the editor. They work now, and nothing in the plugin changed.

## What it took

| Work | Lines | Where |
| --- | --- | --- |
| `canvas/yorkie-offline.tsx` — the `@yorkie-js/react` substitute | 315 | `design-sandbox/src/scenes/` |
| `canvas/seed-{sheets,docs,notes}.ts` | 240 | same |
| `fixtures/canvas.ts` — per-scene document metadata | 91 | same |
| `yorkieOffline()` Vite plugin + `@yorkie-js/sdk` alias + the `__wb-real` escape | ~40 | `design-sandbox/vite.config.ts` |
| `scenes/aliases.ts` — one alias map, shared by `vite.config.ts` and `vitest.config.ts` | 70 | same |
| drop `deferred` from four canvas scenes | 4 | `scenes.config.json` |

## The premise, re-verified

The shim rests on "a `Document` never attached to a `Client` is fully functional", probed by
the prototype against `@yorkie-js/sdk@0.7.13`. **The installed version is 0.7.16**, so it was
re-probed rather than inherited:

| Claim | 0.7.16 |
| --- | --- |
| a detached document accepts `update()`, `Text`, `Tree` | ✅ `status: detached`, text edits, tree constructs |
| local `subscribe()` fires and `history.canUndo()` answers | ✅ |
| `@yorkie-js/react` bundles its own SDK copy | ✅ 824 KB ESM bundle (857 KB at 0.7.13) |
| `@yorkie-js/react` does not export `Document` | ✅ |
| presence does not stick on a detached document | ✅ `getMyPresence()` is `{}`; `getPresences()` returns one empty entry, so the shim returns `[]` rather than a phantom avatar |

## Findings

**A Yorkie CRDT object does not support the `in` operator.** Measured: for a seeded cell,
`Object.keys(d3)` is `['v','f']` and `JSON.stringify(d3)` is `{"v":"48200","f":"=B3-C3"}`,
while `'f' in d3` is `false` — the proxy has no `has` trap. Any code detecting a CRDT field
with `in` is wrong and fails silently. The seed tests use `Object.keys(...).includes(...)`.

**I reported these scenes as stuck on "Loading…" and that was a measurement error.** The app
shell paints before the engine inside it mounts, and the first probe read the text at the
first non-empty `innerHTML` — catching the title placeholder. `verify:scenes` now waits for
the text to stop changing, and treats a lingering `Loading...` as a failure so the same
mistake cannot pass as a green check.

**`/api/notifications/stream` escapes the fetch guard.** It is an `EventSource`, not `fetch`,
so the guard cannot intercept it; it fails against the sentinel origin and logs one console
error per canvas scene. Harmless — nothing reads it — but it is the one request that reaches
the network from a frame whose premise is that none do. Not fixed here: intercepting it means
stubbing `EventSource`, which is a second kill-switch with its own failure modes.

**`slides-editor` has no seed, deliberately.** `initialSlidesRoot()` returns `{}` and
production's own `ensureSlidesRoot()` backfills theme, master, layouts and one blank slide
when `slides-view.tsx` mounts. Hand-building that tree here would duplicate logic with no
second implementation to check it against.

**`pdf-viewer` stays deferred.** It needs the file's bytes at a blob URL; a fixture table of
JSON responses cannot produce one.

## Done when

- [x] the four editor scenes render their fixture content, not a mount error
- [x] the seeds are verified against a real detached document, not through pixels
- [x] `verify:scenes` covers them and rejects a loading placeholder — 27/27, and removing
      `yorkieOffline()` from the plugin list takes `sheet-editor` from 142 stamped nodes to 72
      with `Loading...` still on screen: the shell and title render, the editor never mounts,
      exactly as the shim's header predicts for a provider waiting on an `attach()` that never
      happens. The placeholder check added after my own measurement error is what catches it.
- [x] `packages/design-editor` is untouched
- [x] a class edit against a wafflebase scene stages and writes — covered on the documents
      scene, which shares the app shell every canvas scene mounts in. A canvas scene's own
      `<canvas>` content is not a class-editor target and never was.
