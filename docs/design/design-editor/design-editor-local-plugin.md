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
| Bridge client | `mutate.ts`, `states.ts`, `anchors.ts`, `history.ts`, `candidates.ts`, `registry.tsx` |
| Frame + host | `frame-protocol.ts`, `SceneHost.tsx`, `frame-picker.ts`, `hmr-state.ts`, `import-paths.ts`, `SceneOutline.tsx`, `SceneNodeDetail.tsx`, `FloatingClassEditor.tsx` |
| Shell UI | the panels, modal, combobox, accordion, toast, `SandboxLayout.tsx` |

**B — Coupled today, must become configuration.** Enumerated in
[§6](#6-the-couplings-that-must-become-configuration).

**C — Wafflebase-only. Moves to `packages/design-sandbox`, never published.**

`yorkieOffline`, `antlr4tsAssertShim`, `src/scenes/canvas/**` (including the
`seed-*.ts` fixtures), the `packages/{sheets,docs,slides,notes}/src` aliases,
`src/scenes/fixtures/**`, `data/mock-metadata.ts`, `scenes.config.json`,
`src/scenes/providers.tsx`.

> **`packages/design-sandbox` does not exist yet** — not on `main`, and not on
> `feat/design-system` either. Every "moves to `design-sandbox`" in this document
> is a destination that PR **8c** creates, so until it lands, population C has
> nowhere to go: the plugin PRs *delete* those couplings and wafflebase's own
> scenes stop rendering in the interval. That is the cost of the boundary being
> structural, and it is the reason 8c is scheduled rather than assumed — the
> dogfood is also the only proof the split holds.

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
    ├── scenes.config.json
    ├── src/providers.tsx
    ├── src/fixtures/**
    ├── src/canvas/**               # yorkie-offline shim + seeds + engine probes
    └── src/tokens/core-adapter.ts  # the @wafflebase/core four-file pipeline
```

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
- **`wafflebaseCore` (lives in `design-sandbox`)** — the existing four-file
  pipeline, the `build-css.ts` worker, and the three-point `token-add`. It stays
  exactly as built; it just stops being the assumption.

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
| ⚠ the same four paths again, **compiled into client code** | `src/sandbox/edits.ts:116-119` | server-supplied token metadata, as `TokenFamilyMeta` from `GET /tokens`. **This row can only half-close in 8b**: 8a shipped no client code at all, so there is no `edits.ts` yet to de-hardcode. 8b makes the metadata available; the client stops carrying its own copy when it arrives in PR 9. What 8b *did* settle is the reason the copy existed — `FAMILY` expressed each naming rule as a FUNCTION (`` cssVar: (k) => `--wb-${k}` ``), and a function cannot cross the wire. Every one of the four is prefix-plus-kebab, checked rather than assumed, so `cssVarPrefix` / `themeVarPrefix` / `utilityPrefix` carry the same rules as data | 8b server · 9 client |
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
| 8b | the `TokenAdapter` seam | next — see below |
| 8c | `packages/design-sandbox` | after 8b |
| 9 | client state (`mutate` · `history` · `anchors` · `states`) | held |
| 10–12 | frame + scenes, shell chrome, token panels, canvas | held |

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
- **8c — `packages/design-sandbox`.** The private package that finally gives
  population C a destination: the `wafflebaseCore` adapter, `yorkieOffline`,
  `antlr4tsAssertShim`, the aliases, `providers.tsx`, `scenes.config.json`. It is
  last because it consumes both halves, and because the scene files it needs are
  themselves PR 10–12 material — so it may land minimally (adapter + providers)
  and grow.

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

What 8b still cannot verify is `wafflebaseCore`: it does not exist until 8c, so
`regenerate()` and multi-FILE plans are exercised only through fakes. The one
implementation that shells out to a real emitter arrives with the package that
owns it.

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
