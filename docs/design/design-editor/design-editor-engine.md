---
title: design-editor-engine
target-version: 0.6.2
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Design Editor — Engine / Tooling Spec

> **Scope.** This document specifies the reusable *engine* inside
> `packages/design-editor`: the dev-only mutation bridge, the AST mutator, the
> introspection protocol, and the Vite integration that hosts them. It is
> derived strictly from the current source, not from design intent.
>
> **Companion docs:**
> [`design-editor-sandbox-recipe.md`](./design-editor-sandbox-recipe.md) describes the
> *frontend* editor UI that drives this engine.
> [`design-editor-local-plugin.md`](./design-editor-local-plugin.md) records the
> **local-plugin pivot** and the package boundary this engine is being split along.
>
> **⚠️ Read the pivot doc before extending anything here.** Everything below
> describes the engine as it runs *inside this monorepo*, where `REPO_ROOT` is
> wafflebase and the token pipeline is `@wafflebase/core`'s four files. The
> product is now a plugin installed into *someone else's* Vite project
> ([`design-editor-local-plugin.md`](./design-editor-local-plugin.md) §2), so
> every repo-absolute path in §4, §7.5 and §7.6 is a coupling to be replaced by
> configuration, not a fact to build on.

---

## 1. First principle: the one-way dependency

`packages/design-editor` **imports from** `@wafflebase/frontend` source (via the `@`
alias) and `@wafflebase/core`, but **nothing ever imports `design-editor`**. This
is load-bearing:

- The frontend production bundle — and therefore the `verify:frontend:chunks`
  budget — is never affected by anything built here.
- The engine's file-writing middleware runs **only under `vite dev`**
  (`apply: "serve"`); it ships in no build.
- Build output lands in `packages/design-editor/dist`, which the chunk gate does
  not scan.

The package adds **zero new runtime dependencies** to the monorepo. Everything
is built on `typescript` (already a workspace dep), React 19, Vite 6, and
Tailwind v4 — see `packages/design-editor/package.json`.

---

## 2. Package layout

