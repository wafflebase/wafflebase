# design-editor shell build (PR 11a)

Part of #700. Follows 10a+10b (#855). The step §6 promised and no PR delivered:
the shell is served from `dist/shell`, and nothing builds it.

## The defect this closes

`shellServer` is complete and `SHELL_DIR = <pkg>/dist/shell` is wired, but there
is no build script and `dist/` has never existed. Measured against a live
consumer dev server:

```text
200  /__design-editor/api/health   the bridge works
404  /__design-editor/             no dist/shell/index.html
404  /__design-editor/scene        no dist/shell/scene.html
```

So the engine, the plugin host, the token seam, the browser client and the frame
runtime all ship — and there is no screen. §6 already settled the shape: *"shell
CSS prebuilt and self-contained; the frame keeps using the host's stylesheet."*

## Two populations, two mechanisms

This is the whole design. The shell and the scene frame both run React, and they
need OPPOSITE answers:

| | Owns React | Built by | Why |
| --- | --- | --- | --- |
| `index.html` — shell chrome | us, bundled | our `vite build` | the consumer's Tailwind would restyle the panels that exist to judge their theme, and two Reacts in one document is two Reacts |
| `scene.html` — the frame | the consumer's | the consumer's dev server | it renders their components, imports `virtual:wb-scenes`, and needs their `plugin-react` for fast refresh |

So `index.html` is prebuilt output and `scene.html` is a static document whose
script points at something the CONSUMER's Vite serves. `scene.html` therefore
cannot be a build input — it is copied verbatim.

## How the scene document reaches the consumer's transform — probed

The prototype had a real file in its own Vite root; a plugin has no such root.
Measured against a live Vite 6.4.3 + `@vitejs/plugin-react` 4.3.4 server:

| script src | HTTP | JSX transform | fast refresh |
| --- | --- | --- | --- |
| `/@id/__x00__virtual:wb-scene-entry.tsx` | **500** | — | — |
| `/@id/__x00__virtual:wb-scene-entry` | **500** | — | — |
| a real `.tsx` in the project root | 200 | ✅ | ✅ |
| a real `.tsx` under `node_modules`, via `/@fs/<abs>` | 200 | ✅ | ❌ |
| the same file via `/node_modules/<pkg>/…` | 200 | ✅ | ❌ |

**A virtual module is not an option.** `plugin-react` does not transform one even
with a `.tsx` suffix on the id — the JSX reaches `vite:import-analysis` verbatim
and fails to parse (`Failed to parse source for import analysis`). Had this been
assumed rather than probed, the frame would have 500'd on its own entry.

So the entry is a **real file in the installed package**, and the URL cannot be
baked into a prebuilt `scene.html`: the install path differs per consumer, and in a
monorepo the package may be hoisted above the project root. `shellServer` therefore
substitutes it at request time — it already knows its own location (`SHELL_DIR`
comes from `packageRoot(HERE)`). `scene.html` ships a placeholder token and is the
one shell asset served through a read-and-replace rather than a raw stream.

**Not covered:** the entry module gets no fast-refresh boundary, because
`plugin-react` excludes `node_modules` from refresh injection. That costs nothing a
consumer can see — they never edit our entry, and their own components keep their
boundaries — but it does mean `hmr-state.ts` is what carries frame state across a
patch, not a refresh boundary on the entry.

## Scope

| File | Purpose |
| --- | --- |
| `vite.shell.config.ts` | build: root `src/shell`, `base` = `BASE`, outDir `dist/shell`, React + Tailwind v4 |
| `src/shell/index.html` | the chrome entry (build input) |
| `src/shell/public/scene.html` | the frame document, copied verbatim |
| `src/shell/main.tsx` | mounts the chrome |
| `src/shell/App.tsx` | the `GET /health` readout; 11b moves it into a status strip |
| `src/shell/shell.css` | self-contained Tailwind v4 entry + chrome tokens |
| `src/shell/lib/cn.ts` | local `cn()`, replacing the consumer's `@/lib/utils` |
| `src/scenes/scene-entry.tsx` | the frame's entry — a REAL file, served by the consumer |
| `src/plugin/shell.ts` | gains `sceneEntryUrl` and the read-and-substitute path |
| `src/plugin/index.ts` | computes `SCENE_ENTRY_URL` from the package root |

Plus: the `build` script, the React/Tailwind devDependencies, `vite.shell.config.ts`
in the tsconfig `include`, and `test/plugin/shell.test.ts`.

**No `files` field.** The package is `private: true` and consumed by workspace
path, so nothing is packed; adding one would describe a tarball that is never built.
The published-package question lands whenever this actually ships.

**No CDN fonts.** The prototype linked Google Fonts from `index.html`; "self
contained" in §6 rules that out. System stack.

## What has to change outside the package

- **`verify-consumer.mjs` builds the shell**, because `dist` is gitignored — then
  asserts `/`, `/scene` and one hashed asset all serve 200. The gate currently has
  no shell check at all, so the 41/41 it reports covers only `/api/**`.
- **`design-editor:check` gains the build.** The lane is `typecheck && test`; a
  broken shell build would otherwise reach main green.
- **`knip.json`**: the `packages/design-editor` globs are `.{ts,mts,mjs}` — no
  `.tsx`. The new deps would be reported unused because nothing knip analyses
  imports them. Add `.tsx` and the shell entry.

## Done when

- [x] `/__design-editor/` and `/__design-editor/scene` serve 200 in the fixture
- [x] the scene document's script is transformed by the CONSUMER's Vite, proven
      against a live server rather than assumed
- [x] the shell bundle contains no reference to the consumer's stylesheet
- [x] the gate builds and asserts the shell; `design-editor:check` runs the build
- [x] §6's shell rows and §8's table record 11a

## Result

```text
design-editor      812 tests / 30 files   (+7, all shellServer)
verify-consumer     52/52  (was 41 — 11 new shell checks, and the gate
                            now builds the shell itself since dist/ is gitignored)
verify:entropy     passed  — knip sees the new .tsx tree and deps
verify:doc-index   passed
shell build        3.1s → dist/shell: index.html, scene.html, 215 kB js, 7 kB css
```

Live, in `fixtures/consumer`:

```text
200  /__design-editor/                          was 404
200  /__design-editor/scene                     was 404
200  /__design-editor/assets/index-*.js
200  /__design-editor/assets/index-*.css
200  /@fs/<pkg>/src/scenes/scene-entry.tsx      transformed, imports rewritten
```
