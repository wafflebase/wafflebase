---
title: design-editor-local-plugin
target-version: 0.7.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Design Editor — Local Plugin Model & Package Boundary

## Summary

The design editor ships as a **dev-only Vite plugin installed into the
developer's own project**, not as a hosted service on `wafflebase.com`. A
developer adds `designEditor()` to their `vite.config.ts`, runs their own
`npm run dev`, opens a dev-only route, and edits their real running app. Edits
land in **their** `.tsx` files on **their** disk; they review with `git diff` and
commit themselves.

This supersedes the hosted "load a repo URL → agent edits → we open a PR" model.
That model required running a Vite dev server per user with the customer's
repository checked out and installed — arbitrary code execution in our infra,
multi-tenant, with cold starts and npm supply-chain exposure. That is a separate
product, not a feature.

The consequence for this codebase is a **two-package split**:

| Package | Published | Contents |
| --- | --- | --- |
| `@wafflebase/design-editor` (`packages/design-editor`) | yes | The Vite plugin, the AST mutators, the bridge protocol, the editor shell UI |
| `packages/design-sandbox` | no (`private: true`) | Wafflebase's own instance: scene manifest, providers, fixtures, canvas scenes, the `@wafflebase/core` token adapter |

The split is structural on purpose. As long as both halves live in one package,
"does this work on a foreign repo?" can only be answered by inspection — and
[§6](#6-the-couplings-that-must-become-configuration) shows inspection already
missed a great deal.

---

## Goals / Non-Goals

**Goals**

- One published package, one dev-only entry point: `designEditor(options)`.
- Edits land in the consumer's working tree. Git is the review surface and the
  undo of last resort.
- `packages/design-sandbox` is wafflebase's dogfood **and** the proof the
  boundary holds: if the generic package needs something wafflebase-shaped, the
  sandbox is where that shape lives.
- The published package has **no `@wafflebase/*` runtime dependency**. That is
  the mechanical test for the boundary — no review judgement required.

**Non-Goals**

- **Hosting anything.** No containers, no repo checkout, no server-side install.
- **Git credentials.** No GitHub App, no PAT, no branch creation, no PR
  creation. Superseded — see [§7](#7-what-this-replaces).
- **Non-Vite hosts.** The engine is Vite-specific by construction: `apply:
  "serve"`, module-id patching (`?wbFrame=`), HMR pushes, a second HTML entry. A
  webpack/Next host is a rewrite of the host layer, not a config flag.
- **Non-React frameworks.** The node model is JSX (`jsx-nodes.mjs`).
- **Editing document *content*.** Unchanged from the CP4 non-goals: scenes are
  editable so their UI can be judged in real states; the editor never writes
  document content anywhere.

---

## Proposal Details

### 1. Why the hosted model was abandoned

The engine is a Vite dev-server plugin, and every one of its load-bearing
mechanisms assumes the source tree is on the same filesystem as a running dev
server:

- `apply: "serve"` middleware that reads and **writes** source files;
- `?wbFrame=<side>` module ids, which are real file paths plus a query, because
  `@vitejs/plugin-react` filters on `id.split("?")[0]` (engine §7.8);
- HMR pushes after a write (engine §7.3);
- a second HTML entry (`scene.html`) for the frame's own JS realm.

To serve an arbitrary repository from our infrastructure, all of that has to run
next to a checkout of the customer's code, installed. That is a hosted
multi-tenant dev-container orchestrator. Moving the plugin to the developer's own
machine removes the requirement entirely, and removes the credential surface with
it.

### 2. The package boundary

Every file on `feat/design-system` falls into exactly one of three populations.

**A — Generic. Ships in `@wafflebase/design-editor`.**

| Area | Files |
| --- | --- |
| Node model + mutators | `src/server/jsx-nodes.mjs`, `inject.mjs`, `extract.mjs`, `stamp.mjs` |
| Plugin host | the bridge/HTTP/transaction half of `vite.config.ts`, refactored into `src/plugin/` |
| Bridge client | `mutate.ts`, `states.ts`, `anchors.ts`, `history.ts`, `candidates.ts`, ~~`registry.tsx`~~ ⚠ |
| Frame + host | `frame-protocol.ts`, `SceneHost.tsx`, `frame-picker.ts`, `hmr-state.ts`, `import-paths.ts`, `SceneOutline.tsx`, `SceneNodeDetail.tsx`, `FloatingClassEditor.tsx` |
| Shell UI | the panels, modal, combobox, accordion, toast, `SandboxLayout.tsx` |

⚠ **`registry.tsx` is population C, not A** — corrected while building 9a. It is a
map from component name to a live renderer, and every entry is one of *wafflebase's*
components imported through `@`: `Button` and `Badge`, nothing else. The generic half
is the type and `hasPreview()`; the contents belong beside `providers.tsx` in
`packages/design-sandbox`, for the same reason and in the same PR.

**B — Coupled today, must become configuration.** Enumerated in
[§6](#6-the-couplings-that-must-become-configuration).

**C — Wafflebase-only. Moves to `packages/design-sandbox`, never published.**

`yorkieOffline`, `antlr4tsAssertShim`, `src/scenes/canvas/**` (including the
`seed-*.ts` fixtures), the `packages/{sheets,docs,slides,notes}/src` aliases,
`src/scenes/fixtures/**`, `data/mock-metadata.ts`, `scenes.config.json`,
`src/scenes/providers.tsx`.

> **`packages/design-sandbox` exists as of 8c**, with the token half of
> population C in it. Before that it was a destination this document named and
> nothing occupied, and the plugin PRs *deleted* those couplings, so wafflebase's
> own scenes stopped rendering in the interval. That was the cost of the boundary
> being structural, and it is why 8c was scheduled rather than assumed — the
> dogfood is also the only proof the split holds, and it earned its keep
> immediately: see the ⚠ note at the end of [§6](#6-the-couplings-that-must-become-configuration).
>
> The scene half of population C — `providers.tsx`, `fixtures/**`, `canvas/**`,
> `mock-metadata.ts` — is still homeless, deliberately. Every one of those is
> loaded by the scene runtime (`scene-entry.tsx`, `SceneHost`), which PRs 10–12
> build, so moving them in 8c would have landed ~1,000 lines that nothing can
> execute and whose comments describe files that do not exist.
> `mock-metadata.ts` (908 lines) is not moving at all: the `/metadata` endpoint
> replaced it, and Phase 3 made that structural rather than cosmetic — a client
> holding a pre-write tree fails on every following sibling after a
> `layout-insert`.

**Target layout**

```text
packages/
├── design-editor/                  # @wafflebase/design-editor  (published)
│   ├── src/
│   │   ├── server/                 # jsx-nodes · inject · extract · stamp
│   │   ├── plugin/                 # designEditor() factory + HTTP bridge
│   │   ├── editor/                 # the shell UI  (was src/sandbox/)
│   │   ├── scenes/                 # host ↔ frame: protocol, picker, outline
│   │   └── tokens/                 # TokenAdapter interface + cssVariables impl
│   └── scene.html, index.html      # prebuilt and served as static assets
└── design-sandbox/                 # private: true — wafflebase's instance
    ├── scenes.config.json          # 8c
    ├── vite.config.ts              # 8c — the consumer config
    ├── scripts/verify-tokens.mjs   # 8c — live-server smoke
    ├── src/tokens/core-adapter.ts  # 8c — the @wafflebase/core four-file pipeline
    ├── src/tokens/preview-worker.ts# 8c — the warm tsx child
    ├── src/providers.tsx           # 10–12
    ├── src/fixtures/**             # 10–12
    └── src/canvas/**               # 10–12: yorkie-offline shim + seeds
```

⚠ **The package needed an entry point, and that is what the first consumer is
for.** `design-editor` shipped in 8a with no `main` and no `exports`, so
`import { designEditor } from '@wafflebase/design-editor'` could not resolve at
all. Nothing noticed, because the package's own tests use relative paths. Two
further findings followed from fixing it, both recorded in that package's README:
its relative imports need explicit `.ts` extensions for Node's type stripping to
load them from a Vite config, and `--configLoader runner` — which looks like the
alternative — closes the module runner after the config loads, so every deferred
dynamic import fails at request time, *including the plugin's own*. Publishing
needs a real `dist/`, built with a bundler rather than a bare `tsc` emit.

**The one-way dependency, restated.** Engine §1 stated the rule under the
package's former name — "nothing ever imports `design-sdk`" (**historical**;
the package is `design-editor` now) — which was load-bearing for the frontend
chunk budget. Under the split the rule becomes directional rather than absolute:

> `design-sandbox` → `design-editor`, never the reverse. Nothing under
> `packages/frontend` imports either. The published package declares no
> `@wafflebase/*` dependency, so a reversal fails `pnpm install` in a consumer
> project rather than being caught in review.

### 3. Support matrix

The target is not "arbitrary React". It is the convention set wafflebase's own
frontend already follows, which [`design-editor-audit.md`](./design-editor-audit.md)
documents in detail:

| | Supported |
| --- | --- |
| Bundler | Vite 6+ (dev server only) |
| Framework | React 19, JSX/TSX source |
| Styling | Tailwind v4 |
| Variants | `class-variance-authority` |
| Component conventions | shadcn/ui-shaped (Radix primitives + CVA + a token layer) |

Narrowing to this set is what makes the token half tractable at all — see §4. A
project outside it still gets the layout/scene half, which needs only React +
Vite + JSX; the token panels degrade to empty rather than writing garbage.

⚠ **The Tailwind row is narrower than the token half actually requires**, found
while building `cssVariables` in 8b. Reading and writing tokens needs only `:root` /
`.dark` custom properties — no Tailwind. What Tailwind v4 supplies is the `@theme
inline` block that turns a variable into a utility CLASS, and both of the places
that touch it degrade rather than fail: a project with no `@theme` block reports
zero `utilities` (every token editable, none reachable as a class) and its alias
write is reported as a skipped optional step. So Tailwind v4 remains what the
*class-editing* half needs, and the row is right for the product as a whole; it is
not a precondition for tokens. Tested, not inferred.

### 4. The `TokenAdapter` seam — the central constraint

**The most finished part of the engine is the least portable part.** Engine §4
states that the token pipeline is "CLOSED / enumerated": a token lives in four
specific `@wafflebase/core` files, a new semantic token is invalid until it
appears in *all four*, and `token-add` is therefore a coordinated three-point
injection across source + emitter + `@theme inline` alias. Those four paths are
string constants in **client** code (`edits.ts`, the `*_FILE` constants).

No foreign project has that pipeline. Most shadcn projects keep tokens as CSS
custom properties in a single `index.css` — which is *simpler*, not harder. So
the token half must sit behind an adapter, with wafflebase's own pipeline as the
complex reference implementation rather than the default:

```ts
interface TokenAdapter {
  /** Root-relative files whose change invalidates token state (replaces WATCHED_RE). */
  sources(): string[];
  /** Read the current token tree the editor renders and binds against. */
  read(readFile: (rel: string) => Promise<string>): Promise<TokenTree>;
  /** Turn one token edit into the file writes it implies — one file, or four. */
  plan(edit: TokenEdit): TokenWrite[] | { error: string };
  /** Render the variable map these source texts produce, WITHOUT writing. */
  emit(files: Record<string, string>): Promise<TokenEmitResult>;
  /** Re-run the project's real emitter after a write. Optional — see below. */
  regenerate?(): Promise<TokenRegenResult>;
}
```

⚠ **This sketch was three things short of implementable, found in 8b.** The
shipped interface is in `src/tokens/adapter.ts`; the differences are behavioural,
not cosmetic:

- **`plan()` must be able to REFUSE.** A pipeline that cannot express an edit —
  `cssVariables` asked for a palette rebind, which only means anything where
  tokens are code that can reference other code — has to say so. Returning `[]`
  would compose to "applied, nothing changed", which reads to the client as a
  successful edit.
- **A write needs a `required` flag.** The reference pipeline's own three-point
  edit is not three equal writes: the source const and the emitter entry are
  load-bearing (without both, a token either fails typecheck or silently never
  reaches the CSS) while the `@theme inline` alias is best-effort, because
  "already mapped" is a legitimate no-op. Without the flag, `wafflebaseCore`
  cannot reproduce its own behaviour through the seam it was extracted from.
- **`regenerate()` is a fifth method, and `emit()` cannot stand in for it.**
  They are different operations: `emit()` renders a variable map from patched
  text for the *preview* and writes nothing; `regenerate()` re-runs the
  project's emitter for real and names the artefacts to push. It is optional
  because `cssVariables` has neither — the write reached the stylesheet the host
  already serves.
- **`plan()` must be deterministic and must not read the filesystem.** It is
  called twice per edit: once to resolve the file set before any file is read,
  and again to apply. It is also reached on the second path alone, when the scene
  patcher applies a staged plan.

Two implementations:

- **`cssVariables` (default, ships in the package — shipped in 8b)** — one
  stylesheet, `:root` / `.dark` blocks, `@theme inline`. Covers the shadcn
  population. **Net-new code**, with the caveat below: nothing on
  `feat/design-system` reads or writes a single-stylesheet token layer, so it is
  the one part of the token half with no reference implementation to diff
  against, and its tests are therefore its specification rather than a
  regression net.
- **`wafflebaseCore` (lives in `design-sandbox` — shipped in 8c)** — the existing
  four-file pipeline, the `build-css.ts` worker, and the three-point `token-add`.
  It stops being the assumption. It did *not* stay exactly as built: see the two ⚠
  notes at the end of [§6](#6-the-couplings-that-must-become-configuration) for the
  emitter-expression bug and the `constName` authority the port corrected.

⚠ **A fifth shortfall, found in 8c: `TokenTree` had nowhere to report a token's
SOURCE form.** It carried `vars` (what the emitter produced), `utilities` and
`families`, and for a stylesheet pipeline that is the whole story — the declaration
*is* the value, which is why `cssVariables` never needed more. Wafflebase's
pipeline breaks that identity twice, and both matter:

- a value may be an **expression**. `--primary`'s source is `palette.syrup`, and
  `vars` reports the resolved `#B8651A`, so "is this bound to the palette or written
  inline" is unanswerable from it — which is exactly the question that decides
  whether the editor offers *rebind* or *edit the value*. It is why `set-value`
  carries `valueKind: 'expression'` at all, and without the field a client can
  accept such an edit and never know what to send.
- **not every member is emitted.** `radius` has `base`/`sm`/`md`/`lg`/`xl` and only
  `base` reaches `--radius`; the rest are derived in the app's `@theme` block. Four
  of five have no `vars` entry, and reading their current value from
  `getComputedStyle` instead is what made a freshly saved value look unsaved.

So `TokenTree.bindings` is additive and optional. Its `kind` is **three** values,
not two: a first draft collapsed everything non-literal into `ref`, and probing
`semantic.ts` showed 47 literals, 13 palette references and 2 of a third thing —
`` sidebarAccent: `rgba(${palette.butterRgb}, 0.30)` `` — where the swatch is an
*ingredient*. Reported as `ref`, a rebind picker would replace the expression and
silently drop the alpha. The contract is therefore the one PR 7b settled for
`className` / `classNameExpr`: an expression that cannot be safely rewritten is
shown read-only rather than offered as editable or hidden as absent.

The field is marked **provisional**. Its shape is the prototype's `/introspect`
response — the measured requirement rather than a guess — but the panels that
consume it arrive in PRs 10–12, and the first real consumer has corrected every
other shape in this contract.

⚠ **One shortfall considered and rejected: the adapter cannot learn `root`.**
`wafflebaseCore` needs an absolute path to spawn its two child processes, and
`TokenAdapter` has no initialisation hook, so `designEditor({ root })` and
`wafflebaseCore({ root })` are told the same value twice. Adding a lifecycle method
to the contract for the sake of one argument is the worse trade, and an adapter
that legitimately reads a different tree than the one being served is expressible
this way and would not be if the root were injected.

⚠ **"Net-new" overstated it by about half.** `inject.mjs`'s `readThemeMappings` /
`insertThemeMapping` / `removeThemeMapping` operate on CSS **text**, not on a
TypeScript AST — they were written for the `@theme inline` block and, measured
against a shadcn-CLI-shaped stylesheet, locate, insert, remove and round-trip
byte-exactly with no change. So the `@theme` half of a CSS-variables pipeline was
already generic and `cssVariables` reuses it verbatim. The genuinely missing
primitive was narrower than the section implied: **reading and writing a `:root` /
`.dark` declaration block**, which no module could do. It ships as
`src/tokens/css-decls.ts` and is tested directly rather than only through the
adapter, precisely because it is the part with no prior behaviour to compare to.

`plan()` returning a list is what keeps the three-point edit expressible without
leaking into core. The existing atomic-intent-group machinery (engine §5.8)
already guarantees all-or-nothing application, so multi-file plans need no new
transaction semantics — but a multi-write plan needs the same guarantee WITHIN
one intent, and 8b had to add it: the writes are staged and merged into the shared
composition cache only once every required one has landed. Applying them straight
into it broke `applyIntentToCache`'s "untouched on failure" promise from the
inside, leaving a half-created token for the next intent in the batch to compose
on top of.

### 5. Configuration surface, and the real onboarding cliff

```ts
// consumer's vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// `cssVariables` is a TokenAdapter factory and ships from the same package as
// the plugin — a consumer whose tokens are plain CSS custom properties should
// not have to write an adapter to get the common case.
import { designEditor, cssVariables } from '@wafflebase/design-editor'

export default defineConfig({
  plugins: [
    react(),
    designEditor({
      root:      process.cwd(),         // write boundary; nothing outside is writable
      scenes:    'design/scenes.json',  // which routes are editable
      providers: 'design/providers.tsx',
      tokens:    cssVariables({ stylesheet: 'src/index.css' }),
    }),
  ],
})
```

⚠ **The paths lost their `./` in 8b, and that was a bug, not a style change.**
`sources()` is compared *by string* against the root-relative paths the plugin
derives from what it wrote, so the `'./src/index.css'` this section originally
showed matched nothing: the CSS-regen gate never fired and `/preview-tokens` never
patched the stylesheet it had just edited. Silent in both directions — no error,
just a preview that never moved. `cssVariables` now normalises its own option and
`isTokenSource` compares normalised on both sides, so the documented form works
either way; the contract on `sources()` is that it returns normalised paths.

**The cliff is `scenes.json`, not the AST.** Wafflebase's own manifest is 204
hand-authored lines encoding route, shell nesting and fixture layering per scene,
and a consumer must additionally supply a providers module (ours hardcodes
`@/components/theme-provider` and `@/app/Layout`) and fixtures matching their own
API shapes. "Install a plugin and it works" is false; there is authoring between
install and first render.

**This is the assumption to test before anything else is built.** If authoring a
manifest + providers for an unfamiliar app takes a developer more than an hour,
the product does not work and the configuration surface has to be redesigned
(inferring routes from the router, defaulting providers to the app's own root).

### 6. The couplings that must become configuration

Population B, enumerated. Line numbers are as of `feat/design-system`; the paths
are given under the post-rename package name. The `PR` column is the split
[§8](#8-rollout) settles on.

**This table was re-verified against the source before PR 8 was scoped, and the
first revision of it was wrong in two ways** — two rows named one construct and
pointed at another, and five couplings were missing entirely. Both kinds of error
are the same failure the package split exists to catch: §2 says a boundary that
depends on inspection will be missed by inspection, and this enumeration *is* the
inspection. Corrections are marked ⚠.

| Coupling | Where | Becomes | PR |
| --- | --- | --- | --- |
| `REPO_ROOT = path.resolve(__dirname, "../..")` | `vite.config.ts:15` — **50 use sites** | `options.root`, defaulting to Vite's `config.root` | 8a |
| `utilShimPath` / `assertShimPath` | `vite.config.ts:36-37`, aliased at `2481-2482` | drop — a frontend-specific antlr4ts shim | 8a |
| ⚠ `antlr4tsAssertShim()`, `yorkieOffline()` + `YORKIE_OFFLINE_SHIM` | `vite.config.ts:51,75,119` | population C — the plugin stops shipping them | 8a drops · 8c re-homes |
| `FRONTEND_SRC` | `vite.config.ts:350`, used at `364` | the scene manifest's own root | 8a |
| ⚠ the `@` alias → `../frontend/src` | **`vite.config.ts:2441`**, not `350` — a *separate* site, resolved from `__dirname` rather than `REPO_ROOT` | consumer's own `resolve.alias`; the plugin must stop adding one | 8a |
| ⚠ `ENGINE_SRC_ROOTS` — the frame-propagation boundary | **`vite.config.ts:624-627`**. The previous revision listed this range under "aliases", which it is not | `options.opaqueRoots`: a generic "resolve once, never re-query per frame" list | 8a |
| ⚠ `@wafflebase/{sheets,docs,notes,slides}` aliases | **`vite.config.ts:2483-2486`** | move to `design-sandbox` | 8a drops · 8c re-homes |
| ⚠ app libs aliased into `packages/frontend/node_modules` | `vite.config.ts:2527-2535` | `design-sandbox` — "one copy of React Router" is the consumer's problem to solve in their own config | 8a drops · 8c re-homes |
| ⚠ `optimizeDeps.include` — the app's own dependencies | `vite.config.ts:2387-2436` | consumer's own config | 8a drops |
| ⚠ `define`: `process.env`, `__APP_VERSION__` / `rootVersion()`, `VITE_BACKEND_API_URL` → `SCENE_API_ORIGIN` | `vite.config.ts:2330-2341,2378-2386` | consumer's own config; the scene API stub becomes an option | 8a |
| ⚠ `plugins: [… react(), tailwindcss() …]` | `vite.config.ts:2356-2365` | the plugin adds **neither** — the host already has both | 8a |
| ⚠ two HTML entries + the package's own Vite root | `vite.config.ts:2366-2377` | prebuilt shell served by `configureServer` — see below | 8a |
| `@import "../../frontend/src/index.css"` + `@source "../../frontend/src"` | `src/sandbox.css` | shell CSS prebuilt and self-contained; the *frame* keeps using the host's stylesheet | 8a |
| the safelist file the shell CSS imports | `vite.config.ts:213-250,2308` | virtual `@source` injected into the host's stylesheet — see below | 8a |
| ⚠ `ALLOWED_EXT = .json .css .ts .tsx` — the write allowlist | `vite.config.ts:892` | add `.js`/`.jsx`. Found while porting 8a, and it is not cosmetic: the frame propagates `.js`/`.jsx`, the stamper stamps `.jsx`, `parse()` reads either as TSX — and then the write is refused at the last step, so a JavaScript consumer watches the editor locate the node, preview the diff, and refuse to save. `.mjs` stays out (no JSX convention, and it is where this package's own engine modules live) | 8a |
| ⚠ `stripFrameQuery` rebuilds the query with `URLSearchParams` | `vite.config.ts:576-583` | split on `&` and filter. `URLSearchParams` is lossy for Vite's VALUELESS flags — `new URLSearchParams('import').toString()` is `'import='`, and Vite matches those flags by pattern on the raw id, so the added byte un-sets the flag (measured: `/(\?\|&)import(&\|$)/` matches `?import`, not `?import=`). Latent in the prototype because every call site split the result on `?` and used only the file half | 8a |
| `@/components/theme-provider`, `@/app/Layout` | `src/scenes/providers.tsx:40-42` | `options.providers` | 8a option · 8c impl |
| `TOKENS_CSS = packages/core/dist/tokens.css` | `vite.config.ts:188`, used at `768,1899` | ⚠ `TokenRegenResult.artifacts`, not `emit()` — the adapter NAMES the file to invalidate and push, because only it knows where its emitter wrote. `emit()` writes nothing | 8b |
| ⚠ `WATCHED_RE = /^packages\/(frontend\/src\/\|core\/…)/` | `vite.config.ts:912`, **seeded at `1798-1803`** | `TokenAdapter.sources()`. The regex itself was already gone in 8a, which replaced it with "tracked = files we have read" — but 8a dropped the SEED, and that is the half that mattered: without it, editing the stylesheet in your own editor before ever opening the token panel is unreported, and the first token save then fails against a value it never saw. Restored in 8b from `sources()` | 8a partly · 8b |
| `BUILD_CSS_FILE` / `THEME_CSS_FILE` | `vite.config.ts:1124,1132` | `TokenAdapter.plan()` | 8b |
| `isTokenSourcePath()` regex on `packages/core/**` | `vite.config.ts:1342` | `TokenAdapter.sources()`. Also wrong in the other direction: it matched by PATTERN, so a file that merely looked like a token source triggered a regeneration | 8b |
| `SEMANTIC_FILE` / `PALETTE_FILE` / `RADIUS_FILE` / `TYPOGRAPHY_FILE`, and the `FAMILY` map keyed on them | `vite.config.ts:1126-1129,1141-1187` | `TokenAdapter.plan()` / `read()` | 8b iface · 8c impl |
| ⚠ `FRONTEND_SRC = 'packages/frontend/src'` + an `@/` prefix, **compiled into client code** | `src/scenes/import-paths.ts:24,41` | `AliasEntry[]` from `GET /health`, derived from the consumer's own resolved `config.resolve.alias`. Found while porting 10a, and it is the same shape as the `edits.ts` row below: a client-side duplicate of a fact only the server knows. Not cosmetic — a project whose alias is `~` or `#app` resolved nothing, and a mis-resolved drill-in target produces an **empty outline**, which reads as "this component has no editable nodes" rather than as a bug. Reading Vite's own resolved alias rather than adding a `designEditor({ aliases })` option is deliberate: an option can drift from the config that actually resolves the consumer's modules | 10a |
| ✅ the same four paths again, **compiled into client code** | `src/sandbox/edits.ts:116-119` | server-supplied token metadata, as `TokenFamilyMeta` from `GET /tokens`. 8b made the metadata available and settled the reason the copy existed — `FAMILY` expressed each naming rule as a FUNCTION (`` cssVar: (k) => `--wb-${k}` ``), and a function cannot cross the wire. Every one of the four is prefix-plus-kebab, checked rather than assumed, so `cssVarPrefix` / `themeVarPrefix` / `utilityPrefix` carry the same rules as data. **Closed in 9b**, and it closed further than "read the path from the server": the server never wanted a path at all — see below | 8b server · 9b client |
| `regenerateTokensCss` + the `build-css.ts` preview worker | `vite.config.ts:799-812,823-890` | ⚠ **two methods, not one** — `regenerate()` re-runs the emitter for real, `emit()` renders the preview map from patched text. See §4 | 8b iface · 8c impl |
| `react`, `react-dom`, `@wafflebase/core` as `dependencies` | `package.json` | React → `peerDependencies`; core → gone from the published package | 8a React · 8c core |

Four of these are behaviour changes, not renames:

- **Serving the shell.** Today the package *is* a Vite app: its own root, its own
  `react()` and `tailwindcss()` in the `plugins` array, and two HTML entries. As a
  plugin it must serve `index.html` and `scene.html` from **prebuilt** assets via
  `configureServer` middleware, so the consumer's Tailwind and React never process
  the shell. The `?wbFrame=` machinery survives unchanged, because it is already
  implemented as a plugin rather than as config.
- **The Tailwind safelist.** `candidates.ts` registers runtime-composed classes
  by appending `@source inline(...)` to a generated file that `sandbox.css`
  imports (engine §7.7, recipe §2.10). In a consumer project those candidates
  must reach the **host's** Tailwind graph, which means the plugin injects a
  virtual `@source` into the host's stylesheet — and no-ops entirely when the
  host is not Tailwind v4.
- **`ENGINE_SRC_ROOTS` becomes a capability, not a move.** It is not an alias
  list: it marks trees that are resolved and served but never re-queried per frame
  side, because doing so doubles every canvas scene mount for byte-identical
  content. Every consumer with a large non-JSX subtree wants that; only the four
  wafflebase paths are ours. So the *option* is generic (`opaqueRoots`) and only
  its value moves to `design-sandbox`.
- **`cssVariables` is new code, not a port** — mostly. The prototype has no
  single-stylesheet implementation, so the default adapter had to be **written**
  and is the one with no reference behaviour to diff against. ⚠ But the `@theme
  inline` third of it turned out to be already generic and reusable verbatim; see
  [§4](#4-the-tokenadapter-seam--the-central-constraint) for what was actually
  missing.

**Where the seam actually falls.** The natural reading of this table is that the
plugin host is `vite.config.ts` and the `TokenAdapter` is `edits.ts`. It is not:
seven of the token rows are *inside* `vite.config.ts`, and they are threaded
through the same machinery the host PR must port —

| site | what the token pipeline does there | where it went in 8b |
| --- | --- | --- |
| `mutationBridge` `1798-1803`, `1899` | the observe/watch list *is* the four token files + the theme CSS + `TOKENS_CSS` | seeded from `sources()` in `configureServer`; artefacts pushed from `TokenRegenResult` |
| `mutationBridge` `1909-1915`, `2000-2015` | two endpoints read all four files; `/preview-tokens` diffs `renderTokenVars(patched)` against base | `GET /tokens` → `read()`; `POST /preview-tokens` → `emit(patched)` vs `emit(base)` |
| `filesForIntent` `1354` | a token intent's file set is `FAMILY[…].file + BUILD_CSS_FILE + THEME_CSS_FILE` | `planTokenIntent` → `plan()`, de-duplicated and re-checked through the path guard |
| `applyIntentToCache` `1465-1467` | the three-point write | `applyTokenPlan`, staging the writes so a failed required one leaves the cache untouched |
| `restoreTransaction` `1564-1565`, commit `2084`, `2263` | `isTokenSourcePath` gates the CSS regen | `maybeRegenerate(adapter, writtenRels)`, on `/mutate`, `/commit`, `/undo` and `/redo` |

`edits.ts:116-119` is only the **client's duplicate** of the four paths — the
smaller, downstream half. So a file-shaped cut leaves the whole token pipeline in
the host PR, which is why [§8](#8-rollout) cuts by *pipeline* instead.

⚠ **Which 8c rows actually landed, and why the rest waited.** 8c took the
*pipeline* rows — `FAMILY`, `regenerateTokensCss`, the `build-css.ts` preview
worker, `@wafflebase/core` leaving the published package — plus
`scenes.config.json`, `opaqueRoots`' value, and the consumer `vite.config.ts` that
demonstrates the whole table. It did **not** take the alias/shim group: the `@` and
`@wafflebase/*` aliases, the app-libs aliases into
`packages/frontend/node_modules`, `optimizeDeps.include`, the `define` globals, the
antlr4ts `util`/`assert` shims, `yorkieOffline()`, and `react()` /
`tailwindcss()`.

Every one of those justifies itself by a **scene** — "the DOM documents scene
reaches the engines transitively", "`providers.tsx` imports `MemoryRouter`",
"`yorkie-offline.tsx` needs an escape specifier" — and the scene runtime is PRs
10–12. Porting them in 8c would have landed config that no test and no dev server
exercises, whose comments assert things about files that do not exist. They land
with the code that needs them, where the reasoning can be checked rather than
inherited. `opaqueRoots` is the exception because it is the row this table uses to
illustrate its own goal: a generic option whose *value* alone is ours, and inert
without scenes either way.

`react()` / `tailwindcss()` also carried a measurable cost:
`@vitejs/plugin-react`'s babel tree moved 39 lines of `pnpm-lock.yaml` for a PR
whose subject is a token adapter. "Port it now, use it later" is not free.

⚠ **One coupling this enumeration missed, found in 8b.** For the value kinds
(`token-value` / `token-rebind` / `palette-value`) the prototype took the target
file from the **client**: `filesForIntent:1354` falls through to `intent.file` when
there is no anchor, and `applyIntentToCache:1501` independently re-derives it with
`path.resolve(REPO_ROOT, intent.file ?? "")`. Only the member kinds consulted the
pipeline's own `FAMILY[…].file`.

This was not an escape — `filesForIntent` runs `resolveSafe` first on every path
that reaches the apply, so the containment check was always in front of it. It is
the same *shape* as the `stripFrameQuery` row above: latent, and safe only because
every call site happened to be. What it did mean is that the **choice** of file was
the client's, bounded by nothing but the extension allowlist — so a request naming
any `.ts`/`.tsx`/`.css` file under the root would have `applyTokenValue` run against
it. In 8b a token intent's `file` field is ignored outright: the adapter is
authoritative, and every file it names is re-checked through the guard, because an
adapter is consumer code too.

⚠ **8c extended that to `constName`, and found a silent preview bug.** The same
"the client chose it" shape survived in one more field: `applyTokenValue` needs a
const name, and `semantic.ts` is `export const semantic = { light, dark }` built
from two separate top-level consts, so the prototype took `light` / `dark` from the
request. `wafflebaseCore` derives it from `edit.theme` instead, and the client's
`constName` is ignored — the same rule, now with nothing left outside it.

The bug was in the other half of the same table. The prototype's `FAMILY` wrote
emitter expressions as `` radius.${camel} `` and `` typography.${camel} ``. Both
compile and both produce a correct `tokens.css`, because `build-css.ts` imports all
four token objects at module level — so nothing fails loudly. But the emitters also
receive them as a `src` parameter, and *that* is what `preview-tokens.mts`
evaluates: `src` is the patched text, the module import is the file on disk.
Measured, patching `radius.base` to `9rem`, `['--radius', src.radius.base]`
previews `9rem` while a bare `radius.base` previews the on-disk `0.3rem` — and for
a token that does not exist on disk yet, `undefined`. The preview silently stops
agreeing with what a save writes, which is the one property that worker exists to
guarantee. The correct prefix comes from each emitter's own body (`m.` for
`semanticBlock`, `palette.` for `paletteBlock`'s destructure, `src.radius.` /
`src.typography.` for `rootOnlyBlock`), not from the token's name; the prototype
was right for two of four, by luck of the destructuring.

⚠ **A live risk got fresh evidence.** The Risks section below prescribes moving
`.bak` backups into `node_modules/.cache/wafflebase-design-editor/`. That is still
unimplemented — `PathGuard.backup` writes `${file}.bak` beside the source — and
8c's `verify-tokens.mjs --write` demonstrated it by littering three untracked files
into `packages/core` and `packages/frontend` on every run. The script cleans up
after itself; the fix belongs in `paths.ts` and is not the sandbox's to make.

### 7. What this replaces

The Phase 4 roadmap entry ("convert approved intents into a branch + commit + a
GitHub PR") is **withdrawn**. Its motivation was that a hosted editor has no
other way to return work to the user. A local plugin writes to the working tree,
so the user's own `git diff` / `git commit` is the review surface — better than
a generated PR, and it deletes the entire credential surface (GitHub App,
installation tokens, secret storage) from the MVP.

What survives from Phase 4 is the **agent loop**, which was always the valuable
half and remains unbuilt: `AgentPopover.onSubmit` is still a `console.log` stub,
and `anchors.ts#planRebase` / `history.rebaseAnchors` are written and tested with
no callers. The intended shape:

> selected node's anchor + `GET /metadata` → agent → proposed intents →
> **every intent through `POST /validate` before staging** → `EditState` →
> `ReviewApproveModal` → save.

The agent's model key is read from the consumer's environment by the **dev-server
process only**. It must never reach the browser: the scene frame runs the
consumer's own application code, and a key readable there is a key exposed to
every dependency they have.

### 8. Rollout

The existing 24k-line `feat/design-system` branch lands as a series of PRs, each
held under ~1,500–2,000 lines of *total diff* — tests included, which for the
engine modules dominated: the prototype ships zero tests, and every one was
written fresh at a measured 3.2× (#718) to 4.8× (#738) multiplier on source. That
cap is what sets the granularity.

**The engine is complete and merged.**

| PR | Contents | State |
| --- | --- | --- |
| 1 | These docs | **merged** (#701) |
| 2 | Shared-code changes + package scaffolding | **merged** (#717) |
| 3 | `jsx-nodes.mjs` + tests | **merged** (#718) — published API |
| 4 | `stamp.mjs` + tests | **merged** (#738) — published API |
| 5 | `extract.mjs` + tests | **merged** (#758) |
| 6 | `inject.mjs` layout half + tests | **merged** (#776) — writes to consumer disks |
| 7 | `inject.mjs` token half + tests | **merged** (#777) — completes the mutator |
| 7b | `classNameExpr` — surfacing the class-rewrite refusal (engine §5.7) | **merged** (#787) |
| 8a | plugin host, **layout only** | **merged** (#819) |
| 8b | the `TokenAdapter` seam | **merged** (#833) |
| 8c | `packages/design-sandbox` — the token half | **merged** (#839) — see below |
| 9a | bridge client (`bridge` · `states` · `property-labels`) | **merged** (#846) — see below |
| 9b | `edits.ts` | **merged** (#848) — see below |
| gate | `fixtures/consumer` + `verify-consumer.mjs` | **merged** (#849) — see above |
| 9c | `history` · `anchors` | held |
| 10a | frame protocol · drill-in resolver · the alias seam | in review — see below |
| 10b | `frame-picker` · `hmr-state` — the frame's DOM runtime | next |
| 10c | `SceneHost` + outline/detail/class-editor + `scene-entry` | held — lands React |
| 11–12 | token panels, shell chrome, canvas | held |

PRs 2–7b are the files the generalization work depends on and does not edit, so
review and MVP work proceeded in parallel. `vite.config.ts` and `edits.ts` were
deliberately *not* reviewed in their current form: every repo-absolute constant in
them is scheduled for rewrite, and reviewing 2,538 lines of soon-to-be-deleted
path handling spends reviewer budget on nothing.

#### PR 8 splits in three, by pipeline — not by file

The obvious cut is one PR per file: the host is `vite.config.ts`, the adapter is
`edits.ts`. [§6](#6-the-couplings-that-must-become-configuration) shows why that
fails — the token pipeline's server half is *inside* `vite.config.ts`, threaded
through `mutationBridge`, `filesForIntent`, `applyIntentToCache` and
`restoreTransaction`. A file-shaped 8a therefore carries the entire token pipeline
and still weighs ~2,500 lines, which buys none of what splitting is for, and its
halves fail the same way rather than differently.

So the cut follows the one that already worked for the module underneath it —
`inject.mjs` shipped as a layout half (#776) then a token half (#777):

- **8a — the plugin host, layout only.** `src/plugin/`: the `designEditor()`
  factory, `options.root` threaded through all 50 `REPO_ROOT` sites, the shell
  served from prebuilt assets by `configureServer`, the scene registry and
  manifest, the `?wbFrame=` frame machinery and stamping, the safelist as a
  virtual `@source`, `resolveSafe` + backups, transactions, and the **layout**
  endpoints. It *declares* `TokenAdapter` as a type and ships **no
  implementation**; a token intent or token endpoint answers "no token adapter
  configured". That refusal is not a placeholder — §3 already promises it as the
  steady state for any project outside the support matrix, where "the token panels
  degrade to empty rather than writing garbage".
- **8b — the token seam.** `src/tokens/`: the `TokenAdapter` contract typed for
  real (8a declared it with `unknown` in every payload position), its default
  `cssVariables` implementation (**new code** — see §4), the `:root` / `.dark`
  declaration primitive underneath it, the token intents routed through `plan()`,
  the `GET /tokens` and `POST /preview-tokens` endpoints, and the watch list and
  CSS-regen gate asking `sources()` instead of matching a `packages/core/**`
  regex. ⚠ `edits.ts`'s compiled-in paths are served but not yet *consumed* —
  there is no client code to de-hardcode until PR 9; see the row in §6.
- **8c — `packages/design-sandbox`, the token half.** The private package that
  finally gives population C a destination. It is last because it consumes both
  halves, and it did land minimally as this section predicted — though not along
  the line predicted. The guess was "adapter + providers"; what shipped is the
  adapter, the preview worker, `scenes.config.json`, `opaqueRoots`' value, the
  consumer `vite.config.ts`, and a live-server smoke script. `providers.tsx` did
  **not** ship, because it is loaded by a scene runtime that does not exist yet —
  the split is by *what has a consumer*, not by file. See the ⚠ note in
  [§6](#6-the-couplings-that-must-become-configuration).

  **8c is where the token half stopped being verified through fakes.** 8b could
  only reach `regenerate()` and multi-file plans through a fake adapter, because
  `cssVariables` writes one file and has no emitter. Here both run for real: the
  add-member plan spans three distinct files and round-trips byte-identically
  across all of them for all four families, and `regenerate()` runs
  `build-css.ts`. The suite is 94 tests in-package.

  It also closed 8a's gate gap, at least for the token pipeline.
  `scripts/verify-tokens.mjs` boots a real dev server and drives the full chain —
  Vite config load → plugin → `wafflebaseCore` → injector → warm `tsx` worker →
  real emitter — for **32 checks**, including a `--write` mode that saves, undoes
  and asserts the tree came back byte-identical. That is the first automated
  statement that the two halves *meet*: the unit suites on either side would not
  notice them failing to. It stays out of `verify:fast` / `verify:self` on the same
  grounds as the prototype's smoke scripts.
- **9a — the bridge client.** `@wafflebase/design-editor/client`: the browser half,
  as a subpath so importing it never reaches the plugin's `node:fs`. `BASE` moved to
  `src/base.ts` for that reason — the client needs the value and cannot import the
  module that declared it.

  **`bridge.ts` is a rewrite, not a port.** The prototype's `mutate.ts` called
  `/__design-sdk/*` and four routes the shipped bridge does not serve: `/introspect`
  (now `/tokens`, adapter-supplied), `/history` (now `/transactions`), and
  `/metadata` + `/scene-preview`, which belong to the scene runtime in PR 10. It
  also redeclared the intent and result types the server owns; the client imports
  them, so the two cannot drift.

  Driving it against a live dev server before writing the tests corrected the
  contract once: `/candidates` also returns `rejected` and `capped`, and both matter
  — a refused class generates no rule, so the preview renders unstyled with nothing
  on screen to say why.

  Three prototype files did **not** come with it. `candidates.ts` needs React, which
  this package does not depend on, and has no consumer until PR 10. `toast.tsx` is
  Shell UI by the table in §2. `registry.tsx` is wafflebase's own components — see
  the ⚠ there.
- **9b — the staged-edit model.** `src/client/edits.ts`: the staged-edit types, the
  class / token / layout → intent translators and their inverses, `saveDiff`, and the
  ordering rule. This is the contract PRs 10–12 are written against, which is why it
  ships before any panel that consumes it.

  **It closes §6's last open row, further than that row anticipated.** The plan was
  "read the four paths from `TokenFamilyMeta` instead of compiling them in". Building
  it showed the server never wanted a path: `tokenEditOf` does not read `intent.file`
  for any token kind, because the adapter derives the file from the FAMILY. So the
  client sends `family` and no path at all, and the naming rules it does need
  (`cssVarFor` / `themeVarFor` / `utilityFor`) are prefix composition over server data.

  **The defect that fell out of it.** The prototype sent `file` and no `family`, and a
  missing family defaults to `semantic` — so a **radius or typography value edit was
  planned against the semantic source**. Measured against wafflebase's own adapter:

  ```text
  radius     → semantic.ts [light.lg]   located=false  property lg not found
  typography → semantic.ts [light.body] located=false  property body not found
  ```

  It refuses rather than corrupting the wrong file, so nothing was ever written to the
  wrong place — but neither family could save at all, and the error names the right key
  in the wrong file, which is the least debuggable shape that failure could have taken.

  Two smaller inferences went the same way. The prototype decided "was this token
  reference-bound before?" by testing `fromRef.startsWith('palette.')`, which reads as
  a literal in any project whose reference layer is not called `palette`; the client
  now carries `TokenBinding['kind']`, which is the contract's own answer. And its
  private `camelToKebab` broke on every digit (`gray100` → `gray-1-0-0`) — the bug 8b
  had already fixed in `tokens/adapter.ts`, re-imported here rather than re-written.

  Four other things stayed on the client and are **not** couplings: `PendingClassEdit.file`
  (a `class-rewrite` genuinely addresses a source file), `insertedFp` (never sent — the
  wire has no `fp` on an insert; it exists to anchor the inverse), the ordering rule, and
  `editStateKey`'s hint stripping.

- **10a — the frame contract, the drill-in resolver and the alias seam.**
  `src/scenes/` behind a `./scenes` subpath, plus `src/plugin/aliases.ts`. A subpath
  of its own rather than part of `./client`: both run in a browser, but in DIFFERENT
  ones — `./client` is the shell talking to the dev server, and this is the contract
  the shell shares with a scene frame, which is a separate document in a separate JS
  realm. Folding them together would put the bridge client into every frame bundle.

  **PR 10 does not fit two PRs, and the numbers say so rather than a judgement.**
  The plan split it by line count; splitting it by *what each half needs* puts the
  React dependency in one place instead of two:

  | Layer | Lines | Blocker |
  | --- | --- | --- |
  | `frame-protocol` + `import-paths` | 249 | none — 10a |
  | `frame-picker` + `hmr-state` | 794 | a DOM test environment — 10b |
  | `SceneHost` + 3 panels + `scene-entry` | 1,805 | **React**, which this package does not depend on — 10c |

  **Two defects the port found.** The prototype's `sceneFrameUrl` returned
  `/scene.html?…`, correct when the editor *was* the Vite app with two HTML entries.
  `shellServer` maps exactly `/scene` under `BASE`, so measured against a live
  consumer server the old URL never reaches the shell middleware at all — it 404s in
  the CONSUMER's app, which is the one place a wrong answer reads as their routing
  bug rather than ours. And `FrameSide` was declared twice, here and in the wire
  protocol that already owns it; the port imports it, as 9a's client does with the
  intent types.

  The alias row is the more interesting one because it is a **new §6 entry found by
  porting**, and the same shape as the `edits.ts` row: a client-side duplicate of a
  fact only the server knows. See the table.

  **It also fixed the boundary guard 9b shipped.** That guard reported a false
  failure on this PR's own code: the word "import" in a doc comment started a match,
  the lazy clause scanned 28 lines, and it attached to the specifier of a genuinely
  type-only import — so a correct file was reported as value-importing `node:path`.
  Over-reporting is the safe direction against *missing* a leak, but a false failure
  blocks correct code, which is worse than what it was protecting against. Now
  line-anchored, with a clause that may not span a `;`.

**8a's intermediate is green, and that was checked rather than assumed.**
`vite.config.ts` imports nothing from `src/sandbox/` — only node builtins, `vite`,
`@vitejs/plugin-react` and `@tailwindcss/vite` — and the package has no client code
at all yet, so nothing consumes what 8a does not provide. The package gate is
`typecheck` + `test`, both satisfiable standalone. 8a adds `vite` and friends as
dev/peer dependencies; none is `@wafflebase/*`, so the boundary's mechanical test
still holds. What 8a cannot do is serve a *working* editor — the shell UI is PRs
10–12 — but that is already true of this ordering and is not introduced by the
split.

**Verification for 8a: the smoke scripts port as-is.** The prototype verifies the
bridge with scripts against a live dev server, not unit tests —
`verify-bridge.mjs` (18.9 KB), `smoke-scene.ts` (13.1), `smoke-canvas.ts` (12.1),
`smoke-layout.ts` (6.8) — so the engine modules' 3.2–4.8× test multiplier does not
transfer to plugin code. They move across unchanged in kind and stay out of
`verify:fast` / `verify:self`. **The cost is explicit: the plugin host lands with
no automated gate**, and a regression in it is caught by hand or not at all. That
is accepted to keep 8a reviewable, and it is the argument for a fixture-project
integration lane later — which would prove the pivot's central claim (that the
plugin works in a *foreign* project) and is worth its own PR.

**That gate now exists: `scripts/verify-consumer.mjs` against
`fixtures/consumer/`.** The fixture is a project with its own layout (`app/`, not
`packages/frontend/src/`), its own stylesheet and scene manifest, no
`@wafflebase/*` dependency, and — the point — **no adapter of its own**: it uses
the default `cssVariables()`, which §4 identifies as the common case. Its whole
configuration is four lines, against `design-sandbox`'s ~250-line `TokenAdapter`.
The script boots a real dev server there and drives health, tokens, preview, the
token value / add / class-rewrite mutations, candidates, the generated scene
module, two refusals and — under `--write` — a real commit, undo and
byte-identical restore: **40 checks**.

It is the first thing in the repository that can fail the way a stranger's
install fails, and it did so immediately. Booting with `cwd` alone was not enough:
`pnpm exec` runs from the nearest package root, so vite's root became
`packages/design-editor`, it found no config, **every plugin went unloaded, and
the dev server started cleanly and answered 404 to the whole bridge**.
`verify-tokens.mjs` cannot hit that — its package root and its Vite root are the
same directory. The gate asserts `health.root` for exactly this reason, and the
script now names both explicitly — the root as `vite dev`'s **positional**
argument (`--root` is build-only and the CLI rejects it outright) plus `--config`.

Checked by breaking the fixture four ways: dropping the adapter degrades to §3's
"no token adapter configured" and fails 9 checks; dropping the scene manifest
fails 4; renaming the consumer's CVA fails the class rewrite. A `./` prefix on
the configured stylesheet does **not** fail — `normaliseSource` already handles
it, which is 8b's fix holding.

It stays out of `verify:fast` / `verify:self` on the same grounds as
`verify-tokens.mjs`: it boots a dev server.

**8b does NOT inherit that gap, and that is the argument for doing the default
adapter before the wafflebase one.** `cssVariables` and its CSS primitive are pure
text-in/text-out, and the routing is testable against a real temp-dir filesystem —
so unlike 8a's middleware, this half needs no live dev server to verify. The suite
went 428 → 555 tests. Two properties are worth naming because they are what make
the tests a specification rather than a smoke check: the add → remove round trip
asserts the stylesheet is **byte-identical** to where it started, and
`applyTokenPlan`'s staging is exercised through a fake adapter, because
`cssVariables` happens to order its required write first and would leave the
interesting failure untested.

Every non-obvious guard was also checked by reverting it and confirming exactly the
expected tests fail. That is what found the bugs rather than reasoning about them —
and once, what found a **bad test**: an assertion about indentation passed whether or
not the code under it worked, and probing why exposed the real defect underneath.
A declaration FOLLOWING a comment was dropped entirely. A pending declaration's span
begins after the previous `;`, so a `/* Brand */` group header lands inside it,
becomes part of the property name, and the whole declaration fails the `--` test —
invisible to the editor and unwritable. Group headers are ordinary in a hand-authored
stylesheet, so that was the common case, not an edge one. The same reversion
discipline then showed one guard was unreachable by the suite, which was fixed by
finding the input that reaches it (a one-line `:root { --a: 1px; }`, where the
removal's walk-back would otherwise delete the selector) rather than by noting the
gap.

What 8b could not verify is `wafflebaseCore`: it did not exist until 8c, so
`regenerate()` and multi-FILE plans were exercised only through fakes. **8c closed
that**, and the fakes turned out to have hidden nothing about the plugin — but the
real implementation did surface two defects in the pipeline they stood in for (the
emitter-expression preview divergence and `constName` authority, both in §6) plus a
missing field in the contract itself (§4). A fake proves the plugin handles the
shape; only the real pipeline proves the shape is right.

**Stacking.** PRs 3 and 4 are stacked, because `stamp.mjs` imports
`jsx-nodes.mjs`. An earlier revision of this section required them to be
sequential, on the grounds that `agent-review-panel.yml` hardcodes
`origin/main...HEAD` as its diff base and would hand a stacked PR the cumulative
diff. That rationale no longer applies: the panel does not run on this series at
all, refused independently by its fork check (`head_repository.full_name ==
github.repository`) and by its `agent/`-prefix-or-label gate. The *symptom*
survives in GitHub's own UI — #738 reads as 1,851 additions when its own delta
is 408 — which is a cosmetic cost, noted in the PR body.

The stacking is not a general pattern. `extract.mjs` and `inject.mjs` both
import `jsx-nodes.mjs` and neither imports the other, so once #718 merges, PRs 5
and 6–7 branch from `main` as siblings and review in parallel.

Because the repo squash-merges, **order matters**: merging a later PR in a stack
first folds the earlier one into it under the wrong title and leaves it open with
an empty diff. 8a → 8b → 8c *is* a stack — 8b fills a seam 8a declares, and 8c
implements an interface 8b defines — so all three are strictly ordered.

---

## Risks and Mitigation

**The configuration cliff makes adoption fail.** Authoring a scene manifest,
providers module and fixtures for a foreign app may cost hours.
*Mitigation:* prove it against a fresh `create-vite` + Tailwind v4 + shadcn
project in week 1, before the agent loop. Treat >1 hour as a redesign trigger for
the configuration surface, not as documentation debt.

**We write to a stranger's working tree.** `resolveSafe` + `.bak` backups are the
right shape but were built for our own repo — and the backups land in the
consumer's source directories, where our `.gitignore` entry cannot reach.
Wafflebase's own tree already carries stray `.bak` files as evidence.
*Mitigation:* backups move to `node_modules/.cache/wafflebase-design-editor/`;
refuse every write resolving outside `options.root`; record the HEAD sha in each
transaction so "undo" is meaningful against a moving tree.

**The model key leaks into the frame.** *Mitigation:* env-only, dev-server-side,
proxied through the bridge; never serialized into any client bundle, never
written to disk, never echoed in a transaction log.

**Publishing freezes contracts.** `jsx-nodes.mjs`'s child numbering, the intent
types in `mutate.ts`, and `frame-protocol.ts`'s messages become compatibility
surface the moment they hit npm. Engine §2 already warns that two implementations
of the numbering would drift and land edits on the wrong node *silently*.
*Mitigation:* PRs 3 and 4 get undivided review; version the frame protocol before
the first publish.

**24,248 lines are currently ungated.** No root script or CI job references the
package — `smoke`, `verify:bridge` and `verify:frame` all exist and none of them
run in CI.
*Mitigation:* PR 2 wires `typecheck` + `smoke` into `verify:fast`, before the
mutator PRs land.

**The token half strands non-shadcn consumers.** *Mitigation:* accepted and
scoped — §3 states the support matrix, and the layout/scene half degrades
independently, so the editor stays useful with the token panels empty.
