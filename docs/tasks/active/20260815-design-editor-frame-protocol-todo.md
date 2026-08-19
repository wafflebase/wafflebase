# design-editor frame protocol (PR 10a)

Part of #700. Follows 9b (#848) and the consumer gate (#849). First half of the
frame + scene layer: the typed host ↔ frame contract and the drill-in resolver.

## Scope

| File | Origin |
| --- | --- |
| `src/scenes/frame-protocol.ts` | port; `FrameSide` de-duplicated, `sceneFrameUrl` fixed |
| `src/scenes/import-paths.ts` | port; the alias table becomes a parameter |
| `src/plugin/aliases.ts` | **new** — Vite's resolved `resolve.alias`, wire-safe |

A `./scenes` export subpath, not part of `./client`. Both run in a browser but in
different ones: `./client` is the shell talking to the dev server, this is the
contract the shell shares with a scene frame — a separate document in a separate
JS realm.

## Why PR 10 does not fit two PRs

Measured, not estimated:

| Layer | Lines | Blocker |
| --- | --- | --- |
| protocol + resolver | 249 | none — this PR |
| `frame-picker` + `hmr-state` | 794 | needs a DOM test environment |
| `SceneHost` + 3 panels + `scene-entry` | 1,805 | needs React, which this package does not depend on |

The plan's 10a/10b split was by line count. Splitting by *what each half needs*
puts the React dependency in one place instead of two.

## Two defects the port found

**The prototype's frame URL cannot reach the shipped shell.** It returned
`/scene.html?…`, correct when the editor *was* the Vite app. `shellServer` maps
exactly `/scene` under `BASE`. Measured against a live consumer server:

```text
404  /scene.html             never reaches the shell middleware
---  /__design-editor/scene  reaches it, serves the document
```

**A new §6-class coupling, in client code.** `import-paths.ts` hardcoded
`packages/frontend/src` and an `@/` prefix, so a project whose alias is `~` or
`#app` resolved nothing — and a mis-resolved path yields an *empty outline*, which
reads as "no editable nodes" rather than as a bug. Fixed by reading the consumer's
own `config.resolve.alias`, not by adding an option that could drift from it.

## Also fixed here

The boundary guard from #848 reported a false failure: the word "import" in a doc
comment started a match that scanned 28 lines and attached to a type-only import's
specifier. Line-anchored now, and the clause may not span a `;`.

## Done when

- [ ] no alias or scene path compiled into browser code
- [ ] the boundary guard covers `src/scenes/` too
- [ ] the fixture consumer declares a real alias and the gate asserts it
- [ ] §6 gains the alias row; §8 records the three-way split