```text
packages/design-editor/
├── index.html                     # Vite entry; mounts #root, loads /src/main.tsx
├── scene.html                     # SECOND Vite entry — one JS realm per scene frame (§7.8)
├── vite.config.ts                 # Dev server + mutationBridge() plugin (THE ENGINE HOST)
├── tsconfig.json                  # `@/*` → ../frontend/src/*; strict; src-only
├── package.json                   # No frontend import; deps: core, react, lucide
├── scripts/
│   ├── extract-design-metadata.mjs  # CLI wrapper over src/server/extract.mjs
│   ├── smoke-layout.ts            # pure-logic checks: the ORDERING RULE (§5.9)
│   ├── smoke-scene.ts             # pure-logic checks: stamp ids, drill-in paths,
│   │                              #   fixture layering, the 3 anchor outcomes
│   ├── smoke-canvas.ts            # CP4: the one-realm CRDT invariant + the
│   │                              #   sheets fixture re-derived from the engine
│   ├── verify-bridge.mjs          # live round-trips §8.1 6/9/10/11/12/12a/14/16–24
│   ├── crawl-frame-graph.mjs      # every module a frame imports resolves (§9)
│   └── poke-scene-preview.mjs     # stage a layout edit by hand (no inspector yet)
├── scenes.config.json             # COMMITTED scene manifest (which routes are editable)
└── src/
    ├── main.tsx                   # createRoot → <SandboxLayout/>; imports sandbox.css
    ├── scene-entry.tsx            # THE FRAME ROOT: sandbox.css → fetch guard → scene
    ├── sandbox.css                # @import frontend index.css + @source + safelist
    ├── types.ts                   # DesignMetadata / ComponentMeta / SceneMeta shapes
    ├── SandboxLayout.tsx          # UI root + single source of truth (see RECIPE)
    ├── data/mock-metadata.ts      # Bridge-offline FALLBACK only (live tree → §3.7)
    ├── generated/                 # GITIGNORED, written by the bridge
    │   ├── safelist.css           #   @source inline(...) per runtime-composed class
    │   └── design-metadata.json   #   component + scene AST metadata (§3.7)
    ├── server/
    │   ├── jsx-nodes.mjs          # THE JSX NODE MODEL — numbering, fp, resolveNode
    │   ├── inject.mjs             # THE AST MUTATOR (plain JS, runs in Node)
    │   ├── extract.mjs            # THE ANALYZER (components + scene node trees)
    │   ├── stamp.mjs              # THE DEV-ONLY data-wb-* TRANSFORM (§7.9)
    │   │                          #   (typed by JSDoc — see below, NOT by .d.mts)
    ├── scenes/                    # THE SCENE RENDERER (host half + frame half)
    │   ├── frame-protocol.ts      #   the ONE typed postMessage contract
    │   ├── SceneHost.tsx          #   host: iframe, viewport, picking, channels
    │   ├── frame-picker.ts        #   frame: capture-phase select, overlay, tokens
    │   ├── providers.tsx          #   REAL providers + the `shell: "app"` mount
    │   ├── fetch-fixtures.ts      #   the network kill-switch (§7.10) + Mock Data toggle
    │   ├── fixtures/              #   plain data keyed by URL — never JSX
    │   ├── import-paths.ts        #   import specifier → repo-relative file
    │   ├── hmr-state.ts           #   frame: focus/selection/scroll across a Fast Refresh patch (§7.12)
    │   ├── SceneOutline.tsx       #   source tree + drill-in + breadcrumb
    │   └── SceneNodeDetail.tsx    #   the 3 outcomes of click → baseline anchor
    └── sandbox/                   # UI components + the bridge client (mutate.ts)
        ├── mutate.ts              #   bridge client + intent/response types
        ├── edits.ts               #   pending-edit model, FAMILY_META, saveDiff
        ├── history.ts             #   editor undo/redo + reload persistence
        ├── anchors.ts             #   client mirror of resolveNode (rebasing)
        ├── states.ts              #   interaction-state model (parse/build/force)
        ├── candidates.ts          #   Tailwind candidate registration hook
        └── …                      #   panels, modal, combobox, accordion, toast
```

The five files that carry the design decisions on the client are `edits.ts`
(what an edit *is*, what writing it takes, and **in what order**), `history.ts`
(the editor's undo model and its lifetime), `anchors.ts` (how a staged layout
edit is re-pointed when the tree under it moves), `states.ts` (the two-tier
state story), and `candidates.ts` (why runtime-composed classes need the bridge
at all). They are documented from the UI side in `design-editor-sandbox-recipe.md`.

The **engine** is four files: `vite.config.ts` (the HTTP host + safety
boundary), `src/server/inject.mjs` (the AST mutator), `src/server/extract.mjs`
(the analyzer), and `src/server/jsx-nodes.mjs` (the JSX node model).
`src/sandbox/mutate.ts` is the browser-side client for the protocol.

### How the `.mjs` server modules are typed

They are plain JS carrying `// @ts-check` and JSDoc annotations, checked by
`allowJs` in the package tsconfig, with a `.mts` test per module as the consumer
side of the contract.

**Not by an adjacent `.d.mts`, which is what an earlier revision of this section
specified.** A declaration file sitting next to its implementation *shadows* it:
`tsc --listFiles` loads `stamp.d.mts` and drops `stamp.mjs` from the program
entirely, so the `// @ts-check` on its first line never runs and the declaration
is free to drift from the code it describes — the drift being invisible in
exactly the way this engine is built to prevent. Measured by planting one type
error in `stamp.mjs`: **0 errors with the declaration present, 3 without it**.

So `stamp.d.mts` was deleted rather than corrected, and `inject.d.mts` /
`extract.d.mts` must not be reintroduced when those modules land. Nothing is
lost: with `allowJs` on, a TypeScript importer gets the same signature from the
JSDoc, which is how `jsx-nodes.mjs` has always been consumed.

The `.mts` test earns its extension separately from the behavioural `.mjs`
suite. The pragma checks the annotations against the *implementation*; the
`.mts` file checks them against a *consumer*, importing exactly as the Vite
config's dynamic import does, so a signature that no longer matches how the
module is actually called fails `pnpm typecheck`. The behavioural suite cannot
stand in for it — being `.mjs` with no pragma, its call sites are never
type-checked.

> **`jsx-nodes.mjs` has three consumers and must never be reimplemented.**
> `walkJsx()` defines which child is index 2. The extractor emits paths with it,
> the injector resolves anchors with it, and the CP3 `data-wb-node` transform
> stamps with it. Two implementations of that numbering would drift, and the
> drift would surface as an edit landing on the wrong node — silently. It is also
> why `loadEsm()` busts on the MAX mtime across `src/server/*.mjs` rather than on
> the entry file's own (§7.2).

---

## 3. API protocol

All endpoints are served by the `mutationBridge()` Vite plugin
(`configureServer` middleware) under the `/__design-editor/` prefix. They exist
**only in dev**.

### 3.1 `GET /__design-editor/api/health`

Liveness probe for the UI's bridge-health indicator. Side-effect free and
GET-only, so the client can poll it without the `405` that hitting the
POST-only `/mutate` with GET produces.

```http
→ GET /__design-editor/api/health
← 200 {
    "ok": true,
    "sessionId": "30eb-ms5gu43c",
    "startedAt": 1785292125240,
    "fsRevision": 2,
    "externalChanges": [
      { "file": "packages/frontend/src/components/ui/button.tsx", "at": 1785307846132 }
    ],
    "tracked": 7
  }
```

The UI treats any 2xx as "bridge up" and a thrown fetch (server down) as "bridge
down". It polls every 10s.

**`sessionId` identifies the dev-server PROCESS** (`pid` + start time). It is the
lifetime key for the sandbox's persisted edit history: a page reload sees the
same id and restores, a dev-server restart mints a new one and the client
discards the stale stack. Nothing about the editor's history is stored
server-side — a persisted stack would outlive the files it describes and become a
corruption hazard (see `design-editor-sandbox-recipe.md` §6).

**`fsRevision` counts external changes.** This endpoint is not purely a probe: it
runs the mtime sweep described in §7.6 before answering, so polling it *is* the
detection mechanism for "someone edited a file my staged edits depend on".
`tracked` is how many files are being watched; `externalChanges` is a bounded
newest-first log. A staged edit remembers the text it expects to find, so any bump
means the client must re-validate (§3.5) rather than trust its plan.

### 3.2 `GET /__design-editor/api/introspect`

Parses the four token sources plus the frontend's Tailwind theme block
server-side (the browser cannot parse TypeScript) and returns each semantic
token's **current binding form**, the palette's colour leaves, the raw scale
values, and which tokens are reachable as utility classes.

```http
→ GET /__design-editor/api/introspect
← 200 {
    "ok": true,
    "sessionId": "30eb-ms5gu43c",
    "bindings": {
      "light": { "primary": { "kind": "palette", "ref": "palette.syrup" },
                 "secondary": { "kind": "literal", "value": "oklch(0.967 …)" },
                 "sidebarAccent": { "kind": "computed", "value": "`rgba(${palette.butterRgb}, 0.30)`" },
                 … },
      "dark":  { "primary": { "kind": "palette", "ref": "palette.syrupBright" }, … }
    },
    "colors": [
      { "ref": "palette.syrup", "path": ["syrup"], "value": "#B8651A", "isColor": true },
      { "ref": "palette.syrupRgb", "path": ["syrupRgb"], "value": "184, 101, 26", "isColor": false },
      { "ref": "palette.neutrals.light.ink", "path": ["neutrals","light","ink"], "value": "#2A1E12", "isColor": true },
      …
    ],
    "scales": {
      "radius":     { "base": "0.3rem", "sm": "calc(0.3rem - 4px)", … },
      "typography": { "display": "\"Fraunces\", ui-serif, Georgia, serif", … }
    },
    "themeMappings": ["--radius-sm", …, "--color-primary", …, "--font-code"]
  }
```

**`TokenBinding`** discriminant (`kind`):

| kind | fields | meaning |
|---|---|---|
| `palette` | `ref` | authored as `palette.<key>` (dotted) — bound to the foundation |
| `literal` | `value` | a raw string literal (`'oklch(…)'`) — a genuine neutral |
| `computed` | `value` | a template/expression (e.g. `` `rgba(${palette.butterRgb}, 0.30)` ``) — read-only in the editor |
| `other` | `value` | anything else |

**`PaletteColor`**: `{ ref, path, value, isColor }`. `isColor` is `false` for rgb
tuples (`syrupRgb`) so the UI can exclude them from colour pickers.

**`scales`** (`readConstLeaves` over `radius.ts` / `typography.ts`) and the
palette/semantic values above are collectively **the editor's source of truth for
"what is this token's current value"**. This matters more than it looks:

> **THE DEFAULT-VALUE RULE.** A token's current value is read from SOURCE, never
> from `getComputedStyle`. The editor previously snapshotted computed CSS
> variables once per theme switch, so the instant a write landed the panel was
> still comparing against the pre-write value — a value you had just saved read as
> an unsaved edit, and re-typing the *old* value read as clean. Introspection is
> re-fetched after every commit/undo/redo, so the newly written value simply *is*
> the new default. Computed CSS remains a fallback for `computed` bindings (which
> the editor cannot resolve) and for bridge-offline mode.

**`themeMappings`** is every custom property declared in the frontend's
`@theme inline` block. A `:root` variable is **not** a Tailwind utility:
`bg-brand-accent` only exists once `--color-brand-accent: var(--brand-accent)` is
declared there. The editor uses this to flag tokens that reach `tokens.css` but
have no utility class ("no utility" badge), and §5.5 keeps the alias in step
automatically when a token is created.

### 3.3 `POST /__design-editor/api/mutate`

The single-intent endpoint. A **discriminated request** by `kind`. `dryRun: true`
computes the edit + a unified diff **without touching disk** (drives the Review
& Approve modal); `dryRun: false` performs the real write.

**Request (`MutateRequest`)** — union over `kind`:

| `kind` | fields used | target |
|---|---|---|
| `class-rewrite` | `file`, `cvaName`, `axis?`, `value`, `replacements[]`, `additions[]`, `removals[]` | a CVA value literal in a component |
| `token-value` | `file`, `constName`, `path[]`, `tokenValue`, `valueKind?` | a semantic literal (neutral) |
| `token-rebind` | `file`, `constName`, `path[]`, `tokenValue` | rebind a semantic token to `palette.<key>` |
| `palette-value` | `file`, `path[]`, `tokenValue` | a `palette.ts` colour leaf (cascades) |
| `member-add` | `family`, `camelKey`, `kebabKey`, `tokenValue` | CREATE a token (three-file coordinated) |
| `member-remove` | `family`, `camelKey`, `kebabKey` | DROP a token (inverse of `member-add`) |
| `token-add` | *(legacy alias for `member-add` with `family: "semantic"`)* | — |
| `layout-props` | `anchor`, `sets?`, `classOps?`, `text?` | attributes / classes / text on one JSX node |
| `layout-insert` | `parent`, `index`, `raw`, `fp`, `verbatim?`, `imports?` | insert a subtree as a child |
| `layout-remove` | `anchor`, `imports?` | delete a node and its subtree |

Every intent may carry an optional **`groupId`**: members of a group **all apply
or none do** (§5.8). A *move* is not a fourth layout kind — it is a
`layout-remove` + `layout-insert(verbatim)` sharing a `groupId`, which reuses both
inverses and obeys the ordering rule unchanged.

Layout intents take their file from the **anchor**, not from `file`. That is what
keeps the three kinds byte-identical for DOM and Canvas scenes: an anchor names a
JSX node in a `.tsx`, and whether that node renders to a `<div>` or to a
`<canvas>` an engine paints into is invisible to the mutator.

- `file` is **repo-relative** and validated (see §6.4). For `member-*` kinds the
  `family` decides the files; any `file` in the request is ignored.
- `replacements` is `{ from, to }[]`; `additions`/`removals` are class-token
  arrays. All three are whole-token operations (§5.1).
- `path` navigates nested object props, e.g. `["neutrals","light","ink"]`.
- `valueKind` is `"literal"` (default, quotes the value) or `"expression"`
  (writes verbatim). `token-rebind` forces `"expression"` server-side;
  `palette-value` forces `"literal"`.

**Response (`MutateResult`)**:

```ts
{
  ok: boolean;
  located?: boolean;      // was the target AST node found + the edit applied
  file?: string;          // repo-relative path(s) acted on, ' + '-joined
  diff?: string;          // unified diff, one `# <file>` section per file touched
  backup?: string | null; // repo-relative `.bak` path (real writes only)
  regenerated?: boolean;  // tokens.css was rebuilt (REGEN_KINDS)
  regenError?: string;    // WHY it wasn't — never swallowed (§7.3)
  bytes?: number;
  reason?: string;        // why `located` is false, or an informational note
  error?: string;         // transport / server error
}
```

Status codes: `200` (ok, incl. dry-runs), `400` (bad path / unknown kind), `404`
(file missing), `422` (couldn't locate the node on a real write), `500`
(exception). The `405` on `GET /mutate` is intentional — that's why `/health`
exists.

**Dry-run/commit parity is structural.** `/mutate` and `/commit` both go through
one `computeIntent()` → `applyIntentToCache()` path: resolve the intent's files,
read them, apply, diff whatever changed. There is no per-kind branch in the
endpoint any more (the old hand-rolled two-file `token-add` case is gone), so what
the Review modal previews is byte-for-byte what a write produces.

### 3.3b Token families (`member-add` / `member-remove`)

Creating a token is the same **three-point coordinated edit** in every family,
because the pipeline is closed (§4). The bridge derives all of it from `family`:

| family | source const | emitter array | CSS var | `@theme inline` alias | utility |
|---|---|---|---|---|---|
| `semantic` | `semantic.ts` (type + `light` + `dark`) | `semanticBlock` | `--<kebab>` | `--color-<kebab>` | `bg-<kebab>` |
| `palette` | `palette.ts` `palette` | `paletteBlock` | `--wb-<kebab>` | `--color-wb-<kebab>` | `bg-wb-<kebab>` |
| `radius` | `radius.ts` `radius` | `rootOnlyBlock` | `--radius-<kebab>` | `--radius-<kebab>` | `rounded-<kebab>` |
| `typo` | `typography.ts` `typography` | `rootOnlyBlock` | `--font-<kebab>` | `--font-<kebab>` | `font-<kebab>` |

The naming rule is the contract between the bridge's `FAMILY` table and the
client's `edits.ts#FAMILY_META`; keep the two in sync.

Failure policy: the **source const and the emitter are load-bearing** — without
both, the token either fails typecheck or silently never reaches `tokens.css`, so
both must locate or nothing is written. The **`@theme inline` alias is
best-effort**: "already mapped" is a legitimate no-op, reported through `reason`
while `located` stays true.

Radius/typo aliases are self-named (`--font-heading: var(--font-heading)`), which
is not circular: `@theme inline` substitutes the value expression into the utility
instead of emitting its own variable, and the `:root` value comes from
`tokens.css`. This follows the existing `--font-display` precedent in
`index.css`. New aliases are inserted **after the last declaration of the same
namespace**, which also keeps a `--font-*` alias inside the file's existing
`stylelint-disable value-keyword-case` region.

### 3.4 Transaction endpoints — the WRITE log

`/mutate` handles previews (dry-runs) and one-off writes. **Real writes from the
approval flow go through `/commit`**, which records an undoable transaction.

> **This is the file history, not the editor's history.** One transaction = one
> "Save to Code". It steps between *saves*, which is the wrong altitude for an
> editor — the sandbox's ⌘Z steps between *edits* and lives client-side (§9,
> `design-editor-sandbox-recipe.md` §6). Both exist on purpose: `/undo` is "put the files back
> the way they were before that write" (useful when a save was a mistake, and it
> guards against out-of-band drift), while ⌘Z is "I didn't mean that edit" and
> expresses itself as inverse intents in the *next* save.

- **`POST /__design-editor/api/commit`** — body `{ intents: MutationIntent[] }`. Applies
  the whole batch as **one undo unit** against an in-memory per-file text cache
  (so multiple edits to the same file compose), writes only files that actually
  changed (each backed up to `.bak` first), regenerates `tokens.css` if any
  intent was a `REGEN_KINDS` kind, and pushes one `Transaction` onto the undo
  stack (clearing the redo stack). Returns
  `{ ok, results: [{ located, reason?, label, file }], regenerated,
  transactionId, undoDepth, redoDepth }`. Intents that don't locate are skipped
  and reported (consistent with the modal's per-intent behavior).
- **`POST /__design-editor/api/undo`** / **`/redo`** — restore the top transaction.
  Undo writes each file's `before`; redo writes `after`. **Drift guard:** before
  writing, each file's current on-disk content must equal the side it's expected
  to be on (undo expects `after`, redo expects `before`); if any file drifted
  (edited out-of-band), the op **aborts without writing** and returns
  `409 { ok:false, conflict:true, conflicts:[{ file, diff }], … }`. Success
  returns `{ ok, undone|redone: TransactionSummary, regenerated, undoDepth,
  redoDepth }`. "Nothing to undo/redo" returns `200 { ok:false, reason }`.
- **`GET /__design-editor/history`** — `{ ok, undo: TransactionSummary[],
  redo: TransactionSummary[], undoDepth, redoDepth }`, where
  `TransactionSummary = { id, ts, labels: string[], files: string[] }`.

**Transaction shape** (in-memory, per dev-server process — never persisted):
`{ id, ts, labels: string[], files: [{ path, before, after }] }`. The
`before`/`after` are full file contents the commit already computed. `.bak`
remains the separate, coarser session-pristine escape hatch.

### 3.5 `POST /__design-editor/api/validate` — "would a save succeed right now?"

Body `{ intents: MutationIntent[] }` → `{ ok, results: [{ located, reason?,
label, file }], fsRevision }`. **Writes nothing.**

```http
→ POST /__design-editor/api/validate
  { "intents": [ { "kind": "class-rewrite", "file": "…/button.tsx",
                   "cvaName": "buttonVariants", "axis": "variant", "value": "default",
                   "replacements": [{ "from": "bg-primary", "to": "bg-secondary" }] } ] }
← 200 { "ok": true, "fsRevision": 1, "results": [
    { "located": false, "reason": "no matching classes: bg-primary",
      "label": "buttonVariants.default", "file": "packages/frontend/src/components/ui/button.tsx" } ] }
```

**Why it must share code with `/commit`.** Validation is only worth anything if a
`located: false` here is *exactly* the failure a save would hit. Both call one
`composeIntents(injector, intents)` helper, which applies the batch against a
shared in-memory text cache — so multi-edit composition (two token edits to
`semantic.ts` stacking) behaves identically in both. Two parallel implementations
would drift, and a validator that disagrees with the writer is worse than none.

The client calls this on every `fsRevision` bump *and* (debounced, quietly) on
every change to its plan. The second call is not redundant: reading a file is what
puts it in the sweep's tracked set (§7.6), so validating the plan is also how the
bridge learns which component sources to watch.

### 3.6 `POST /__design-editor/api/candidates` — Tailwind candidate registration

Body `{ classes: string[] }` → `{ ok, added, rejected, hmr?, total, cap }`.

```http
→ POST /__design-editor/api/candidates  { "classes": ["hover:bg-chart-4/45", "BAD Class!"] }
← 200 { "ok": true, "added": ["hover:bg-chart-4/45"], "rejected": ["BAD Class!"],
        "hmr": "packages/design-editor/src/sandbox.css", "total": 1, "cap": 4000 }
```

**The problem.** Tailwind v4 emits a rule for a utility only if that exact class
appears in a file it scanned. Every class the editor assembles from user choices —
`hover:bg-secondary/70` from a role plus an opacity — exists in **no file**, so no
rule is generated and the preview silently does not repaint. The one combination
that appeared to work, `hover:bg-primary/90`, worked only because `button.tsx`
contains that literal string. Nothing was ever wrong with the class the editor
built or with the parser that read it back.

**The fix.** Accepted classes go into a session `Set`, which is written to
`src/generated/safelist.css` as one `@source inline("…")` per candidate.
`sandbox.css` `@import`s that file, so **Tailwind** still generates the rule — the
`color-mix(in oklab, var(--chart-4) 45%, transparent)` the preview paints is
Tailwind's own output, not a reimplementation.

Three properties worth keeping:

- **On demand, not a static safelist.** The full product the panel can reach
  (2 themes × 5 states × 7 utilities × 31 roles × 12 opacities ≈ 26 000
  candidates) compiles to **6.8 MB of CSS** — measured, not estimated. The set
  actually needed at any moment is a few dozen.
- **The file write alone is not enough** — see §7.7. It must be followed by an
  explicit module invalidation or an already-loaded page keeps its old stylesheet.
- **`CANDIDATE_RE = /^[a-z][a-z0-9:_\-/.]*$/`** is the trust boundary. The string
  is interpolated into CSS, so `"`, `\`, `(`, `)`, `{`, `}` and whitespace are
  rejected rather than escaped — no arbitrary-value or brace-expansion syntax gets
  through. `CANDIDATE_CAP` (4000) bounds a client bug.

The set is re-read from the existing file on server start, so a restart doesn't
blank the preview until every control has been touched again. Re-posting a known
class is a no-op: the file is only rewritten when the set actually grows, so a
Tailwind rebuild happens on genuinely new combinations rather than on every mouse
move.

### 3.7 `GET /__design-editor/api/metadata` — component + scene AST metadata

Returns the `DesignMetadata` document (contract unchanged) plus a `scenes` array
of `SceneMeta`, a `revs` map of `file → mtimeMs at parse time`, and `fsRevision`.

Backed by a content-addressed cache (`abs → { mtimeMs, size, value }`): a request
stats every file in `scenes.config.json` and re-analyzes only those whose stamp
moved. Cold is ~300 ms over the manifest; warm is a handful of `stat`s.

**Why an endpoint and not a static JSON import.** The client must be able to
re-read this IMPERATIVELY. Until Phase 3 the sandbox statically imported
`src/data/mock-metadata.ts`, and the consequence is structural, not cosmetic: a
`layout-insert` renumbers every following sibling, so a client holding a
pre-write tree would fail on ALL of them at the next save. The file is still
written to `src/generated/design-metadata.json` — for CI, for a Phase 4 agent
with no dev server, and as the client's bridge-offline fallback. Same dual nature
as `safelist.css`.

`?file=<repo-relative>` lazily analyses one file the manifest never listed and
returns **both** halves: `file` (CVA/token analysis) and `nodes` (its JSX node
tree). The outline's drill-in needs the tree — selecting `<DocumentRow doc={d}/>`
in a scene anchors on the *list* file, and opening its definition needs the
component file's own roots. Restricting drill-in to manifest-listed files would
exclude exactly the files a designer needs to drill into.

Three invalidation paths, all required:

1. **after `/commit`** (and after a single `/mutate` write, and after
   `/undo`+`/redo`) — the write already knows which files it touched; invalidate
   them and push `design-editor:metadata-change` over the WS.
2. **on external change** — `detectExternalChanges` invalidates the reported
   file. This closes the gap `design-editor-sandbox-recipe.md` §6.6 used to end on ("detects it
   but cannot refresh itself").
3. **`tracked` is seeded from the manifest** at `configureServer`, not just from
   the token pipeline — otherwise the mtime sweep, the detection path that works
   where inotify does not, would never watch the scene sources layout edits
   depend on.

### 3.8 `POST /__design-editor/api/preview-tokens` — the emitter, run on staged edits

Body `{ intents }` → `{ ok, light: {var→value}, dark: {…}, base: { light, dark } }`.
**Writes nothing.**

**The gap it closes.** `paletteBlock()` in `build-css.ts` contains hand-written,
mode-conditional logic (`syrupForMode`; `--wb-syrup-deep` maps to
`palette.butter` in dark). The client's `tokenPreviewStyle` only ever overrode
`--<semantic-kebab>` vars — so a palette edit previewed as **nothing** on
anything reading `--wb-*`, which is what `login/page.tsx` does throughout
(`var(--wb-bg)`, `var(--wb-ink)`, `var(--wb-paper)`, `var(--wb-rule)`). Porting
that logic into the browser is the §3.6 trap one level up: the preview's colour
maths would become the sandbox's reimplementation of the emitter, free to drift
from the bytes a commit writes.

**The mechanism.** `composeIntents` already yields the patched TEXT of the four
token sources without writing. A warm `tsx` worker
(`packages/core/scripts/preview-tokens.mts`) writes them to a scratch dir,
imports them, and calls `renderTokensCssFrom(sources)`. The real emitter runs, so
the mode-conditional logic is honored by construction — and `computed` bindings
like `` `rgba(${palette.butterRgb}, 0.30)` `` resolve, which no text-level
analysis could. The client diffs against `base` and applies the delta as CSS
variables (DOM scenes) and as a theme-object patch (canvas scenes): one source of
truth for both render targets.

A *fresh scratch dir per request* is what busts the ESM cache. `semantic.ts`
imports `./palette`, so a query-string bust on `semantic.ts` alone would still
resolve the CACHED palette and silently return pre-edit colours.

`build-css.ts` gained `renderTokensCssFrom(src)` / `tokenBlocks(src)` to make this
possible; `renderTokensCss()` and the `isMain` CLI path are behaviour-identical,
gated by §8.1 check 13. The worker is warm because a per-request spawn is ~400 ms
— unusable for a live preview — while the render is sub-millisecond.

`tokenPreviewStyle` is **retained as the fallback** for a down bridge or a dead
worker, labelled *approximate* in the UI — the same treatment computed CSS gets
in §3.2.

**Where the result goes, per render target.** The component preview applies the
delta as an inline `style` on a host DOM element. A scene frame cannot inherit
that — an iframe is a separate document and does not participate in the host's
cascade — so `SandboxLayout` sends the same delta over
`wb:set-token-vars` (§7.11) and the frame installs it as a real `:root` rule.
Until CP3.4 that channel did not exist, and the visible symptom was exact: a
token edit repainted the button preview and left every scene untouched.

### 3.9 `POST /__design-editor/api/plan` — the staged plan, as served bytes

> **SHIPPED AS `POST /plan`.** The route carries the shorter name; everything below
> describes it, including the union rule, which `publishPlan` in `plugin/bridge.ts`
> implements. `plugin/scene-patch.ts` is the other half, serving a `?wbFrame=` module
> with the same `plans: Map<FrameSide, MutateRequest[]>` applied.
>
> For a period after extraction both ends existed and nothing connected them: the shell
> never called the route, and the route staged without invalidating. A staged class edit
> was therefore invisible until Approve wrote it, while token edits previewed live
> (`/preview-tokens` → `wb:set-token-vars`, which works because a CSS variable can be
> overridden from outside a frame). `verify:scenes` now covers both directions — the
> class appearing on stage, and disappearing on undo — because only the second one fails
> when the union is wrong.


Body `{ side: "before" | "after", intents }` → `{ ok, side, count, reloaded }`.
**Writes nothing.**

Stores the layout half of a plan for one frame side and invalidates the modules that
plan touches, so `scene-patch` re-serves them with the patch applied. Non-layout kinds are dropped server-side:
token edits preview through §3.8 instead, and letting both paths claim the same
module would have them fighting over it.



**Why a patched MODULE and not an override channel.** A class override works for
a component preview because the preview owns the render and passes a
`className`. A scene renders a real route file, and there is no seam to pass
anything through: the target may be any nested JSX node, and a `layout-insert`
cannot be expressed as an override at all without compiling JSX in the browser.
Serving the composed source is the only form in which what the frame paints and
what a save writes are the same bytes by construction.

**`reloaded` is the union of the OLD plan's files and the new one's.** This is
the case a naive implementation gets wrong: invalidating only the new plan's
files leaves a previously-patched module serving its stale patch forever, and an
emptied plan names no files at all — so dropping an intent would never revert.
Same lesson as §7.7: computing the new content is not enough. Check 19 exists
solely for this.

---

## 4. The token pipeline it mutates (core, closed & enumerated)

The engine mutates four files under `packages/core`. Understanding their
relationship is required to understand `valueKind` and the cascade.

```text
palette.ts  ──────────────┐   raw brand colors (#hex + rgb tuples + nested groups), `as const`
   (foundation)           │   e.g.  syrup: '#B8651A'
                          ▼
semantic.ts  ── light/dark maps typed by SemanticColorMap. Each entry is ONE of:
                            •  palette ref:   primary: palette.syrup
                            •  raw literal:   secondary: 'oklch(0.967 …)'
                            •  computed:      sidebarAccent: `rgba(${palette.butterRgb}, 0.30)`
                          │
                          ▼
build-css.ts  ── explicit emitter. paletteBlock() emits --wb-*; semanticBlock() emits
   (generator)             --primary/-ring/… by reading semantic[mode]. Hand-written arrays.
                          │
                          ▼
dist/tokens.css  ── AUTOGENERATED (:root + .dark). Consumed by the frontend via
                     the package exports map (@wafflebase/core/tokens.css).
```

**The pipeline is CLOSED / enumerated.** A brand-new semantic token is invalid
until it appears in *all four* places: the `SemanticColorMap` type, the `light`
map, the `dark` map, and the `semanticBlock()` emitter array. Inserting a key
into `light` alone fails typecheck (excess property) **and** never emits. This
is why `token-add` is a coordinated multi-point injection (§5.4).

Consumers of `palette` beyond core (confirmed importers of
`@wafflebase/core/tokens` `palette`): `frontend/src/components/formatting-colors.ts`
(color-picker swatches), `slides/src/themes/wafflebase.ts`,
`sheets/src/view/theme.ts`, `docs/src/view/theme.ts`,
`slides/src/import/pptx/theme.ts`. **This is the blast radius a palette edit
cascades through.**

---

## 5. AST mutator rules (`src/server/inject.mjs`)

Plain `@ts-check` JS, imported dynamically by the Vite config so esbuild never
bundles the TypeScript compiler into the config. Every function follows the same
discipline:

> **Locate an exact node with the TypeScript compiler API → replace only its
> character span → write the result back.** Because every edit is anchored on a
> specific CVA value literal or a specific object-property initializer, no
> unrelated occurrence in the file is ever touched.

Core helpers: `parse()` (`ts.createSourceFile`, TSX, `setParentNodes: true`),
`spliceSpan(text, start, end, replacement)`, `getProp(objExpr, key)`,
`findConstObject(sf, name)` (unwraps `as const` / `as T`),
`findCvaCall`/`findClassLiteral`, `insertBeforeClose` (inserts a member at the
**start of the closing bracket's line**, matching CRLF).

### 5.1 `applyClassRewrite(fileText, { cvaName, axis?, value, replacements, additions, removals })`

Edits the class tokens inside **one CVA value literal**. `value === '__base__'`
targets the cva base (first argument). Three whole-token operations:

- **`replacements`** — swap `from` → `to`. Tokens are matched with
  lookbehind/ahead whitespace/quote boundaries, so `bg-primary` never matches
  inside `bg-primary-foo`, and modifier/opacity variants the caller enumerated
  (`hover:bg-primary/90`) are covered.
- **`additions`** — append a token that isn't present, just inside the closing
  quote. This is how an interaction state that has **no** modifier yet gets
  introduced (`active:bg-primary/80`). Idempotent: an already-present token is
  reported as missing rather than duplicated.
- **`removals`** — delete a token, collapsing exactly one adjacent space so the
  literal never grows a double space or an edge space. This is the inverse of
  `additions`, and it is what an undo-past-save uses to un-introduce a state.

`located` is true when **at least one** operation applied; `reason` lists the
tokens that did not match. Returns `{ located, text, reason? }`.

### 5.2 `applyTokenValue(fileText, { constName, path, value, valueKind })` — THE `valueKind` RULE

Replaces a nested object-property initializer. **`valueKind` is the heart of the
design-system-integrity fix:**

- **`'literal'`** (default) → writes a **quoted string**: `'#B865aa'`. Correct
  for genuine neutrals (semantic `oklch(…)` literals) and for palette leaves in
  `palette.ts`.
- **`'expression'`** → writes the value **verbatim, unquoted**: `palette.butter`.
  This keeps a semantic token **bound to the palette** instead of collapsing it
  to a hex string. **Guarded:** only a bare `^palette(\.[A-Za-z_$][\w$]*)+$`
  reference is accepted — arbitrary code cannot be spliced in (verified: a
  `process.exit(1)` payload is rejected with `located: false`).

Reused for `palette.ts` edits: `applyTokenValue(paletteText, { constName:
'palette', path: ['syrup'], value, valueKind: 'literal' })` works as-is because
`findConstObject` unwraps `export const palette = {…} as const` and `getProp`
navigates nested paths.

### 5.3 Introspection readers

- `readSemanticBindings(fileText)` → `{ located, bindings: { light, dark } }`.
  Walks each map's `PropertyAssignment`s and classifies the initializer via
  `classifyInit` (StringLiteral → `literal`; `palette.*` PropertyAccess →
  `palette`; Template → `computed`; else `other`).
- `readPaletteColors(fileText)` → `{ located, colors }`. Recursively flattens the
  `palette` object's string leaves into `{ ref, path, value, isColor }`.
  `isColor` uses `COLOR_RE` (`#hex` / `oklch(` / `rgb(` / `hsl(`).
- `readConstLeaves(fileText, constName)` → `{ located, leaves }`, the generic
  flattener behind `scales` (`radius.ts` / `typography.ts`). This is what lets the
  editor take every non-colour default from source too — see the default-value
  rule in §3.2.
- `readThemeMappings(cssText)` → `{ located, mappings }`, every custom property
  declared inside `@theme inline`, i.e. which tokens are utility classes.

### 5.4 Token creation and removal (the three-point edit)

Semantic colours need a type member as well as a value in both maps, so they keep
a bespoke pair; every other family uses the generic primitives.

- `insertSemanticToken(fileText, { camelKey, value })` — inserts
  `${camelKey}: string;` into the `SemanticColorMap` type **and**
  `${camelKey}: '${value}',` into both `light` and `dark`. Splices are applied
  **bottom-up** (dark → light → type) so earlier offsets stay valid. Guards
  invalid identifiers and duplicate keys.
- `removeSemanticToken(fileText, { camelKey })` — the exact inverse, also
  bottom-up, removing whole lines (multi-line properties included).
- `insertConstMember` / `removeConstMember(fileText, { constName, key, value?, valueKind? })`
  — a member of any const object (`palette` leaf, `radius` step, font family).
- `insertBlockEmit` / `removeBlockEmit(fileText, { fnName, cssVar, expr })` —
  the `['--<var>', <expr>],` entry in a `build-css.ts` emitter array
  (`semanticBlock` | `paletteBlock` | `rootOnlyBlock`), without which the token
  never reaches `tokens.css`.
- `insertSemanticEmit` remains as a thin wrapper over `insertBlockEmit`.

Every removal routes through one `removeNodeLine()` helper: back to the start of
the node's first line (whitespace only), forward past its trailing comma and
newline. Callers splice **highest-offset-first** so earlier offsets stay valid.

### 5.5 Tailwind `@theme inline` aliases (`insertThemeMapping` / `removeThemeMapping`)

Plain-text surgery bounded to the `@theme inline { … }` block in
`packages/frontend/src/index.css` (`findThemeBlock` brace-matches the span). This
is the step that makes a created token *usable as a class* — the step the old
Color-only "Add token" flow left to the human, with the review modal literally
telling you to go map it yourself. Insertion is grouped after the last
declaration of the same namespace (§3.3b); both directions guard on presence.

### 5.6 `unifiedDiff(before, after, context = 2)`

Multi-hunk unified diff for display. Some edits are genuinely non-contiguous —
creating a semantic token touches the type literal, `light` and `dark`, three
insertions ~70 lines apart — and a single-region diff had to span all of them, so
the review modal showed the entire middle of the file as one "changed" block.

It trims the common prefix/suffix, runs an LCS over what is left, groups changes
within `2 × context` lines into one hunk, and separates hunks with `⋯`. A
pathologically large rewrite (LCS table over ~4M cells) degrades to one coarse
hunk rather than spending seconds on a display string.

### 5.7 Layout mutation — the `NodeAnchor` and its resolution

A layout edit has no CVA to anchor on, so it needs an address for an arbitrary
JSX node that survives sibling insertions, batch composition, and out-of-band
edits.

`NodeAnchor = { file, component, path[], tag, fp, fpx? }`. **`path` is a hint;
`fp` is the truth.**

```text
fp  = sha1_8( ancestorTags | tag | attrNames.sorted() | IDENTITY_ATTRS values | directText[0..40] )
fpx = sha1_8( fp | classTokens.sorted() | childTags )
IDENTITY_ATTRS = to href id name htmlFor type value data-testid aria-label role key
```

What `fp` **excludes** is the whole design:

| excluded | because |
|---|---|
| `className` CONTENT | the most-edited attribute; including it would make every class edit invalidate its own anchor AND its own revert's anchor (a revert resolves against the post-edit tree) |
| the CHILD TAG SEQUENCE | an insert changes the PARENT's sequence, so a second op on that parent in the same batch would find a stale fp |
| SOURCE OFFSETS | invalidated by any edit above the node, including our own earlier intent in the same batch |

`ancestorTags` (tag names, not indices) does not disambiguate identical siblings —
they share ancestors — but it blocks the more dangerous cross-subtree false match.

**`fp` collides freely, and that is why `fpx` exists.** Measured on real files:
`SheetView` has four identical `<Suspense>` siblings and two top-level
`<div className=…>` returns that are all equal under `fp`; `login/page.tsx` has
two byte-identical `<span className="mx-2 opacity-50">·</span>` nodes. Adding
`fpx` cut collisions from 7→2 (documents), 7→2 (datasources) and 6→0
(sheet-editor). `fpx` is invalidated by an edit to *this* node — but a path hint
fails because something changed ELSEWHERE, so it is normally still valid at
exactly the moment it is needed, and resolution falls through to `fp` when it is
not. No new failure mode, and most post-external-edit relocations become silent
recoveries instead of "discard your edit".

**`className` reaches the UI as TWO fields, and neither one is in `fp`.**
`classLiteralOf` names a rewrite TARGET, so it refuses anything it cannot
attribute to an authored blob — and that refusal was invisible:
`className={t("nav.home")}` arrived as `className: null`, which the editor could
not tell from a node with no class attribute, so it offered an edit
`applyClassRewrite` then refused. `attrsOf` therefore also returns
`classNameExpr`, the expression **as written**, for the UI to render read-only:

| `className` | `classNameExpr` | the class value is |
|---|---|---|
| string | `null` | a plain literal — fully editable (`"p-2"`, `{"p-2"}`, `` {`p-2`} ``, `{("p-2")}` are one case) |
| string | string | a joiner call with an authored blob — `cn("p-2", x)`. The blob is editable, the rest is the author's |
| `null` | string | **locked** — an expression with no attributable blob (`t("nav.home")`, `styles.row`, a ternary) |
| `null` | `null` | no `className` attribute |

`classNameExpr !== null` means "an expression exists", **not** "locked" — row 2
is editable, and a UI keying off the single field greys out the commonest shadcn
shape there is. Locked is `className === null && classNameExpr !== null`.

Two limits, both deliberate. A **valueless** attribute (`<div className/>`,
`<div className={}/>`) has no expression to show, so it reads as row 4 while
`applyClassRewrite` still refuses it — its test is `findJsxAttribute &&
!classLiteralOf`, so a UI mirroring the refusal exactly must check
`attrs.includes('className')`; `classNameExpr` supplies the text to *show*, not
the decision. And the text is **verbatim source**, newlines included, so a
single-line token is the caller's collapse to make.

The field is additive in the strict sense: it enters neither `fp` nor `fpx`, and
`test/server/jsx-nodes.test.mjs` pins both hashes for sixteen fixtures against
values recorded *before* it existed. That guard is not redundant with the drift
check in §5.10 — a payload change moves `walkJsx` and `extract.mjs` together, so
they keep agreeing while every anchor already written down goes stale. Measured:
routing the new field into `fpOf` fails exactly the six fixtures that have an
expression, and nothing else in the suite.

`resolveNode` tries **path → unique `fpx` → unique `fp` → refuse**, and *every
search step resolves only on exactly one match*. Ambiguity is treated as absence:
picking the first of two identical spans would write to the wrong node silently,
which is the worst failure this tool can have. The reason carries the candidate
paths, so the UI can offer "re-point this edit" rather than only "discard".

**Three structural-op guards, all server-side** (`requireStatic`), because the
client's `SceneMeta` can be stale — the same reason `/validate` shares
`composeIntents` with `/commit`:

- **scope must be `static`.** Inside a `.map()` body the shapes diverge —
  implicit return, block body with several returns, conditional root,
  `items.map(renderRow)` — and each needs different splicing; getting one wrong
  corrupts the iteration. `layout-props` is always allowed there, since it never
  touches control flow.
- **the node must be a DIRECT JSX child.** For `{cond && <div/>}` removing the
  element would leave a bare `{}` and removing the container would silently drop
  the condition. Splice offsets are likewise taken from the OWNER (the `{…}`),
  or an insert after that child would land before the `}`.
- **the node must not BE a returned expression.** The children of the synthetic
  returns root look like siblings to the path model, but in source they are
  separate `return` statements, so there is no sibling list to splice into —
  and even with one return, adding a sibling yields `return <div/><span/>;`,
  which does not parse. The test is identity against the root's returned
  expressions, *not* `path.length === 1`: a returned FRAGMENT is transparent for
  numbering, so `return <><A/><B/></>` puts A and B at depth 1 where they are
  genuine siblings in a real container, and splicing between them stays legal.

**`opts.role` — because two of the three guards depend on what the anchor IS.**
The guards above were written for one op ("splice this node") and applied to
all, which refused inserting a *child* into any component whose body is
`return <div>…</div>`. That is not a missing capability but **data loss**:
`applyLayoutRemove` inside such a root succeeds, and its `verbatim` inverse is
refused, so the node is gone with no way back.

| guard | `role: 'target'` (default) | `role: 'container'` |
|---|---|---|
| `scope !== 'static'` | refuse | **refuse** — renders N times either way |
| `owner !== node` | refuse | allow |
| is a returned expression | refuse | allow |

Verified against the parser rather than argued: a child spliced into a returned
root parses, a child spliced into a conditionally-rendered element parses, and a
*sibling* beside a returned root is a syntax error. `applyLayoutInsert` passes
`'container'` for its parent anchor; everything else keeps the default, so every
pre-existing caller is unchanged.

One shape stays refused for the same data-loss reason, from the other direction:
removing a **direct child of a returned fragment**. The fragment is transparent,
so its children sit at depth 1 with the synthetic `#returns` container above
them — and no anchor can name that, so the re-insert has no parent to target.
`applyLayoutRemove` refuses rather than outrunning its own inverse. Making the
returns root addressable as a container (delegating the offset to the wrapped
fragment's opening token) would restore it.

`walkJsx` numbering: only JSX elements count; `JsxText`/comments do not.
Fragments are **transparent** (their children number into the parent's list, so
wrapping one does not renumber a subtree). A function's root is a **synthetic
`#returns` container** whose children are its returned JSX expressions in source
order — always, so there is one path convention rather than two. Without it,
"the first return" made `SheetView` a single `<Loader/>` guard node; with a
shape that collapsed for single-return functions, adding a guard clause would
renumber every path in the file.

`SceneMeta.roots` holds one walkable root per JSX-returning function — the
component PLUS local helpers. That is what turns `items.map(renderRow)` from the
most fragile case into a supported one: `renderRow`'s JSX is `static` in its own
root.

A component is recognised as a function declaration, a variable initialised to a
function, that same variable wrapped in `forwardRef`/`memo` (nested and
`React.`-namespaced included), or a default export with no identifier of its own
— which keys on the synthetic name `default`, a reserved word no source
identifier can collide with. Missing a shape costs the WHOLE component rather
than degrading it: with no root, none of its nodes are walked, so nothing is
stamped, nothing reaches the outline, and a click inside it lands on whichever
ancestor was stamped. The wrappers are an allowlist, not "any call holding an
arrow", because `useMemo(() => <div/>, [])` holds one too and it is not the
declared name's render output.

`roots` is keyed by name, so a name that **two** JSX-returning functions claim
(two components each with a local `const Row = …`) cannot say which tree an
anchor belongs to. Those names are collected in an `ambiguous` set and treated
as absence — `resolveNode` refuses them, and the stamper emits no id for them
rather than one attributed to whichever was registered second. Same rule as
identical-sibling ambiguity above, same reason: silently resolving against the
wrong function's JSX is the failure this model exists to prevent.

`applyLayoutRemove` echoes the **exact spliced-out span, including its leading
newline and indent** (same rule as `removeNodeLine`). That captured text is what
makes its inverse a pure span splice, and therefore byte-identical — the property
§8.1 check 9 asserts. `insertImport`/`removeImport` maintain the file's imports:
add-if-absent, and drop a specifier ONLY when no other reference to the
identifier remains, because a stray unused import is harmless while a missing one
breaks the build.

### 5.8 Atomic intent groups

`composeIntents` used to skip a non-locating intent and report it. That is right
for independent point edits and **data loss** for two cases Phase 3 introduces:

- a *move* (`layout-remove` + `layout-insert`) whose insert fails to locate would
  delete a node and drop it;
- *promote-to-token* (`member-add` + `class-rewrite`) whose rewrite fails leaves
  an orphan token across three files.

Intents are now grouped by `groupId` (ungrouped = a group of one, so every
pre-Phase-3 kind behaves exactly as before), and each group applies against a
cache snapshot that is **restored wholesale if any member fails**, with every
member reported `group aborted: <first failure>`. Because `/validate` and
`/commit` share `composeIntents`, a validation verdict still cannot disagree with
the writer (§3.5).

### 5.9 The ordering rule lives on the CLIENT

The injector applies ONE intent against the text it is given. Ordering a batch so
that no op disturbs a position a later op still needs is `edits.ts#saveDiff`'s
job, and it is asymmetric:

| group | props | structural |
|---|---|---|
| `revert` (emitted first) | any order | **ascending** by the position the forward op targeted |
| `apply` | any order | **descending** by target position |

Reverts mirror the forward pass because they must undo it in exact reverse order.
Getting this backwards produces a plan that looks right, writes cleanly, and
leaves the file subtly wrong: with a baseline child list `[a, s, g, s, D]`, a
forward `remove@3 + insert@1` reverted in *descending* order yields
`[a, s, s, g, D]`. Verified empirically — `scripts/smoke-layout.ts` asserts both
directions, and §8.1 check 9 proves the round-trip through real writes.

### 5.10 The outline PREDICTS the resolver (`src/server/extract.mjs`)

`extract.mjs` builds the node tree the outline renders, and each node carries
**two** prediction flags. They are what enable or grey out the structural
controls, which makes them predictions of what `resolveNode(…, {requireStatic:
true})` will answer — a third place the node model is interpreted, alongside the
injector and the stamper.

There are two because the resolver answers two questions (§5.7). A node the
editor may not move or delete can still legitimately RECEIVE a child:

```js
structuralEditable =                // role: 'target' — "insert sibling", "remove"
  scope === 'static' &&             // an iteration/callback body renders N times
  tag !== '#returns' &&             // the synthetic container itself
  owner === node &&                 // reached through `{…}` — see §5.7
  !returnedJsx.includes(node)       // a whole return value has no sibling list

containerEditable =                 // role: 'container' — "insert child"
  scope === 'static' &&             // the only guard a container still faces
  tag !== '#returns'
```

A prediction that disagrees with the resolver is worse than a missing one, and
it can be wrong in **either direction**. Offering a control the server refuses
is the original failure: only the first two guards were tested once, and on a
four-shape fixture the rules disagreed on **half the nodes** — every
single-return root element and every `{cond && …}` child read as editable.
Withholding a control the server accepts is the mirror, and is what a
single-flag outline did after `role: 'container'` landed: the commonest
component shape there is — a returned root element — greyed out "insert child"
even though the injector would have taken it.

`extract.test.mjs` therefore asserts the agreement node-by-node **for both
roles** over eight shapes, rather than trusting the rules to stay in step, in
the same spirit as the stamper's cross-consumer test. Adding a third role
without a third flag fails there.

The class-edit refusal is the same kind of prediction one level down, and it is
data rather than a flag: `buildNode` carries `className` + `classNameExpr` (§5.7)
so the outline can render a locked, read-only class value instead of an empty one
that invites an edit `applyClassRewrite` will reject.

`analyzeNodes` also drops **ambiguous** roots, matching `resolveNode`'s
treatment of a name two JSX-returning functions claim, and returns those names so
the UI can say *"two components here are called `Row`"* instead of rendering a
subtree whose every node rejects its first edit.

### 5.11 Maps keyed by consumer identifiers carry no prototype

Every map keyed by an identifier read out of a consumer's source is a
prototype-pollution surface. `roots.__proto__ = tree` hits the inherited setter
rather than defining a key, so that component **disappears** with nothing
reported; and `roots.valueOf` answers with an inherited method — truthy, so a
caller testing `if (roots[name])` walks a function instead of reporting "no such
component". Both are silent.

The rule is about **who chooses the key**, not which constructor was used.
`analyzeClasses`'s `antiPatterns` is built with `Object.fromEntries` and *does*
carry `Object.prototype`; it is exempt because every key comes from `ANTI_KEYS`,
a closed vocabulary in our own source that no consumer identifier can reach.

**Enforced by a table, not by convention.** `findJsxRoots` was fixed for this,
and `analyzeNodes` then copied its entries into a plain `{}` and undid the fix
one layer down — written by the author who had just added the comment explaining
the hazard. A helper you must remember to call fails exactly where memory
already failed, so `test/server/name-keyed-maps.test.mjs` enumerates every
export returning such a map and asserts the invariant against deliberately
hostile component names. A new export evades it only by omitting its row, which
is visible in review; the table's own length is asserted so an empty one cannot
pass vacuously.

This is a different failure from the drift §5.10 guards — that one is two files
re-deriving one rule, this one is one file re-keying a map — and they need
different guards.

### 5.12 Every spliced value is validated, and the alphabet comes from the splice context

This module writes to a file the dev server executes on the next HMR reload, and
its values arrive from a browser — including, once the agent popover lands, from
a model. So an unvalidated splice is **code execution**, not cosmetic corruption.
`renderAttribute` and `applyTokenValue`'s `valueKind` already refuse on that
basis; the class and text paths did not, and were closed the same way.

The rule that matters is that **each splice context has its own safe alphabet**,
derived from the parser rather than from taste. There are three, not two — an
earlier revision of this section listed two and was wrong in a way that left a
live hole for a release:

| Context | Verified behaviour | Rule |
| --- | --- | --- |
| Inside `className="…"` / `'…'` | `className="a{b}c"` parses with 0 errors as a StringLiteral whose `.text` is `a{b}c`. `<`, `>`, `{`, `}` are inert. Only the quote escapes. | Reject whitespace, `"`, `'`, `` ` ``, `\` |
| Inside ``className={`…`}`` | `classLiteralOf` returns `NoSubstitutionTemplateLiteral` too. `${alert(1)}` carries no quote and no whitespace, so the quoted rule admits it — and it turns the literal into a live `TemplateExpression` at **0 parse errors** | The above, **plus `$`** |
| Inside JSXText | `{e()}` → `JsxExpression` and `<F/>` → `JsxElement`, both executable at 0 errors; a bare `>` or `}` is a **parse error** | Reject `{`, `}`, `<`, `>` |

The template-literal row is the lesson. The alphabet was derived correctly for
the double-quoted case and then applied to a delimiter that has an extra escape,
so `isSafeClassToken` now takes the delimiter as a **required** parameter read
from the literal being spliced (`original[0]`) — a caller cannot reintroduce the
hole by forgetting which context it is in.

Tightening in the other direction is equally wrong: applying the JSXText rule to
class tokens rejects `[&>svg]:size-4`, `[&:not(:first-child)]:border-t` and
`[&::-webkit-scrollbar]:hidden` — real classes in this repo — while leaving the
quote untouched. `isSafeClassToken` is therefore deliberately permissive about
`<`, `>` and braces, and `test/server/inject.test.mjs` asserts both directions:
a list of real Tailwind shapes must be **accepted**, and `$` must stay legal in
a quoted literal where it means nothing.

Validation lives in `rewriteClassLiteral`, the chokepoint both halves share, so
the layout path and the CVA path cannot diverge — and the "create a fresh
`className`" branch renders through `renderAttribute` rather than interpolating
a template, for the same reason: one renderer means one escaping rule.

**Names are validated by meaning, not only by shape.** `renderAttribute` proved
an attribute name was well-formed and a value was a bare dotted reference, which
is exactly what `dangerouslySetInnerHTML={x.y}` and `onClick={handlers.save}`
are. `isDangerousAttribute` refuses `on*`, `dangerouslySetInnerHTML` and
`srcDoc` on both the attribute path and inside inserted subtrees — otherwise the
denylist is bypassed by inserting the handler instead of setting it.

**Whole statements are validated too.** `insertImport` concatenates its module
specifier and bindings into source, so bindings go through `isIdent` and the
module specifier is rejected if it contains anything that would escape its
quotes. Unvalidated, a module of `./m'; evil(); import './n` wrote an extra
executable statement. `applyLayoutInsert` parses a fresh snippet standalone and
requires exactly one JSX element — `verbatim` replay is exempt, and must stay
exempt, because it restores bytes that were already in the consumer's file.

---

## 6. Architecture decisions & the "why"

### 6.1 Dual-layer Palette Cascade — over blind hex overriding

**What we rejected.** The original `applyTokenValue` always wrote a quoted string
literal. Editing `primary` (authored `primary: palette.syrup`) produced
`primary: '#B865aa'`. This is a **design-system-integrity bug**: it (a) *severs*
the semantic token from the palette, and (b) leaves every other palette consumer
(color pickers, canvas/slide themes, `--wb-syrup`) on the old color. The single
source of truth silently diverges.

**What we built.** The editor is **binding-aware**, and a color edit chooses one
of two intentional workflows:

1. **Select from Palette (rebind)** → `token-rebind` writes an **expression**
   (`primary: palette.butter`) into `semantic.ts`. The token stays palette-bound.
2. **Edit the Palette itself (cascade)** → `palette-value` mutates `palette.ts`.
   One write ripples through every consumer: `semantic` refs → `tokens.css`
   (verified: editing `palette.syrup` moved `--primary`, `--ring`, `--chart-1`,
   `--wb-syrup` together in the light block; the dark block, which uses
   `syrupBright`, was untouched — theme isolation preserved) **and** the external
   theme/picker importers.

Genuine neutrals (semantic `oklch(…)` literals not in the palette) remain
editable as literals via `token-value`. **The rule that protects integrity: a
palette-ref is never auto-converted to a literal — "detach to a raw literal" is
only ever an explicit, warned user action.** By default, typing a custom hex on
a palette-bound token edits the palette entry (cascade).

**Why this is correct.** It keeps the two layers distinct in the source
(foundation vs semantic assignment) exactly as authored, so the source stays
human-legible and the "single source of truth" property holds after every edit.

### 6.2 CVA variants — kept over global component tokens

Padding/radius/size stay as **local CVA variants** (`size: { md: "px-4 h-9" }`)
rather than global component tokens (`--button-padding-md`). Rationale grounded
in this codebase:

- **Co-location & refactor safety.** Sizing lives with the component; deleting
  the component removes its sizing with it. Global `--button-*` tokens would
  accumulate as orphans nothing garbage-collects.
- **The engine already targets CVA precisely.** `applyClassRewrite` anchors on
  one CVA value literal (`buttonVariants.size.md`), so a rebind is provably
  scoped to the active variant and cannot touch siblings ("active variant only").
- **The two layers are different things.** A *primitive scale* (`--spacing-4`,
  `--radius-md`) is global vocabulary and already exists (Tailwind's scale →
  `tokens.css`). A component's *choice* of which step to use at each size is a
  composition decision that belongs in the component. `button-padding-md`
  collapses those layers and makes the system rigid.

Global component-tokens pay off only under a concrete **density mode**
(compact/comfortable) or multi-brand lockstep requirement. Until that exists
they are indirection without benefit. If adopted later, the "active variant
only" guarantee gets *stronger* (editing `--button-padding-md` is structurally
scoped to the `md` size), and the live-preview path would move from
class-override to the CSS-var override the Token Editor already uses.

### 6.3 Live preview via CSS-variable overrides

Two override mechanisms, both view-local (no disk round-trip):

- **Class rewrites** preview through a `className` override merged by the
  component's own `cn()`/`twMerge` — the `to` tokens win over the variant's
  originals.
- **Token / palette edits** preview through **CSS-variable overrides** on a
  wrapper. This works because the frontend's `@theme inline` compiles
  `bg-primary` to `background-color: var(--primary)` — overriding `--primary` on
  a wrapper cascades to the subtree. `edits.ts#tokenPreviewStyle` folds literal
  edits + rebinds + palette cascades into one **theme-isolated** style (a `light`
  edit never recolors the `dark` preview; a palette edit overrides every semantic
  var currently bound to that ref, computed from the introspection map).

That covers the *pre-write* preview. The *post-write* half is §7.3: after a write
the CSS-variable overrides are dropped (the edit is real now), so the page must
pick up the regenerated `tokens.css` on its own. Both halves have to work or the
loop appears broken in one direction:

| | mechanism | failure mode it prevents |
|---|---|---|
| before the write | CSS-var overrides / class override | staging an edit shows nothing |
| before the write | Tailwind candidate registration (§3.6, §7.7) | a *newly composed* class has no CSS rule, so only the combinations already written in source appear to work |
| after the write | regenerate + targeted HMR reload (§7.3) | "I saved and the page didn't change" |

The middle row is easy to miss because the other two are about *values* while it is
about the *existence of the rule*. A class override that names a class Tailwind
never generated is indistinguishable from no override at all.

### 6.4 Interaction states: derive first, promote on demand

State colours (hover / active / focus / disabled) are editable in **two tiers**,
and the engine supports both with primitives it already had:

1. **Derived** — `hover:bg-primary/90`, a modifier on an existing token. Edited as
   a `class-rewrite` scoped to one CVA value; adding a state that has no modifier
   yet is an `additions` entry (§5.1). Costs no tokens and cannot drift from
   `--primary`. **This is the default.**
2. **Semantic** — `hover:bg-primary-hover` backed by a real `--primary-hover`
   token. A `member-add` (`family: semantic`) plus the class rewrite that consumes
   it, in one batch. Necessary when the state colour is *not* derivable: a
   hand-picked hue, a per-theme difference, a brand mandate.

Promotion is behaviour-preserving: the new token is seeded with
`color-mix(in oklab, var(--primary) 90%, transparent)` — exactly what the `/90`
modifier resolved to — which also keeps it theme-aware, so one value is correct in
both `light` and `dark`. The rule: **derive until you can't, then promote.**

There is a third, easily-forgotten option: **no state colour at all.**
`removals` (§5.1) is what deletes `hover:bg-accent` from a variant so the resting
colour shows through — reachable in the UI as an explicit "none" choice rather than
only as a Reset (`design-editor-sandbox-recipe.md` §2.5). Its inverse is the matching
`additions`, so undoing an unset past a save restores the exact class.

A consequence worth stating: the panel's *resting* colour row no longer rewrites
state tokens (`computeColorReplacements` skips any token with a state modifier).
When both controls rewrote the same `hover:bg-primary/90`, two intents in one
batch claimed the same span and whichever applied second failed to locate it.

---

## 7. Vite integration (`vite.config.ts`)

### 7.1 The `mutationBridge()` plugin

A Vite `Plugin` with `apply: "serve"` (dev-only). Its `configureServer` registers
every `/__design-editor/*` middleware. It never runs in `build`, so the engine ships
in no bundle. The one piece deliberately *outside* it is `safelistFile()`, which
must also run for `vite build` (§7.5).

### 7.2 ESM cache-busting for the injector

Node caches dynamic `import()` by URL for the whole process. Vite restarts the
**config** on change but not the Node process, so edits to `inject.mjs` would be
invisible without a full restart. `loadInjector()` fixes this by appending the
file's `mtimeMs` as a query:

```ts
const mtimeMs = fs.statSync(INJECTOR_PATH).mtimeMs;
const href = `${pathToFileURL(INJECTOR_PATH).href}?v=${mtimeMs}`;
injectorCache = { mtimeMs, mod: import(/* @vite-ignore */ href) };
```

A new mtime → a new URL → a fresh module. This is why editing the AST rules
takes effect live.

### 7.3 Regeneration + the post-write HMR push

`regenerateTokensCss(server)` runs `pnpm exec tsx scripts/build-css.ts` in
`packages/core` after any write whose `kind ∈ REGEN_KINDS` (`token-value` |
`token-rebind` | `palette-value` | `member-add` | `member-remove` | `token-add`),
then pushes the result to the open sandbox. Two changes here are what fix "I have
to restart the dev server to see my change":

1. **Failures are reported, not swallowed.** This used to be
   `try { … } catch { return false }` with the `false` only ever shown as the
   absence of a toast suffix. A missing `tsx`, a broken `build-css.ts`, a
   typecheck error in a file the sandbox itself just wrote — all of them looked
   exactly like "saved, but the page didn't change". The error now comes back as
   `regenError` and the UI toasts it.
2. **A targeted module reload.** `pushTokensCssUpdate(server)` looks up
   `packages/core/dist/tokens.css` in the module graph and calls
   `server.reloadModule()` on it, falling back to `src/sandbox.css` and finally to
   a full page reload. `server.watcher.add(TOKENS_CSS)` is registered in
   `configureServer` as well, because the file lives in a `dist/` directory
   outside this Vite root and we would rather not bet the live-preview loop on
   whether the Tailwind plugin happened to register it as a watch dependency.

The response reports which of the three fired (`hmr: "packages/core/dist/tokens.css"`
| `"src/sandbox.css"` | `"full-reload"`). A full reload is survivable now that the
edit history is persisted (`design-editor-sandbox-recipe.md` §6) — and in practice it only
appears when no client has loaded the page yet, since the module graph is empty
until something requests it.

### 7.4 Safety boundary (`resolveSafe` + backups)

The trust boundary between browser and filesystem:

- `resolveSafe(file)` requires a **repo-relative** path, resolves it against
  `REPO_ROOT`, and rejects anything that escapes the root, contains a
  `FORBIDDEN_SEGMENTS` element (`node_modules` / `.git` / `dist`), or whose
  extension is not in `ALLOWED_EXT` (`.json` / `.css` / `.ts` / `.tsx` /
  `.jsx`).

  `.jsx` is in the list to match §7.9's stamping contract, which runs for
  `.tsx`/`.jsx` alike. The two must agree in one direction specifically: a file
  the editor stamps is a file the editor makes *selectable*, so leaving `.jsx`
  out of the write boundary would surface an editable-looking component whose
  every edit the write path then rejects. wafflebase's own sources are all
  `.tsx`, but a consumer project mounting this plugin (see
  `design-editor-local-plugin.md`) need not be.
- `backup(abs)` copies the pristine original to `<file>.bak` **before the first
  overwrite only** (never clobbering a true original across multiple edits in a
  session). Every mutation is trivially reversible; new files report
  `backup: null`.
- `readBody` caps request size at ~5 MB.

### 7.5 Aliases & Tailwind v4 `@source`

- **`@` → `../frontend/src`** (frontend is private with no exports map).
  `@wafflebase/core` is **deliberately not aliased** — it resolves through the
  package exports map so `@wafflebase/core/tokens.css` keeps working. `tsconfig`
  mirrors `@/*` so `tsc --noEmit` agrees with the bundler.
- **`@source "../../frontend/src"`** in `src/sandbox.css` (which `@import`s the
  frontend's `index.css`). Tailwind v4 auto-detects utility candidates from the
  Vite root (`packages/design-editor`) and therefore **never scans the aliased
  frontend source**. Without this directive, classes used *only* in frontend
  components (e.g. the Radix `Dialog`'s `fixed top-[50%] translate-x-[-50%]
  bg-black/50 animate-in zoom-in-95` centering/overlay/animation utilities) are
  never generated — the component mounts **unstyled** and appears not to render.
  (Popovers escaped this because Radix positions them via inline styles, not
  Tailwind classes; the Dialog centers itself with utilities, so it broke.) The
  directive adds the frontend tree as an explicit content source.
- **`@import "./generated/safelist.css"`** — the on-demand candidate registry
  (§3.6). Gitignored and written by the bridge, so a `safelistFile()` plugin
  (deliberately *not* `apply: "serve"`) creates it in `buildStart` for both `vite
  dev` and `vite build`; otherwise a fresh clone or a production build would fail
  to resolve the import.

> **Tailwind scans comments too.** A doc comment containing a literal class name
> makes Tailwind generate that utility. This bit during verification: the "before"
> measurement for `hover:bg-secondary/70` showed the rule already present, because
> the prose explaining the bug names the class. When testing whether a candidate
> is generated, pick a class that appears in **no** file — `grep -rn` first.

### 7.6 External-change detection (`fsRevision`)

The sandbox is not the only writer. A staged edit remembers the text it expects to
find, so editing the same file in a code editor voids that expectation: the AST
locate fails, every affected edit errors at save time, and — because a failed edit
never reaches the baseline — the editor stays dirty forever with a plan that can
never succeed. Detection is what makes that survivable.

The rule: **we know which bytes we wrote, so anything else is external.**
`writeTracked(abs, text)` records the exact content of every write in
`lastWrittenByUs`, and detection compares against it.

Two paths, on purpose:

1. **`server.watcher.on("change")`** — low latency, pushes a `design-editor:fs-change`
   WS event the client receives immediately via `import.meta.hot.on`.
2. **`detectExternalChanges(server)`, an mtime sweep run on every `/health`** —
   the one that always works. **inotify does not work on WSL2's `/mnt/<drive>`
   (drvfs) mounts**, so chokidar — and therefore Vite's own watcher — never fires
   for a file edited there. Verified in this repo: a change to `button.tsx`
   produced no watcher event at all. Since a Windows checkout opened through WSL is
   exactly how this project gets developed, watcher-only detection would have been
   dead code that silently never ran.

The sweep only stats files in `tracked`, seeded with the token pipeline and grown
by every file an intent computation reads — i.e. precisely the files the current
edits depend on. `mtime`/`size` gate the (rarer) content read.

**`observe` vs `restamp` is load-bearing.** Reads happen constantly (every
dry-run, every `/introspect`), so a read must only *start* watching a file, never
move its baseline: if a read refreshed the stamp it would quietly adopt an external
change as the new normal, the sweep would never report it, and the panel would
never resync its defaults. Only a write (it *is* the new baseline) or the sweep
itself (having just reported) may `restamp`.

### 7.7 Publishing a generated stylesheet to an open page

**Measured, not assumed:** writing `src/generated/safelist.css` does **not**
invalidate the cached transform of the `sandbox.css` that `@import`s it. Tailwind
inlines the import at transform time without registering it as a watch dependency.
The failure mode is nasty because everything else looks right:

```text
warm the cache at the URL a live page holds   → 196438 bytes
register a candidate, same URL again          → 196438 bytes   ← page keeps stale CSS
same request with a new query string           → 197947 bytes   ← rule IS generated
```

So `pushSafelistUpdate(server)` invalidates the importer explicitly
(`moduleGraph.getModulesByFile` → `reloadModule`, `sandbox.css` first, then the
safelist itself, falling back to a full reload). Registering candidates without
this push produces a correct file, a provably-generated rule, and a preview that
still does not repaint — which is the exact bug the mechanism exists to fix.
`pushTokensCssUpdate` (§7.3) is the same helper aimed at `tokens.css`.

### 7.8 The scene frame: a second entry, and the `?wbFrame=` module id

`scene.html` → `src/scene-entry.tsx` is a **real second Vite entry**, loaded in an
iframe at `/scene.html?scene=<id>&frame=<side>&theme=<light|dark>`.

**Why a separate realm, not `about:blank` + a host-driven `createRoot`.** One
realm means every module instance is *shared*, and the engines keep module-level
mutable state (`docs/src/view/theme.ts` holds `let activeTheme` behind a `Proxy`;
`LightTheme`/`DarkTheme` are shared mutable objects). A dual-frame visual diff
would then paint both sides from the same theme object and show identical
colours. The realm split makes that correct by construction rather than by
discipline. The cost is that the host cannot call into the frame, which is why
there is a typed `postMessage` contract (§7.11) instead of a function call.

**Why the patched module is `<real path>?wbFrame=<side>` and NOT `virtual:`.**
The obvious id is a virtual specifier. It does not work, for a mechanical reason:
`@vitejs/plugin-react@4.3.4` (`dist/index.mjs:141-145`) does
`const [filepath] = id.split("?")` and filters on `/\.[tj]sx?$/`. A
`\0virtual:wb-scene?id=login` id has filepath `\0virtual:wb-scene`, so it gets
**no JSX transform and no fast refresh** — and a virtual id has no directory, so
a relative import inside the patched source (`./document-list`) cannot resolve.
Keeping the real path and adding a query fixes all three at once, and Vite keys
its module graph by full id, so `?wbFrame=before` and `?wbFrame=after` are two
modules of one file — which is the property the whole diff view rests on
(check 18).

**Propagation, and where it stops.** `scenePatch()`'s `resolveId` re-emits any
first-party import of a frame-qualified module with the same query. Two reasons,
both load-bearing:

- *Drill-in.* An edit to `document-list.tsx` — which `page.tsx` imports
  unqualified — could otherwise never preview.
- *Context identity.* If `providers.tsx` were loaded unqualified while the scene
  is qualified, `@/components/theme-provider` would resolve to two module
  instances and therefore two distinct `ThemeProviderContext` objects.
  `useContext` returns the default, and the Settings scene's switch reads as
  always-light with a no-op `setTheme`. Silent, and expensive to find.

It stops at `node_modules` (check 20), or React / react-router / `@tanstack`
would get a second instance per frame and the router would fail to find its own
context from a tree that visibly has one.

**The engine packages are aliased to source.** `@wafflebase/{sheets,docs,notes,
slides}` point at `packages/*/src/index.ts`, mirroring
`packages/frontend/vite.config.ts`. A note here previously claimed this was only
needed once a Canvas scene existed; a transitive crawl of the frame graph
disproved it. The DOM documents scene reaches them through
`document-list.tsx → upload-queue.ts → apply-imported-content.ts`, which
value-imports `initialSpreadsheetDocument`. Resolving through the package exports
map fails in a fresh checkout — the engines publish from `dist/`, which nothing
has built — with Vite's *"Failed to resolve entry for package"*, surfacing in the
browser as a mount error on a scene whose page file mentions none of it.

### 7.9 `data-wb-node` / `data-wb-fp` / `data-wb-file` — the stamping transform

`src/server/stamp.mjs` is **the third consumer of `jsx-nodes.mjs`** and never
re-derives the numbering. It runs inside `scenePatch()`'s `load`, on the
*patched* text, only for `?wbFrame=` ids, only for `.tsx`/`.jsx`, and only under
the sandbox's own dev server.

- **`data-wb-fp` is the identity.** The DOM is the *patched* tree, but every
  intent is expressed in the *baseline* frame, so a path read off the DOM is in
  the wrong frame the moment a staged insert sits above the node. `fpOf`
  deliberately excludes className CONTENT and the child tag SEQUENCE, which makes
  the fingerprint survive both a node's own class edit and an insert into its
  parent — a frame-independent key.
- **`data-wb-node` (`<root>:<path>`) is the grouping key**, and what the runtime
  `clickSelectable` check reads back out of the DOM.
- **`data-wb-file` says which metadata tree to resolve against.**
  `<root>:<path>` is *not* unique inside a frame: with `shell: "app"` one document
  contains `Layout`, `AppSidebar`, `NavUser` and the page, and `Page` / `default`
  are ordinary root names. Without the file the host must guess, and a wrong
  guess anchors the edit in the wrong file with no visible symptom (checks 22, 24).

Only `.tsx`/`.jsx` are stamped: a `.ts` cannot contain JSX, so stamping one is a
full TypeScript parse that always finds nothing — and since §7.8 the frame graph
reaches the engine sources, which are hundreds of `.ts` modules.

### 7.10 The network kill-switch

`src/scenes/fetch-fixtures.ts` replaces `window.fetch` for the frame's lifetime,
resolving by URL from `src/scenes/fixtures/**` and **throwing a named error** on
anything unmocked. It is installed *before* the scene module is imported —
`api/datasources.ts` computes its base URL at module scope and `document-list.tsx`
fires queries on mount, so a guard installed after the import has already lost
the race.

**Why the fixture layer is `fetch` and not `queryFn`.** A `QueryClient`-level
default `queryFn` is only consulted when the caller does not supply one, and
every scene supplies one (`fetchDocuments`, `fetchDataSources`, `fetchWorkspaces`,
`fetchFolders`). Keying fixtures on the query key would have resolved nothing on
all four. Substituting at `fetch` is also strictly better: `fetchWithAuth`'s real
401 → refresh → retry branch, `assertOk`'s error shaping and each page's own
loading/empty/error rendering all stay in the code path.

**Why a miss is a hard failure.** A scene that quietly reaches the real backend
does not fail visibly — it 401s, and `fetchWithAuth` answers a 401 with
`logout()` then `redirectTo("/login")`, i.e. `window.location.href`. Inside a
frame that **navigates the frame off `scene.html`**: it does not render an error
state, it silently becomes a different page.

**The Mock Data toggle** (`emptyFixtureTable`) reuses this same fixture table
rather than adding a second one. Every array reachable from a fixture value
becomes `[]`, recursively — a generic transform rather than a hand-authored
"empty" fixture per scene, since every fixture in this package is already plain
JSON data (a bare array, or an object with array fields) and emptying every
array reachable from it produces the correct zero-rows shape for any scene.
`Response` fixtures (the odd-status tests) pass through untouched. Read once at
frame load from `?empty=1` (`scene-entry.tsx`), the same pattern `theme`/`scene`/
`frame` already use — toggling it is a real frame reload (`SceneHost`'s iframe
`key` includes it), not a live `postMessage`, because every fixture-dependent
query would need to refetch anyway.

### 7.11 The host ↔ frame protocol

`src/scenes/frame-protocol.ts` is the single typed contract; every listener on
both sides drops a message whose `origin` is not our own, mirroring the rule the
app's own `ThemeProvider` already applies.

host → frame: `wb:set-selection`, `wb:set-hover`, `wb:measure`,
`wb:set-picking`, `wb:set-token-vars`, `wb:set-canvas-theme` (canvas scenes
only — see §"The theme bridge" below for why the DOM path does not need it).

**Theme is deliberately absent from that list.** There is no `wb:set-theme`;
DOM scenes ride the pre-existing `theme-change` message, for the reason in the
first bullet below. `wb:set-canvas-theme` is a genuine new typed message and is
listed above, because a canvas scene cannot be reached by either mechanism.
frame → host: `wb:ready` (carrying the runtime-selectable id set), `wb:select`,
`wb:hover`, `wb:measured`, `wb:error` (`mount` | `render` | `compile` | `fetch`),
`wb:classes`, `wb:route-change` (a navigation landed outside the scene's own
route — see the two-way route sync in `design-editor-sandbox-recipe.md` §2.11), `wb:deselect`
(a click, picking on, landed on a non-selectable area).

Three things worth recording:

- **Theme is NOT a new message for DOM scenes.** `components/theme-provider.tsx`
  already detects an iframe, skips `localStorage`, reads `?theme=` and listens for
  `postMessage({type:'theme-change'})` from the same origin — it was built for the
  homepage's live-demo iframe. The sandbox sends exactly that and drives the real
  provider, rather than toggling a class the provider would then fight over.
  `theme-change` is therefore the wire form, and there is no `wb:set-theme` in
  `frame-protocol.ts`. Canvas scenes are the exception and do get a typed
  message, `wb:set-canvas-theme`, because they never mount the provider at all.
- **Picking is a MODE, not a modifier.** A click on `<Link to="/login">` is either
  a selection or a navigation; it cannot be both. The frame listens on the
  *capture* phase and calls `preventDefault` + `stopPropagation`, because a
  bubble-phase listener runs after React's handler — by then the router has
  already navigated, and with `MemoryRouter` there is no URL to reveal it, so it
  reads as "selection is broken".
- **The selection overlay is DOM, not a CSS outline on the target.** An `outline`
  changes the subject's own computed style, which is the thing being judged, and
  it is clipped by any ancestor with `overflow: hidden` (the sidebar, the table).
  Absolutely-positioned boxes appended to `<body>` are never clipped and never
  touch the subject. They carry `data-wb-overlay` so hit-testing, class reporting
  and the frame's own MutationObserver all exclude them — without that last one
  the observer would fire on the overlay's own writes and spin a rAF loop forever.

### 7.12 HMR state preservation (`scenes/hmr-state.ts`)

A layout-edit preview and a token-edit's post-write refresh both land through
Vite's normal Fast Refresh path (`server.reloadModule`, §7.1/§7.3), which
preserves REACT state (hooks) across the patch but not DOM-only state:
`document.activeElement` is a real DOM node identity, and Fast Refresh only
guarantees the same component keeps its hooks — the concrete `<input>`
underneath it can still be torn down and rebuilt. Without this, a designer
mid-edit — typing a rename, scrolled partway down a long list — loses the caret
and the scroll position on every class tweak.

`installHmrStatePreservation()` (called once from `scene-entry.tsx`, at module
scope, same idempotence discipline as `installPicker`/`installFetchGuard`) hooks
Vite's global `vite:beforeUpdate` / `vite:afterUpdate` events:

- **Capture**, on `vite:beforeUpdate`: the focused element's nearest stamped
  ancestor-or-self (`data-wb-fp`, not the DOM node itself — see below), its
  `selectionStart`/`selectionEnd` if it is an `<input>`/`<textarea>`, every
  stamped element that is actually scrolled, and the page-level scroll.
- **Restore**, on `vite:afterUpdate`, deferred one `requestAnimationFrame`: the
  event fires once the module graph has swapped, but React's own re-render from
  the Fast Refresh boundary is not guaranteed to have committed to the DOM yet —
  restoring synchronously would silently no-op against the pre-render tree.

**Why key on `data-wb-fp` rather than the DOM node.** The focused element
before the patch and the (possibly different) element at the same JSX position
after it are not `===`. `data-wb-fp` is exactly the identifier built to survive
this: its whole design (§5.7, `jsx-nodes.mjs`) excludes className content and
the child-tag sequence so a node keeps its fingerprint across the kind of edit
that triggers this very refresh. Re-querying `[data-wb-fp="…"]` after the patch
finds the new DOM node standing in for the same source node — the identical
"stale coordinate, stable fingerprint" property the anchor-resolution model
(§5.7) already relies on, reused for a read-only UX nicety instead of a write.
A `data-wb-fp` can name several DOM nodes at once (a `.map()` row renders it
once per item); restoring picks the first document-order match rather than
refusing — worst case a sibling row's identical field gets the caret back
instead of the exact one, never a wrong file, so refusing here would be the
wrong trade-off.

**Explicitly not preserved:** open dropdowns and live tooltips (portaled,
transient, no stable identity to re-anchor on — re-opening one after every
keystroke would be its own bug), and contenteditable selection (out of scope
because no DOM scene in the current manifest uses it; the same reasoning CP4
gives for deferring canvas-specific shims until a scene needs them).

---

## 8. Verification recipe (how to prove the engine works, no browser needed)

```bash
# Bridge liveness (+ the session id the client keys its history on)
curl -s localhost:5173/__design-editor/api/health                                     # {"ok":true,"sessionId":…}
curl -s -o /dev/null -w '%{http_code}\n' localhost:5173/__design-editor/api/mutate    # 405 (POST-only)

# Introspection: bindings + palette + scales + themeMappings
curl -s localhost:5173/__design-editor/api/introspect | python3 -m json.tool

# Dry-run a palette rebind (writes an EXPRESSION, not a hex)
curl -s -X POST localhost:5173/__design-editor/api/mutate -H 'Content-Type: application/json' \
  -d '{"kind":"token-rebind","file":"packages/core/src/tokens/semantic.ts","constName":"light","path":["primary"],"tokenValue":"palette.butter","dryRun":true}'

# Dry-run a palette cascade
curl -s -X POST localhost:5173/__design-editor/api/mutate -H 'Content-Type: application/json' \
  -d '{"kind":"palette-value","file":"packages/core/src/tokens/palette.ts","path":["syrup"],"tokenValue":"#B865aa","dryRun":true}'

# Dry-run token creation in each family (3 files each; check the diff sections)
curl -s -X POST localhost:5173/__design-editor/api/mutate -H 'Content-Type: application/json' \
  -d '{"kind":"member-add","family":"palette","camelKey":"mocha","kebabKey":"mocha","tokenValue":"#6F4E37","dryRun":true}'
curl -s -X POST localhost:5173/__design-editor/api/mutate -H 'Content-Type: application/json' \
  -d '{"kind":"member-add","family":"radius","camelKey":"pill","kebabKey":"pill","tokenValue":"9999px","dryRun":true}'

# Dry-run introducing an interaction state (additions) and un-introducing it
curl -s -X POST localhost:5173/__design-editor/api/mutate -H 'Content-Type: application/json' \
  -d '{"kind":"class-rewrite","file":"packages/frontend/src/components/ui/button.tsx","cvaName":"buttonVariants","axis":"variant","value":"default","replacements":[],"additions":["active:bg-primary/80"],"dryRun":true}'

# "none — use resting colour": delete a state class the source declares
curl -s -X POST localhost:5173/__design-editor/api/mutate -H 'Content-Type: application/json' \
  -d '{"kind":"class-rewrite","file":"packages/frontend/src/components/ui/button.tsx","cvaName":"buttonVariants","axis":"variant","value":"default","replacements":[],"removals":["hover:bg-primary/90"],"dryRun":true}'

# Would a save succeed? (writes nothing; shares composeIntents with /commit)
curl -s -X POST localhost:5173/__design-editor/api/validate -H 'Content-Type: application/json' \
  -d '{"intents":[{"kind":"class-rewrite","file":"packages/frontend/src/components/ui/button.tsx","cvaName":"buttonVariants","axis":"variant","value":"default","replacements":[{"from":"bg-primary","to":"bg-secondary"}]}]}'

# Tailwind candidate registration (unsafe strings must land in `rejected`)
curl -s -X POST localhost:5173/__design-editor/api/candidates -H 'Content-Type: application/json' \
  -d '{"classes":["hover:bg-chart-4/45","BAD Class!","a\"); content: url(evil"]}'

# --- Phase 3 -----------------------------------------------------------------

# The scene node trees (paths + fingerprints the client anchors on)
curl -s localhost:5173/__design-editor/api/metadata | python3 -c \
  'import json,sys; d=json.load(sys.stdin); [print(s["id"], s["kind"], list(s["roots"])) for s in d["scenes"]]'

# The frame module: real path + ?wbFrame=, stamped, NOT a `virtual:` id (§7.8)
curl -s "localhost:5173/@fs$PWD/packages/frontend/src/app/login/page.tsx?wbFrame=after" \
  | grep -o '"data-wb-file": "[^"]*"' | sort -u

# Publish a staged plan to the AFTER frame, then diff the two sides (§3.9)
curl -s -X POST localhost:5173/__design-editor/api/plan -H 'Content-Type: application/json' \
  -d '{"side":"after","intents":[{"kind":"layout-props","anchor":{...},"classOps":{"replacements":[{"from":"text-[19px]","to":"text-[21px]"}]}}]}'
# …then re-fetch both frames; only `after` carries text-[21px]. Nothing is on disk.
# An empty `intents` reverts it — that is the union-invalidation case.

# Drill-in: the node tree of a file the manifest never listed
curl -s 'localhost:5173/__design-editor/api/metadata?file=packages/frontend/src/app/documents/document-list.tsx' \
  | python3 -c 'import json,sys; print(list(json.load(sys.stdin)["nodes"]["roots"]))'

# Staged token preview — the `--wb-*` path a client-side cascade cannot compute
curl -s -X POST localhost:5173/__design-editor/api/preview-tokens -H 'Content-Type: application/json' \
  -d '{"intents":[{"kind":"palette-value","file":"packages/core/src/tokens/palette.ts","path":["neutrals","light","bg"],"tokenValue":"#F5E6D3"}]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["base"]["light"]["--wb-bg"], "→", d["light"]["--wb-bg"])'

# A layout class edit (anchor fields come from /metadata)
curl -s -X POST localhost:5173/__design-editor/api/mutate -H 'Content-Type: application/json' \
  -d '{"kind":"layout-props","anchor":{"file":"packages/frontend/src/app/login/page.tsx","component":"LoginPage","path":[0,0,0,0],"tag":"Link","fp":"<fp>","fpx":"<fpx>"},"classOps":{"replacements":[{"from":"text-[19px]","to":"text-[21px]"}]},"dryRun":true}'

# A removal — note `removedText` in the response: that span IS the inverse payload
curl -s -X POST localhost:5173/__design-editor/api/mutate -H 'Content-Type: application/json' \
  -d '{"kind":"layout-remove","anchor":{"file":"packages/frontend/src/app/login/page.tsx","component":"LoginPage","path":[0,1,1,1,3],"tag":"span","fp":"<fp>"},"dryRun":true}'
```

### 8.1 The round-trips that must hold

Verified for this revision, and the checks to repeat after touching the injector:

1. **Promote-to-token batch** — `POST /commit` with `member-add` (semantic) +
   `class-rewrite`. Assert: the type member, both maps, the emitter line, the
   `@theme` alias and the rewritten CVA value are all present, `--primary-hover`
   appears in `dist/tokens.css`, and `packages/core` still typechecks (a missing
   type member or emitter shows up here as an excess-property error).
2. **Write-log revert** — `POST /undo` restores every file byte-for-byte
   (`cmp` against a pre-test snapshot, including `dist/tokens.css`).
3. **Undo-past-save via inverse intents** — commit `member-add` + `class-rewrite`,
   then commit the plan `saveDiff` would produce (`class-rewrite` with the swapped
   replacement + `member-remove`). Assert byte-identical to the snapshot. This is
   the path the editor's ⌘Z uses and it is NOT the same code as (2).
4. **Targeted HMR** — request `/src/sandbox.css` first (to populate the module
   graph the way a browser does), then commit a `palette-value`; the response's
   `hmr` must name `packages/core/dist/tokens.css`, not `full-reload`.
5. **Pure logic** — `states.ts` parsing/forcing and `edits.ts#saveDiff` have no
   DOM dependency, so they run headlessly:
   `pnpm --filter @wafflebase/design-editor smoke`. See `design-editor-sandbox-recipe.md` §7.
6. **Own writes are not "external"** — `POST /commit`, then `/health`:
   `fsRevision` must still be `0`. If our own writes register as external the
   client re-validates and toasts after every save, which trains the user to
   ignore the warning that matters.
7. **External change → stale verdict → drift guard.** Edit a tracked file outside
   the sandbox: `/health` reports `fsRevision: 1` with the file, `/validate`
   returns `located: false` with a reason naming the missing text, and `POST /undo`
   **refuses** with `409 conflict` rather than clobbering the external edit.
   Restore the committed content and `/undo` then succeeds.
8. **Candidate generation reaches an open page** — warm `/src/sandbox.css?direct`,
   register a class that appears in **no** file, then request the *same* URL again
   and assert the rule is present (§7.7). Testing with a cache-busting query
   passes even when the push is broken, so it must be the same URL.

**Phase 3 checks — run them with the two scripts rather than by hand:**

```bash
pnpm --filter @wafflebase/design-editor smoke
pnpm --filter @wafflebase/design-editor verify:bridge   # needs the dev server up
```

9. **Layout undo-past-save is byte-identical.** `/commit` a layout batch (props +
   remove@3 + insert@1), then `/commit` the inverse plan `saveDiff` produces
   (props + remove@1 + insert@3, ASCENDING), and assert the file is restored
   byte-for-byte. This is the assertion the whole ordering rule and the
   `removedText` capture exist for.
10. **Anchor relocation.** A stale `path` with a valid fingerprint still resolves,
    reported through `reason` as `relocated to path …`.
11. **Anchor ambiguity refuses.** Point an anchor at the two identical
    `<span>·</span>` nodes with a bad path: `located: false`, no write, and the
    reason names both candidate paths.
12. **Group atomicity.** A `groupId` batch whose second member cannot locate
    writes **zero files**; both members report `group aborted`.
12a. **Structural ops refuse outside a static scope.** A `layout-insert` anchored
    inside `documents.map(…)` → `located: false` naming the scope; the same
    anchor with `layout-props` → `located: true`.
12b. **The `expression` attribute guard holds.** `layout-props` with
    `valueKind: 'expression'` rejects `process.exit(1)`, `x; process.exit(1)`,
    `(() => {})()`, `a.b()` and a template literal, and accepts a bare dotted
    reference. Same discipline as `applyTokenValue`'s expression kind: the value
    comes from a browser and is spliced into a source file, so anything callable
    would be a remote-code-execution hole in a dev server.
13. **`build-css.ts` refactor is inert.** Regenerate `dist/tokens.css` from the
    pre-refactor source and `cmp` it against the current output.
14. **Metadata freshness.** After a `layout-insert` commit, `GET /metadata`
    shows the renumbered siblings and a bumped `revs[file]` without a restart.
15. **A rebase does not dirty the editor.** `editStateKey` excludes
    `path`/`fpx`, so re-pointing an anchor after a commit leaves `dirty` false
    and `saveDiff` empty (asserted in `smoke-layout.ts`).

**CP3 — the scene frame.** All of these run over plain HTTP, which is the
point: headless Chromium is unavailable in this environment, so the entire
module-graph half of the renderer is provable without a browser. What is *not*
covered here is whether the scene PAINTS; that list is in §9.

16. **The second entry exists and shares the host stylesheet.**
    `GET /scene.html` → 200, and `src/scene-entry.tsx` imports the SAME
    `sandbox.css` specifier `main.tsx` does. A copied `<style>` blob would freeze
    the frame's stylesheet — the §7.7 bug one level down.
17. **One numbering across all three consumers.** Every `data-wb-node` id in the
    served frame module exists in `/metadata` at the same path. *This check was
    vacuously true when first written*: it matched `data-wb-node="…"`, but the
    served bytes have been through `plugin-react` and carry `"data-wb-node": "…"`,
    so it asserted "all 0 ids are valid". Match both forms.
18. **One file, two frames, different content.** After a `layout-props`
    scene-preview, `?wbFrame=after` serves `text-[21px]` while `?wbFrame=before`
    still serves `text-[19px]`. This is §7.8's premise reduced to an assertion.
19. **An emptied plan un-patches the module** — the union-invalidation drop case
    (§3.9), and the one a naive implementation gets wrong.
20. **Propagation reaches a drilled-into file and stops at `node_modules`.**
21. **The whole scene-preview sequence writes nothing** (`git diff` clean).
22. **Every stamp says which file it came from.** The scene module emits exactly
    one `data-wb-file`, its own; a drilled-into module emits its own, not the
    scene's.
23. **The manifest fields the host needs actually arrive.** Every DOM scene in
    `/metadata` carries `route`, resolves a mount `component`, and the
    `<Outlet/>`-body scenes are marked `shell: "app"`. `route` was documented in
    `analyzeScene`'s signature and silently dropped, so `/metadata` and
    `virtual:wb-scenes` described the same scene differently.
24. **The app shell is in the frame graph and analysable.** `app/Layout.tsx`
    serves frame-qualified and stamped, and answers `/metadata?file=`. Clicking
    the sidebar depends on both, and neither is implied by the scene file working.

A real write (`"dryRun": false`) creates `<file>.bak`; restore with
`cp <file>.bak <file> && rm <file>.bak` then re-run `build-css.ts`. `.bak` is
gitignored, so leftovers from a session are invisible to `git status` — delete
them (`find packages -name '*.bak' -not -path '*/node_modules/*' -delete`) when
you are done, or a later session's backup-if-absent will preserve a stale
"original".

## 9. Roadmap & living TODOs

Project roadmap (authoritative):

| Phase | Scope | Status |
|---|---|---|
| **1 & 2** | Design Editor Engine & Token Sandbox — this engine + the token/CVA/palette sandbox UI | **complete** (Undo/Redo §3.4, token families §3.3b, state tiers §6.4, live sync §7.3) |
| **2.5** | Robustness — external-change sync + runtime Tailwind candidates | **complete** (§3.5, §3.6, §7.6, §7.7) |
| **3** | Layout Sandbox — `design-metadata.json`, layout intents, DOM + Canvas scenes, viewport + visual diff | **in progress** — CP2, CP3.1–3.4 and CP3.5 (the editing inspector, hardened) complete; **CP4 (Canvas scenes) in progress** |
| **4** | ~~Agentic PR Pipeline — approved AST diffs → Git commits → GitHub PRs~~ | **withdrawn** by the local-plugin pivot; a plugin running in the developer's own checkout writes their working tree directly (see the Phase 4 section below) |

### Phase 3 CP3.1–3.4 closeout — what landed in this revision

- **A second Vite entry per scene frame** (§7.8) and the `?wbFrame=` patched
  module id, with the `plugin-react` evidence for why a `virtual:` id cannot
  work, query propagation into first-party imports, and the stop at
  `node_modules`.
- **`POST /scene-preview`** (§3.9) — the staged plan as served bytes, union
  invalidation so dropping an intent reverts.
- **The stamping transform** (§7.9), now also emitting `data-wb-file`, without
  which a click cannot be attributed to a source file once the app shell puts a
  dozen files in one document.
- **`shell: "app"`** — `/documents`, `/datasources` and `/settings` mount inside
  the real `app/Layout.tsx` via a nested `MemoryRouter` route, because that is
  how `App.tsx` renders them. `/login` is the one scene that is genuinely a
  full-page route, which is exactly why it was the only one that looked right
  without this.
- **Real providers + URL-keyed fixtures + the kill-switch** (§7.10).
- **Click-to-select, the outline and drill-in** — capture-phase picking, a
  non-clipping DOM overlay, and `anchorFromStamp`'s three outcomes surfaced
  distinctly (resolved / ambiguous-so-refuse / created-this-session).
- **Token edits reach the frame** over `wb:set-token-vars` (§3.8), fed by
  `previewTokens` rather than the client-side approximation so `--wb-*` consumers
  actually repaint.
- **Two latent CP2 defects, found while building on them.**
  `analyzeScene`'s `component ?? Object.keys(roots)[0]` referenced an
  out-of-scope `roots` — a `ReferenceError` that would have taken out the whole
  `/metadata` response on the first mis-typed `export` in the manifest — and the
  same function silently dropped `route`.
- **Checks 16–24**, plus `scripts/smoke-scene.ts`.

### Phase 3 CP2 closeout — what landed in this revision

- **`design-metadata.json` on disk + `GET /metadata`** (§3.7), with a
  content-addressed cache, three invalidation paths, and `tracked` seeded from
  `scenes.config.json`. Closes the "live metadata" gap below.
- **Three layout intent kinds** anchored on a `NodeAnchor` (§5.7), with the
  scope + direct-child guards enforced server-side, `removedText` echo-back for
  exact inverses, and import maintenance.
- **`jsx-nodes.mjs`** — one definition of JSX child numbering, fingerprinting and
  anchor resolution, shared by the extractor, the injector, and (CP3) the
  stamping transform.
- **Atomic intent groups** (§5.8) — a half-applied move no longer loses a node,
  and a failed promote-to-token no longer orphans one.
- **`POST /preview-tokens`** (§3.8) + a parameterized `build-css.ts`, closing a
  PRE-EXISTING bug: a palette edit previewed as nothing on every `--wb-*`
  consumer, which is most of the Login page.
- **The asymmetric ordering rule** in `saveDiff` (§5.9), and `editStateKey`
  ignoring coordinate hints so a post-commit rebase cannot leave the editor
  spuriously dirty.

### Phase 2.5 closeout — what landed in this revision

- **External-change sync.** `fsRevision` + `externalChanges` on `/health`, an mtime
  sweep that works where inotify does not, and `POST /validate` sharing
  `composeIntents` with `/commit` so a verdict cannot disagree with the writer
  (§3.5, §7.6). The client marks the affected edits stale and offers a discard —
  previously an external edit left the editor permanently dirty with an
  unsatisfiable plan.
- **Runtime Tailwind candidates.** `POST /candidates` → `@source inline(...)` in a
  generated stylesheet, plus the explicit module invalidation without which the
  open page keeps its old CSS (§3.6, §7.7). This is the actual cause of "alpha only
  works for `primary` at 90%": every other role/opacity combination had no CSS rule
  at all. The parser and emitter were never wrong.
- **`PlanItem` carries `(map, key)`.** A plan item is now traceable to the staged
  edit that produced it, which is what makes "discard the edit that can't be
  applied" possible at all. Without it a stale edit could be reported and never
  cleared.

### Phase 2 closeout — what landed in this revision

- **Token creation, all four families.** `member-add`/`member-remove` replace the
  colour-only `token-add` and now also write the **`@theme inline` alias**, so a
  created token is a usable utility class rather than a bare CSS variable
  (§3.3b, §5.4, §5.5). The Radius/Typo "not wired yet" gap is closed.
- **Interaction states** as a first-class layer, both tiers (§6.4), including
  `additions`/`removals` on `class-rewrite` (§5.1).
- **Default-value sync.** Introspection carries `scales` + `themeMappings`, and
  the editor takes every default from source (§3.2, the default-value rule).
- **Post-write live update.** Regeneration failures surface as `regenError`, and a
  targeted module reload replaces the manual dev-server restart (§7.3).
- **Editor-level undo/redo, persisted.** The transaction log stays as the *file*
  history; the editor's own edit history lives client-side and is keyed on
  `sessionId` (§3.1). See `design-editor-sandbox-recipe.md` §6 for the model, and note the
  division of labour: `POST /undo` reverts a **write**, ⌘Z steps through **edits**
  and expresses itself as inverse intents on the next save.
- **Multi-hunk diffs** (§5.6), without which a token creation's review was
  unreadable.

Remaining known gaps (unchanged in kind, worth restating):

- ~~**Live metadata.**~~ **Closed by §3.7.** `mock-metadata.ts` is now only the
  bridge-offline fallback; the live tree comes from `GET /metadata` and is
  re-read after every write and every external change.
- **No automated browser test** in this environment (headless Chromium needs
  system libs). The engine is covered by §8's curl round-trips plus
  `scripts/verify-bridge.mjs` and `scripts/smoke-layout.ts`; UI behaviour is
  verified by hand in `pnpm --filter @wafflebase/design-editor dev`.
- **`clickSelectable` is conservative.** It is set from the tag case, since
  whether a component spreads `{...props}` cannot be known from the scene file.
  Component nodes therefore read as outline-selectable only; CP3 upgrades this at
  runtime by checking whether the stamped attribute reached the DOM.
- **Inserting into a self-closing element is refused.** Converting `<X/>` to
  `<X></X>` would make the inverse non-byte-identical, so the parent is reported
  as having no children region rather than being silently reshaped.
- **`AgentPopover.onSubmit` is still a stub** (`console.log` + an inline
  confirmation) — the intended Phase 4 entry point.

### Phase 3 — Layout Sandbox (in progress)

### CP3.5 closeout — what landed in this revision

**The editing inspector**, built as a superset of the original scope (which
described click-and-form only, no drag handles):

- **Figma-style floating class editor** (`FloatingClassEditor.tsx`) — opens
  anchored to the selected node in HOST-page pixels (§7.11's
  `onSelectionHostRect`), closed-enumeration quick controls for
  direction/align/justify/gap/size plus a raw class-chip escape hatch, and a
  **draggable header** so the panel can be moved out of the way of the node it
  describes. Dragging maintains an offset on top of the anchor position, reset
  only on a genuinely new selection (keyed on the stamp id) — not on every
  `hostRect` update a scroll or zoom change produces, or the panel would jump
  back to the anchor mid-drag.
- **The editor now opens on a node with no `className` attribute at all**,
  starting from an empty class list rather than staying hidden. Previously one
  `className === null` check collapsed two different node shapes — "no
  attribute" and "a dynamic expression like `cn(...)`" — into the same
  unsupported case, and list rows built from thin wrapper components
  (`<TableRow>`, `<SidebarMenuItem>`) hit it disproportionately, reading as a
  `.map()`-scope restriction that does not actually exist (`layout-props`
  classOps has never had a scope guard). `applyLayoutProps` (`inject.mjs`) was
  extended to CREATE a fresh `className="…"` attribute via the same
  append-after-tag-name splice the `sets` loop already used, rather than
  silently no-op'ing. The genuinely dynamic-expression case remains read-only
  by design, to avoid clobbering real logic.
- **Figma-style click-to-cycle selection** (`frame-picker.ts`). Repeated clicks
  at the same screen location walk up the stamped ancestor chain
  (`stampChainAt`) one step per click, wrapping past the outermost node into a
  deselect and back to the deepest node on the next click. Ctrl/Cmd+click
  bypasses the cycle and jumps straight to the deepest stamped node under the
  cursor. The cycle resets both on a new click location and on a
  host-driven `wb:set-selection` (e.g. from the outline panel), so a stale
  cycle position cannot resume against a selection the user did not click into.
- **DevTools-style freeform viewport resize** (`SceneHost.tsx`). Three drag
  handles (right / bottom / corner) on a `relative` footprint wrapper sized to
  the stage's own on-screen dimensions, sitting as a SIBLING of the
  `scale()`d stage rather than a descendant — a handle living inside the scaled
  box would itself shrink at low zoom. Dragging sets a `customSize` override in
  the same real, unscaled pixel space `VIEWPORT_WIDTH` uses, read once at
  `pointerdown` so a dropped `pointermove` cannot compound into drift; a preset
  viewport button clears it, so the two controls never fight over which is
  authoritative. The handles sit flush against their edges (`right-0`/`bottom-0`)
  rather than straddling them (`-right-1.5`/`-bottom-1.5`) — the straddled form
  caused an infinite scrollbar-thrash loop: the overflow it created shrank the
  `ResizeObserver`-measured content, which shrank the box, which the handles
  still spilled past by the same margin. The `ResizeObserver` callback also
  rounds its measurement and no-ops when the size is unchanged, as defense in
  depth against sub-pixel oscillation.
- **The Mock Data toggle** (`fetch-fixtures.ts#emptyFixtureTable`,
  `frame-protocol.ts#sceneFrameUrl`). A button in the scene controls reloads
  the current scene with every array in every fixture recursively emptied to
  `[]`, so a designer can check a list/table's empty state without a
  hand-authored "empty" fixture variant per scene. Read once at frame load via
  `?empty=1` (like `theme`/`scene`/`frame`), not over `postMessage` — flipping
  it is a full frame reload by design, the same reasoning `sceneFrameUrl`
  already applies to every other frame parameter.
- **A real, previously undiscovered bug, fixed alongside the above.** Four
  workspace-scoped scenes — Documents, Data Sources, Analytics, Settings — were
  silently rendering with none of their data. `scenes.config.json`'s `route`
  field (a literal fixture path like `/w/ws-fixture`) was reused as BOTH the
  `MemoryRouter`'s location AND the literal `<Route path>` PATTERN in
  `providers.tsx`; a literal path has no `:workspaceId` segment, so
  `useParams<{ workspaceId }>()` in every one of those pages always resolved to
  `undefined`, and TanStack Query's `enabled: !!workspaceId` disabled the query
  with no visible error. Fixed by adding a separate `routePattern` manifest
  field, threaded through `extract.mjs` → `/metadata` → `scene-entry.tsx` →
  `SceneProviders`, used as the `<Route path>` instead of the literal `route`.

**CP3.5 hardening:**

- **`edits.ts`'s `HINT_KEYS` replacer now applies to all six edit maps**, not
  only `layoutEdits`. Only `layoutEdits` has a `path`/`fpx` field today, so this
  is currently a no-op on the other five — which is exactly what makes it safe:
  the previous scoping was a live trap where any future field merely NAMED
  `path` or `fpx` on `classEdits`/`tokenEdits`/etc. would silently vanish from
  its own dirty check.
- **`PendingLayoutEdit.key` and `sceneId` — already resolved, correcting a
  stale claim in an earlier revision of this section.** That revision said the
  key "omits `sceneId`, so two scenes over one file collide." Re-reading
  `layoutEditKey` (added earlier, in the CP3.1–3.4 pass) shows this was already
  addressed, deliberately, and NOT by adding `sceneId`: the key folds in
  `anchor.file` and folds out `sceneId` on purpose. Two scenes that both render
  the same drilled-into file editing the "same" node must land on the SAME
  entry — it is a change to one physical file, and `SceneOutline`'s own
  "affects every render site" warning already says so. Keying by `sceneId`
  would let two scenes stage two independently-committable edits to one node,
  and whichever committed second would silently clobber the first with no
  conflict signal. What `layoutEditKey` actually guards against is two
  DIFFERENT files producing the same caller-built discriminator string
  (plausible, since callers build it from op + path with no file component) —
  which including `anchor.file` in the key already prevents. No code change was
  needed; the "remaining loose end" was a documentation defect, not a code one.
- **HMR state preservation**, now implemented (`scenes/hmr-state.ts`). The
  active element's nearest stamped ancestor-or-self (`data-wb-fp`, not the DOM
  node itself — React Fast Refresh preserves hook state across a patch but not
  DOM node identity), its text-input selection offsets, every scrolled stamped
  container's offset, and the page-level scroll are captured on Vite's global
  `vite:beforeUpdate` event and restored on `vite:afterUpdate` (deferred one
  `requestAnimationFrame`, since the module-graph swap firing that event does
  not guarantee React's own re-render has committed to the DOM yet). Keying on
  `data-wb-fp` rather than a DOM reference is what makes this survive the exact
  kind of edit that triggers the refresh — the fingerprint is designed to
  exclude className content and the child-tag sequence for precisely this
  reason (§5.7). Explicitly not preserved: open dropdowns and live tooltips,
  which are portaled, transient, and have no stable identity to re-anchor on —
  and contenteditable selection, out of scope because no DOM scene in the
  current manifest uses it.

**CP4 — Canvas scenes (in progress).** Real engines mounted in a scene frame.
The plan below is approved; the full checklist lives in
`docs/tasks/active/20260729-design-editor-layout-sandbox-todo.md`.

An earlier revision of this line said CP4 would seed `Mem*Store`s. **It will
not**, and the reason is worth recording because the wrong version is the
obvious one: the canvas pages construct `YorkieStore` / `YorkieDocStore` /
`YorkieSlidesStore` from `doc` themselves, so injecting a `MemStore` would need
a new prop on a frontend component. Seeding the DOCUMENT instead keeps the real
store, the calculator and the renderer in the code path — strictly more faithful
than the store swap would have been, and it needs no frontend change at all.

- **A detached Yorkie `Document` is fully functional offline.** Probed against
  `@yorkie-js/sdk@0.7.13`: at `status = detached`, `update()` works for both the
  root and presence callbacks, `Tree`/`Text` seeding works, local `subscribe()`
  events fire, and `doc.history.canUndo()` answers. **Only the `Client` touches
  the network** — activate, attach, watch. So the sandbox mocks the React
  BINDING that would have attached a document: a shim over `@yorkie-js/react`
  overriding `YorkieProvider` / `DocumentProvider` / `useDocument` /
  `usePresences` and nothing else. No faked WebSocket, no faked document. This
  is a load-bearing assumption about a third-party package, so §8.1 gains a
  check pinning it — a Yorkie bump that makes detached `update()` throw would
  otherwise kill every canvas scene with no other signal.
- **The shim must RE-EXPORT the real module, never reimplement it.**
  `@yorkie-js/react`'s dist bundles its own copy of the SDK (857 KB, zero
  external imports), so `react.Text !== sdk.Text` — the trap
  `packages/frontend/src/types/notes-document.ts` already documents.
- **THE ONE-REALM INVARIANT.** An earlier revision of the bullet above said the
  mock document is "constructed from `@yorkie-js/react`'s own `Document`". It
  cannot be: **`@yorkie-js/react` does not export `Document`** — it exports
  `Counter`, `Text`, `Tree`, `SyncMode` and the hooks/providers, nothing more.
  The shim's `Document` therefore comes from `@yorkie-js/sdk`, the standalone
  copy, and that fixes which realm the sandbox lives in.
  Everything else must follow it. The SDK's `buildCRDTElement` dispatches on
  `value instanceof Text` / `instanceof Tree` and its fallthrough is a **silent
  `CRDTObject.create(...)`, not a throw** — a wrong-realm value is quietly
  flattened into a plain object. Then `docs-view.tsx#ensureTree` and
  `notes-view.tsx#ensureText`, seeing a `root.content` with no
  `getRootTreeNode` / `edit`, conclude the document needs initializing and
  **replace it with an empty one**. So a single wrong import specifier does not
  error — it wipes the fixture and renders a blank document. Measured: a
  react-realm `new Text()` in an sdk-realm `Document` becomes
  `{"context":null,"text":null}`, byte-for-byte the symptom `notes-document.ts`
  warns about.
  The shim therefore re-exports `Tree` / `Text` / `Counter` from
  `@yorkie-js/sdk`, shadowing its own `export *` (a local export wins over a
  star export), so every CRDT class scene code can reach shares the `Document`'s
  realm. **This does not cost production fidelity**: both packages are 0.7.13
  and react's bundle is a verbatim copy of the same source, so the realms are
  behaviourally identical and differ only in class identity. Production is
  uniformly react-realm; the sandbox is uniformly sdk-realm. Same code, same
  CRDT, same pixels — what breaks is never *which* copy but *mixing* the two.
  Pinned by `scripts/smoke-canvas.ts`, which asserts both the guard's presence
  and the silent-degradation behaviour that makes it necessary.
- **Seeded fixtures hold what the ENGINE would have persisted**, not
  hand-authored approximations — the same "reuse the real code path, substitute
  only data" rule as the HTTP fixtures. Two findings forced this and both were
  silent: `toSref` is **1-based on both axes** (`toSref({r:0,c:0})` yields the
  bare sref `"0"`, which `parseRef` rejects), and a formula cell must carry its
  computed `v` because `toDisplayString()` opens `if (!cell || !cell.v) return
  ''` and **nothing recalculates on load** — `calculate()` is reached only from
  mutation paths. A formula seeded without its value renders blank. The sheets
  fixture's values are generated by driving `Sheet` + `MemStore` with `setData`,
  and `scripts/smoke-canvas.ts` re-derives them from the engine on every run, so
  a drifted fixture fails the build instead of quietly painting the wrong grid.
- **The `util` / `assert` shims land here**, as the note in `vite.config.ts`
  always said they would — aliased to the frontend's existing
  `src/lib/util-shim.js` / `assert-shim.cjs` rather than copied, so the two
  cannot drift. All three of the frontend's mechanisms are needed: the
  `resolve.alias` pair, the `antlr4tsAssertShim()` pre-plugin for
  `require("assert")` from inside antlr4ts, and the `optimizeDeps` esbuild
  interception for dep pre-bundling.
- **Canvas hit-testing adds a READ path and reuses the existing WRITE path.**
  The engines build their DOM imperatively (`initialize(container, …)` creates
  the canvas, formula bar, cell input and autocomplete in engine code, not
  JSX), so nothing inside the engine region is stamped and `stampedAt()`
  terminates at the container `<div>`: picking does not break, it becomes one
  giant node. `frame-picker.ts` gains a probe registry that hands the click to
  the engine's OWN exported hit-test — `sheets/src/view/layout.ts#toRef`,
  `slides/src/view/editor/hit-test-elements.ts#hitTestSlide`,
  `docs/src/view/image-selection-overlay.ts#findImageAtPoint` — never a
  reimplementation, the same discipline `jsx-nodes.mjs` enforces for JSX
  numbering. A canvas hit has no `className`, so the inspector switches to the
  theme keys that painted the object, each editable through the `palette-value`
  / `token-value` intents that already exist. No new mutation kind, no new
  endpoint, no server change.
- **The theme bridge closes §3.8's outstanding claim.** That section already
  says the token delta is applied "as a theme-object patch (canvas scenes)";
  it is not, and a canvas cannot see `wb:set-token-vars` because
  `sheets/src/view/theme.ts` reads `palette.syrup` at module-eval into a plain
  object. A new `wb:set-canvas-theme` carries the delta `/preview-tokens`
  already computes from the real emitter, applied by substitution against the
  engines' live theme values and followed by a repaint. Rejected: propagating
  `?wbFrame=` into `palette.ts` so the theme module re-evaluates from patched
  bytes — correct by construction, but it invalidates hundreds of importers,
  i.e. a full frame reload per colour-picker keystroke. That is what happens
  after a real save anyway, through the HMR path in §7.3.

Scene set: `sheet-editor`, `docs-editor`, `slides-editor`, `notes-editor`.
`pdf-viewer` is deferred — a binary fixture, the pdf.js worker and the
`cmaps`/`standard_fonts` middleware for a scene that exercises almost no
design-system surface. The deferral is carried by an explicit `deferred: true`
in the manifest rather than by narrowing `scenesRegistry()`'s `kind` filter, and
that flag is load-bearing: widening the filter from `"dom"` to `"dom" |
"canvas"` silently enrolled `pdf-viewer`, and a loader entry is not free even
when never clicked — its specifier is statically analysable, so Vite's
dependency scanner crawls it into `file-detail.tsx` → `pdfjs-dist` (including a
static `?url` worker import), which this package can resolve neither as a
dependency nor via an alias. `deferred` keeps the entry and its curation notes
while emitting no loader, so the scene simply does not appear in the picker. `sheet-editor` is also re-pointed from
`sheet-view.tsx#SheetView` to `document-detail.tsx#DocumentDetail`: `SheetView`
requires a `tabId` prop and calls `useDocument()` with no `DocumentProvider` in
its own tree, while the other three canvas scenes already name the page-level
component that owns the provider. `sheet-view.tsx` stays reachable through the
outline's drill-in, which is what drill-in is for.

Canvas scenes are **editable but ephemeral**, not read-only: the manifest's
`readOnly: true` documents that nothing persists. Typing in a cell is how the
active cell editor gets judged, and an offline document cannot reach a server.
Known limitation, documented rather than papered over: presence writes do not
stick on a detached document (`getMyPresence()` stays `{}`,
`getOthersPresences()` is `[]`), so peer avatars render empty and
`use-presence-updater` is inert — presence is a collaboration surface, not a
design one.

**What only a browser can check.** Headless Chromium is unavailable here, so
these are by-hand in `pnpm --filter @wafflebase/design-editor dev`, and saying so is
part of the spec: that a scene paints and paints *like the app*; click-select
accuracy and outline↔frame highlight sync; focus / selection / scroll survival
across an HMR patch; viewport truthfulness (`useIsMobile` flipping at 768);
portal and dropdown behaviour inside the frame; the theme flip.

`pnpm --filter @wafflebase/design-editor verify:frame` narrows that list: it walks
the frame's import graph (every specifier Vite rewrote) and asserts a 200 on each
— ~1100 modules today. It is the closest headless proxy for "it mounts", and it
is what caught the unresolvable engine packages, which no other check in this
package could see. It cannot see a runtime throw, a missing fixture, or a wrong
layout, so it is a floor rather than a substitute.

### Phase 4 — Agentic PR pipeline (withdrawn)

**Withdrawn by the local-plugin pivot** (`design-editor-local-plugin.md`). It is
recorded here because the reasoning is worth keeping, not because it is planned.

The plan was to convert a batch of approved intents into a Git branch +
commit(s) + a GitHub PR instead of / in addition to writing the working tree.
The engine already produces per-intent diffs, backups, and a transaction log
with before/after text for every file it touched — which is most of a commit;
what was missing was branch creation, commit-message synthesis from intent
labels, and `gh`/API PR creation.

The pivot removes the premise rather than the remaining work. As a **local Vite
plugin** the editor runs inside the developer's own checkout against their own
working tree, so the commit they were going to review in a PR is a commit they
can now make directly, with their normal tooling and review flow. A pipeline
that opens PRs against the repository it is already running inside adds a round
trip and a second identity to authenticate, and buys nothing the working-tree
write does not already give.
