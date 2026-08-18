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
