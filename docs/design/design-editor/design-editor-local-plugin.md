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

**Target layout**

```
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

**The one-way dependency, restated.** Engine §1 currently says "nothing ever
imports `design-sdk`", which was load-bearing for the frontend chunk budget.
Under the split the rule becomes directional rather than absolute:

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
  /** Files whose change invalidates token state (replaces the WATCHED_RE regex). */
  sources(): string[];
  /** Read the current token tree the editor renders and binds against. */
  read(readFile: (rel: string) => Promise<string>): Promise<TokenTree>;
  /** Turn one token edit into the file writes it implies — one file, or four. */
  plan(edit: TokenEdit): TokenWrite[];
  /** Emit the CSS the preview applies, by running the project's REAL emitter. */
  emit(files: Record<string, string>): Promise<TokenVars>;
}
```

Two implementations:

- **`cssVariables` (default, ships in the package)** — one stylesheet, `:root` /
  `.dark` blocks, `@theme inline`. `plan()` returns a single write. Covers the
  shadcn population.
- **`wafflebaseCore` (lives in `design-sandbox`)** — the existing four-file
  pipeline, the `build-css.ts` worker, and the three-point `token-add`. It stays
  exactly as built; it just stops being the assumption.

`plan()` returning a list is what keeps the three-point edit expressible without
leaking into core. The existing atomic-intent-group machinery (engine §5.8)
already guarantees all-or-nothing application, so multi-file plans need no new
transaction semantics.

### 5. Configuration surface, and the real onboarding cliff

```ts
// consumer's vite.config.ts
import { designEditor } from '@wafflebase/design-editor'

export default defineConfig({
  plugins: [
    react(),
    designEditor({
      root:      process.cwd(),          // write boundary; nothing outside is writable
      scenes:    './design/scenes.json', // which routes are editable
      providers: './design/providers.tsx',
      tokens:    cssVariables({ stylesheet: './src/index.css' }),
    }),
  ],
})
```

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
are given under the post-rename package name.

| Coupling | Where | Becomes |
| --- | --- | --- |
| `REPO_ROOT = path.resolve(__dirname, "../..")` | `vite.config.ts:15` | `options.root`, defaulting to Vite's `config.root` |
| `utilShimPath` / `assertShimPath` | `vite.config.ts:36-37` | drop — mirrors a frontend-specific plugin |
| `TOKENS_CSS = packages/core/dist/tokens.css` | `vite.config.ts:188` | `TokenAdapter.emit()` |
| `FRONTEND_SRC` + the `@` alias | `vite.config.ts:350` | consumer's own Vite `resolve.alias`; the plugin must stop adding its own |
| `packages/{sheets,docs,slides,notes}/src` aliases | `vite.config.ts:624-627` | move to `design-sandbox` |
| `WATCHED_RE = /^packages\/(frontend\/src\/\|core\/…)/` | `vite.config.ts:912` | `TokenAdapter.sources()` + the scene manifest's files |
| `BUILD_CSS_FILE` / `THEME_CSS_FILE` | `vite.config.ts:1124,1132` | `TokenAdapter.plan()` |
| `isTokenSourcePath()` regex on `packages/core/**` | `vite.config.ts:1342` | `TokenAdapter.sources()` |
| `SEMANTIC_FILE` / `PALETTE_FILE` / `RADIUS_FILE` / `TYPOGRAPHY_FILE` | `src/sandbox/edits.ts:116-119` | server-supplied token metadata — **these are wafflebase paths compiled into client code** |
| `@import "../../frontend/src/index.css"` + `@source "../../frontend/src"` | `src/sandbox.css` | shell CSS prebuilt and self-contained; the *frame* keeps using the host's stylesheet |
| `@/components/theme-provider`, `@/app/Layout` | `src/scenes/providers.tsx:40-42` | `options.providers` |
| `react`, `react-dom`, `@wafflebase/core` as `dependencies` | `package.json` | React → `peerDependencies`; core → gone from the published package |

Two of these are behaviour changes, not renames:

- **Serving the shell.** Today the package *is* a Vite app with its own root,
  its own Tailwind and two HTML entries. As a plugin it must serve `index.html`
  and `scene.html` from **prebuilt** assets via `configureServer` middleware, so
  the consumer's Tailwind and React never process the shell. The `?wbFrame=`
  machinery survives unchanged, because it is already implemented as a plugin
  rather than as config.
- **The Tailwind safelist.** `candidates.ts` registers runtime-composed classes
  by appending `@source inline(...)` to a generated file that `sandbox.css`
  imports (engine §7.7, recipe §2.10). In a consumer project those candidates
  must reach the **host's** Tailwind graph, which means the plugin injects a
  virtual `@source` into the host's stylesheet — and no-ops entirely when the
  host is not Tailwind v4.

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

The existing 24k-line `feat/design-system` branch lands as sequential PRs.
Sequential, not stacked: `agent-review-panel.yml` computes
`git diff origin/main...HEAD` with the base hardcoded, so a PR based on another
feature branch receives the cumulative diff rather than its own.

| PR | Contents | State under the pivot |
| --- | --- | --- |
| 1 | These docs | — |
| 2 | Shared-code changes + package scaffolding | stable |
| 3 | `jsx-nodes.mjs` + `extract.mjs` + `stamp.mjs` | stable — published API |
| 4 | `inject.mjs` | stable — published API, writes to consumer disks |
| — | *generalization refactor (§6)* | rewrites the below |
| 5+ | plugin host, client state, shell UI, scenes, canvas | **held** until after §6 |

PRs 2–4 are the files the generalization work depends on and will not edit, so
review and MVP work proceed in parallel. `vite.config.ts` and `edits.ts` are
deliberately *not* reviewed in their current form: every repo-absolute constant
in them is scheduled for rewrite, and reviewing 2,538 lines of soon-to-be-deleted
path handling spends reviewer budget on nothing.

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
