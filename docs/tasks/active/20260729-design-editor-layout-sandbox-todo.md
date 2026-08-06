---
title: design-editor-layout-sandbox
target-version: 0.2.0
---

# Design Editor Phase 3 — Layout / Scene Sandbox

Extends the design sandbox from single-component token editing to editing whole
layouts (Login, Settings, Documents, Datasources, Analytics, and the canvas
editor routes) with edits landing in source.

Architecture: the approved Checkpoint 1 plan. Design docs to update on landing:
`design-editor-engine.md` §2/§3/§5/§8/§9 and `design-editor-sandbox-recipe.md` §2/§6/§8.

> **⚠️ Superseded in part by the local-plugin pivot** —
> [`docs/design/design-editor/design-editor-local-plugin.md`](../../design/design-editor/design-editor-local-plugin.md).
> The package is now shipped as an installable Vite plugin
> (`@wafflebase/design-editor`) with wafflebase's own configuration split out
> into `packages/design-sandbox`. Three consequences for the checkpoints below:
>
> 1. **CP4.4 (canvas hit-testing) is deferred.** Canvas scenes are a wafflebase
>    concern that moves to `design-sandbox`; the design system being edited lives
>    in the DOM scenes. Without 4.4 the canvas scenes remain render-only.
> 2. **CP4.5 (theme bridge) is kept** — small, and it closes a claim engine §3.8
>    currently *documents but does not implement*.
> 3. **CP4.6 (verification + doc closeout) is required before anything else.**
>    Engine §3.8 overstates the engine today and CP4.3 shipped four defects that
>    `tsc` and `smoke` both missed; a pivot built on overstated docs compounds.
>
> **CP5 (diff engine) is unchanged.** The Phase 4 GitHub-PR pipeline is
> **withdrawn** — the plugin writes to the consumer's working tree, so `git diff`
> is the review surface. The agent loop survives and is the MVP.

## Checkpoints

- [x] **CP1 — Architecture** (approved)
- [x] **CP2 — Metadata + intents, no UI** (commit `5c9e7c45d`)
- [x] **CP3 — DOM scene renderer** (through commit `cef77b42f`)
  - [x] CP3.1 — second Vite entry + frame skeleton
  - [x] CP3.2 — patched-module plugin, `POST /scene-preview`, stamping transform
  - [x] CP3.3 — real providers, the app shell, URL-keyed fixtures, fetch kill-switch
  - [x] CP3.4 — click-to-select, outline, drill-in, scene metadata wiring
  - [x] CP3.5 — floating class editor, click-to-cycle, Mock Data, HMR state,
        CP2 hardening. Structural controls and direct text editing were scoped
        OUT (see the corrected CP3.5 list below), and browser verification
        remains open.
- [ ] **CP4 — Canvas scenes**
  - [x] CP4.1 — Node shims + engine/Yorkie resolution
  - [x] CP4.2 — the offline Yorkie provider
  - [x] CP4.3 — canvas scene mounts + seeded fixtures
  - [ ] ~~CP4.4 — canvas-aware hit-testing~~ **deferred** (pivot, note above)
  - [ ] CP4.5 — the theme bridge
  - [ ] CP4.6 — verification + doc closeout ← **current**
- [ ] **CP5 — Diff engine + doc closeout**
- [ ] **Packaging — the two-package split** (`design-editor-local-plugin.md` §6)

## CP2 scope — done

Provable entirely by curl + `tsx`; no browser required.

- [x] `src/server/jsx-nodes.mjs` — `walkJsx` / `fpOf` / `scopeOf` / `resolveNode`.
      One definition of child numbering, shared by the extractor, the injector and
      (CP3) the `data-wb-node` transform. Three implementations would drift.
- [x] `src/server/extract.mjs` — importable library; `scripts/extract-design-metadata.mjs`
      becomes a CLI wrapper preserving its documented stdout usage.
      Emits `SceneMeta.roots` (one walkable root per JSX-returning function) and
      per-node `scope`.
- [x] `scenes.config.json` — committed manifest.
- [x] `inject.mjs` — `applyLayoutProps` / `applyLayoutInsert` / `applyLayoutRemove`,
      `insertImport` / `removeImport`, `removedText` echo-back.
- [x] Atomic intent groups in `composeIntents` (a half-applied move loses a node).
- [x] `build-css.ts` parameterized + `preview-tokens.mts` worker + `POST /preview-tokens`.
- [x] `GET /__design-editor/metadata` — content-addressed cache, three invalidation
      paths, `tracked` seeded from the manifest.
- [x] Client contract: `layoutEdits` in `EditState`, translators + inverses,
      the asymmetric ordering rule in `saveDiff`, `stableKey` in `editStateKey`,
      `anchors.ts`, `history.rebaseAnchors`.
      *(`anchors.ts#planRebase` and `history.rebaseAnchors` are written and tested
      but still have no callers — see CP3.5 item 2.)*
- [x] Verification: engine checks 9–15 + 12a, plus the pure-logic smoke script.

## CP3.1–3.4 scope — done

- [x] `scene.html` + `src/scene-entry.tsx` as a **second Vite entry**, so each frame
      gets its own JS realm.
- [x] The patched module is `<real path>?wbFrame=<side>`, **not** a `virtual:` id —
      `@vitejs/plugin-react` filters on `id.split("?")[0]`, so a virtual id gets no
      JSX transform, no fast refresh, and no directory for relative imports.
- [x] Query propagation into first-party imports; stops at `node_modules`.
- [x] `POST /__design-editor/scene-preview` with **union invalidation**, so dropping an
      intent reverts the patch.
- [x] `src/server/stamp.mjs` — `data-wb-node` + `data-wb-fp` + `data-wb-file`,
      numbering imported from `jsx-nodes.mjs`, `.tsx`/`.jsx` only.
- [x] `SceneProviders` — real `MemoryRouter` / `QueryClient` / `ThemeProvider` /
      `TooltipProvider`, nesting mirroring `App.tsx`.
- [x] `shell: "app"` — the three `<Outlet/>`-body scenes mount inside the real
      `app/Layout.tsx` via a nested route.
- [x] URL-keyed fixtures (`shell` / `auth` / per-scene refs, layered widest-first)
      and the `window.fetch` kill-switch.
- [x] Engine-package source aliases — the DOM documents scene value-imports
      `@wafflebase/sheets` transitively.
- [x] Click-to-select (capture phase), the non-clipping DOM overlay, hover both
      directions, `wb:measure`, the picking mode toggle.
- [x] `SceneOutline` (tree, drill-in, breadcrumb) + `SceneNodeDetail` (the three
      anchor outcomes).
- [x] Token edits reach the frame over `wb:set-token-vars`, fed by `previewTokens`.
- [x] Right pane is mode-scoped: Token bindings hidden in scenes mode, Token Editor
      kept and made functional.
- [x] Verification: engine checks 16–24, `scripts/smoke-scene.ts`,
      `scripts/crawl-frame-graph.mjs` (`verify:frame`).

## CP3.5 scope — remaining

Ordered by how load-bearing they are, not by size.

- [x] **Wire `previewScene`.** Debounced 150 ms on the layout half of the plan,
      publishing the WHOLE plan (applies + reverts), because the frame composes
      from disk = the baseline. Publishes on mount too, including an empty plan —
      the bridge's stored plan lives on the dev server, so a reload would otherwise
      leave the frame patched with whatever the last session staged.
- [x] **Wire `planRebase` → `history.rebaseAnchors`** after every commit, write-log
      step and external change. Required fixing `planRebase` itself: it resolved
      every anchor against `scene.roots`, so any edit made through the drill-in —
      anchored in the component's file, not the scene's — was reported LOST on the
      first refresh. Now keyed on the anchor's own file, with drilled-into files
      re-fetched rather than dropped, and "no tree for this file" meaning *skip*
      rather than *stale*.
- [x] **Replace the module-level `ALL_COMPONENTS` / `FILE_OF`** with state seeded
      from `mock-metadata` and replaced by `GET /metadata`. An empty payload is
      ignored rather than applied.
- [x] `scripts/poke-scene-preview.mjs` (`pnpm … poke`) — stages a real layout edit
      from outside the UI so the loop can be watched before the inspector exists.
- [ ] **Browser verification.** Nothing has been seen rendering — every check so far
      is HTTP-level. See the by-hand list in `design-editor-engine.md` §9.
      **Still open, and it carries into CP4**: a canvas scene can satisfy every
      HTTP-level check and still paint nothing.
- [x] **The inspector — class editing half.** `FloatingClassEditor.tsx`: quick
      controls (direction/align/justify/gap/size) as closed Tailwind enumerations
      plus a raw class-chip escape hatch, staged as `layout-props` `classOps`
      through the existing pipeline. Also opens on a node with NO `className`
      attribute (`applyLayoutProps` creates one); genuinely dynamic `cn(...)`
      stays read-only.
- [ ] **The inspector — structural half. NOT SHIPPED, carried forward.** Direct
      text editing and Remove / Duplicate / ↑ / ↓. Duplicate is a `layout-remove`
      dry-run whose `removedText` becomes the `verbatim` insert payload; reorder is
      the grouped move. **No drag handles, no resize cursors.** The server side
      (`layout-insert` / `layout-remove` / groups / the ordering rule) has been
      done since CP2 — this is UI only. Note the consequence recorded in
      `design-editor-sandbox-recipe.md` §2.13: while nothing stages a structural edit, the
      baseline-built outline and the patched-frame stamps agree by construction.
      That stops being true the day this ships, and is the specific thing to
      re-check then.
- [x] **HMR state preservation** in the frame (`scenes/hmr-state.ts`) — keyed on
      `data-wb-fp` rather than the DOM node, since Fast Refresh preserves hook
      state but not DOM identity. Not preserved: open dropdowns, live tooltips,
      contenteditable selection.
- [x] **CP2 hardening (both defects closed).** `HINT_KEYS` stripping is scoped to
      `layoutEdits` in `edits.ts#editStateKey`, and `layoutEditKey(anchor,
      discriminator)` is the single key builder — folding in `anchor.file` (a real
      collision between two files whose op+path coincide) and deliberately NOT
      `sceneId` (two scenes drilling into one shared file must land on the same
      entry, or committing one silently clobbers the other).

## CP4 scope — Canvas scenes (current)

Mount the REAL Sheets / Docs / Slides / Notes engines in a scene frame, and make
the sandbox's selection and token-preview loops work against a render target that
paints instead of laying out DOM.

### Approved decisions

- **Scene set: `sheet-editor`, `docs-editor`, `slides-editor`, `notes-editor`.**
  `pdf-viewer` is DEFERRED — a binary PDF fixture, the pdf.js worker and the
  `cmaps` / `standard_fonts` middleware are real weight for a scene that exercises
  almost no design-system surface.
- **`readOnly` means EPHEMERAL, not inert.** The manifest's `readOnly: true` on
  canvas scenes stays as documentation of "nothing persists"; the offline document
  accepts real edits. Typing in a cell is how the active cell editor's look gets
  judged, and the edit can never leave the tab. If a scene ever needs to be truly
  inert, gate `update()` in the offline provider — one place, not per scene.

### The four findings this plan rests on (verify before doubting the plan)

1. **A detached Yorkie `Document` is fully functional offline.** Probed directly
   against `@yorkie-js/sdk@0.7.13`: with `status = detached`, `update()` works for
   both the root and presence callbacks, `Tree` / `Text` seeding works, local
   `subscribe()` events fire, and `doc.history.canUndo()` answers (which slides'
   native undo needs). **Only the `Client` needs the network** — activate, attach,
   watch. So CP4 mocks the React BINDING that would have attached a document; it
   does not fake a WebSocket and it does not fake a document.
   *This is a load-bearing assumption about a third-party package: CP4.6 pins it
   with a check, because a Yorkie bump that makes detached `update()` throw would
   kill every canvas scene with no other signal.*
2. **`@yorkie-js/react` bundles its own copy of the SDK** — 857 KB of dist with
   ZERO external imports. So `react.Text !== sdk.Text`, which is exactly the trap
   `packages/frontend/src/types/notes-document.ts` already documents. Therefore the
   mock document must be constructed from `@yorkie-js/react`'s own bundled
   `Document`, the shim must RE-EXPORT the real module rather than reimplement it,
   and `@yorkie-js/sdk` must NOT be aliased onto the react bundle — production's
   own duality is what the scene is supposed to reproduce.
3. **The engines build their DOM imperatively.** `initialize(container, { theme,
   store, readOnly })` (sheets) creates the canvas, formula bar, cell input and
   autocomplete in engine code, not JSX. So there is NO stamped node anywhere
   inside the engine region and `stampedAt()` terminates at the container `<div>`.
   Picking does not break — it becomes useless, one giant node. That is the gap
   CP4.4 exists to close.
4. **The engines already export the hit-test math.** `sheets/src/view/layout.ts`
   `toRef` / `toRefWithFreeze`, `slides/src/view/editor/hit-test-elements.ts`
   `hitTestSlide` (real `ctx.isPointInPath`), `docs/src/view/image-selection-overlay.ts`
   `findImageAtPoint`. CP4.4 ROUTES to these and never reimplements them — the same
   discipline `jsx-nodes.mjs` established for JSX numbering.

**Correction to the roadmap's shorthand.** Earlier notes said CP4 would seed
`Mem*Store` fixtures. That does not survive contact with the code: the pages
construct `YorkieStore` / `YorkieDocStore` / `YorkieSlidesStore` from `doc`
themselves, so injecting a `MemStore` would need a new frontend prop — a Golden
Rule violation. Seeding the DOCUMENT instead keeps the real store, calculator and
renderer in the code path, which is strictly more faithful than `MemStore` would
have been. The `Mem*Store` classes stay unused by the sandbox.

### CP4.1 — Node shims + engine/Yorkie resolution — done

- [x] Ported the frontend's `antlr4tsAssertShim()` pre-plugin, the `util` / `assert`
      `resolve.alias` entries, and the `optimizeDeps.esbuildOptions` `node-shims`
      interception into `packages/design-editor/vite.config.ts`. All three are needed —
      the frontend has all three, and they cover different resolution paths
      (bare import, `require("assert")` from inside antlr4ts, and dep pre-bundling).
- [x] Pointed them at the frontend's EXISTING shim files
      (`packages/frontend/src/lib/util-shim.js`, `assert-shim.cjs`) rather than
      copying them. No drift, no frontend change.
- [x] Aliased `@yorkie-js/react` and `@yorkie-js/sdk` to
      `packages/frontend/node_modules/<pkg>` (directory replacement), reusing the
      "one copy, the app's" rule already applied to `react-router-dom` /
      `@tanstack/*`.
- [x] Added `@yorkie-js/react` to `optimizeDeps.include` — the one specifier the
      offline provider (CP4.2) introduces that nothing in the sandbox shell reached
      before. `antlr4ts` and `@yorkie-js/sdk` deliberately NOT added: a probe against
      a scratch dev server showed Vite's dependency scanner auto-discovers both
      (through `@wafflebase/sheets`'s eager formula import and
      `apply-imported-content.ts`'s value import respectively) with no explicit
      `include` needed. CodeMirror (notes) likewise auto-discovers through the
      existing `@wafflebase/notes` alias.
- [x] **A real bug, found and proven before writing the fix.** Confirmed against a
      scratch dev server: unaliased, antlr4ts's prebundled chunk imports `assert`
      from a chunk literally commented `// browser-external:assert` — Vite's default
      stub, `Object.create(new Proxy({}, {get}))`, which is NOT callable. antlr4ts
      calls `assert(condition)` directly (`CodePointBuffer`, etc.), so this throws
      the instant anything parses. The bug was ALREADY LIVE and dormant: the DOM
      `documents` scene already imports antlr4ts transitively
      (`@wafflebase/sheets`'s `index.ts` eagerly imports `formula/formula.ts`), it
      just never called `assert()` because listing documents never parses a
      formula. Fixed as a side effect of this work, not just for canvas scenes.
- [x] **Gate:** `tsc --noEmit` clean. `verify:frame` deferred to CP4.3's end-to-end
      check (see the note below on why the live re-verification didn't happen here).

**What did NOT get verified live, and why.** A scratch-server verification attempt
hit a real environmental problem: this machine's WSL2/drvfs mount is slow enough
that Vite's dependency optimizer can hang for 60–90s on a single request, and
deleting a SHARED `node_modules/.vite` cache while another dev-server process was
running against it (an unrelated, pre-existing session on port 5199) caused a
cascade that killed that process. Proven NOT to be caused by this task's changes:
a clean A/B test swapped in the completely original, pre-CP4 `vite.config.ts` (via
`git show HEAD:...`) on a fresh port and it hung identically on `main.tsx` — a file
untouched by any of this work. Restored from a backup immediately after
(diff-verified byte-identical). The maintainer separately confirmed their own
environment was stable and asked to fold CP4.1's live verification into CP4.3's
end-to-end check rather than re-litigate it here.

### CP4.2 — The offline Yorkie provider — done

- [x] `src/scenes/canvas/yorkie-offline.tsx` — re-exports the real
      `@yorkie-js/react` and overrides exactly four symbols: `YorkieProvider`,
      `DocumentProvider`, `useDocument`, `usePresences`. A repo-wide grep of every
      `@yorkie-js/react` import in `packages/frontend/src` confirmed this is the
      COMPLETE runtime usage surface — nothing calls `useRoot`, `useConnection`,
      `useRevisions`, `useRemoveDocument`, `useYorkie`, or `useYorkieDoc`, so those
      pass through as the REAL implementations (reading a React Context this file's
      `DocumentProvider` never populates) rather than speculative no-ops. If
      anything ever calls one, it throws "must be used within a DocumentProvider" —
      loud and attributable, not silent.
- [x] `yorkieOffline()` Vite plugin, `enforce: "pre"`, registered ahead of
      `scenePatch()` — `resolveId` redirects `@yorkie-js/react` to the shim
      UNCONDITIONALLY (not scoped to frame-qualified importers): the shim reaches
      the real module through a `@yorkie-js/react/__wb-real` specifier the same
      plugin maps back to the `resolve.alias` target via
      `this.resolve(..., {skipSelf: true})`, reusing CP4.1's alias as the single
      source of truth rather than duplicating the path.
- [x] `DocumentProvider`: ONE stable detached `Document` (a `useState` initialiser).
      `initialRoot` applied via the EXACT pattern inspected in the published
      `@yorkie-js/react` dist's own `Client.attach()` path (`for (const [k,v] of
      Object.entries(initialRoot)) if (!crdtObject.has(k)) root[k] = v`, then
      `clearHistory()`) rather than a simplified guess. `update()` forwards to
      `doc.update()` so local editing genuinely works.
- [x] `loading: false`, `error: undefined`, `connection: Disconnected`.
- [x] **Known limitation documented, not papered over:** presence writes do not
      stick on a detached document — verified in the same probe
      (`presence.set(...)` inside `doc.update()` leaves `getMyPresence()` empty
      afterward). `getPresences()` still returns one entry (the local actor, empty
      presence), which would render as a confusing phantom avatar, so
      `usePresences()` always returns `[]` rather than forwarding it.
- [x] `tsc --noEmit` clean, including the new `@yorkie-js/react` /
      `@yorkie-js/react/__wb-real` / `@yorkie-js/sdk` entries added to
      `tsconfig.json`'s `paths` (mirroring CP4.1's alias, so the editor and
      `tsc --noEmit` agree with the bundler).

### CP4.3 — Canvas scene mounts + seeded fixtures — done

- [x] **Re-pointed `sheet-editor`.** It named `sheet-view.tsx#SheetView`, which
      requires a `tabId` prop AND calls `useDocument()` with no `DocumentProvider`
      in its own tree — its parent supplies both. Pointed at
      `app/documents/document-detail.tsx` (export `default`), matching the other
      three canvas scenes. `sheet-view.tsx` stays reachable through the outline's
      drill-in. Added `routePattern` (`/s/:id`, `/d/:id`, `/p/:id`, `/n/:id`) to all
      four canvas scenes — the SAME workspace-scoped-route bug CP3.5 found and
      fixed for DOM scenes (`route` reused as both the literal `MemoryRouter`
      location and the `<Route path>` pattern) would otherwise have silently broken
      every canvas scene's `useParams().id` too. Changed all four `export` fields
      to `"default"` (previously named exports), matching every DOM scene.
- [x] Canvas fixtures: per-engine seed functions in
      `src/scenes/canvas/seed-{sheets,docs,notes}.ts`, each exporting a plain
      `(doc) => void` function imported DIRECTLY by `yorkie-offline.tsx`'s
      `CANVAS_SEEDS` map (keyed by the exact docKey each scene constructs:
      `sheet-fixture`, `doc-fixture`, `note-fixture` — note singular "note-", not
      "notes-"). `slides-editor` has NO seed: `initialSlidesRoot()` returns `{}`,
      and production's own `ensureSlidesRoot()` (called by `slides-view.tsx` on
      mount, unmodified) already backfills a valid theme/layout/one-blank-slide
      shape — hand-constructing that nested schema here would duplicate real logic
      with nothing to check it against. Sheets seeds real cell values AND formulas
      (a small "Q4 Revenue Model", cross-referencing cells) via `toSref` from
      `@wafflebase/sheets` — routed through the real function rather than
      hand-written "A1" strings, since `toSref` is 0-indexed on row
      (`toColumnLabel(c) + r`, so the top-left cell is "A0"). Docs seeds three real
      paragraphs via a `Tree` literal replacing `root.content` outright (the
      block/inline/text shape copied from `yorkie-doc-store.ts`'s own tree-building
      code, not invented). Notes seeds markdown via `Text.edit(0, 0, ...)` — the
      CRDT's own insertion API, the same one the CodeMirror binding calls on every
      keystroke.
- [x] **A real defect, found and fixed before it could bite.** The first
      implementation had seed files `import { registerCanvasSeed } from
      "./yorkie-offline"` (a relative path) and call it as a top-level side effect,
      with `vite.config.ts`'s generated scene loader importing each seed module
      frame-qualified (`?wbFrame=${side}`) alongside the scene. This would have
      silently never worked: `yorkie-offline.tsx` is ALWAYS resolved to one
      canonical, UNQUALIFIED module id via `yorkieOffline()`'s redirect (CP4.2's
      whole design), but a RELATIVE import of it from another file doesn't match
      that plugin's exact-string check, so it falls through to `scenePatch()`'s
      default frame-query propagation instead — landing on a SEPARATE,
      `?wbFrame=`-qualified module instance. A registration written into one `Map`
      and read from another, silently never found — the exact "two module
      instances, one problem" bug `providers.tsx`'s own frame-qualified loading
      exists to prevent, just reintroduced one level down. Fixed by inverting the
      dependency: seed files export plain functions, and `yorkie-offline.tsx`
      imports them DIRECTLY (never the reverse), so nothing ever needs to reach it
      except through the one specifier the plugin already owns. Caught by tracing
      the resolution path by hand before ever running it, not by a failing test —
      recorded here because it is exactly the kind of defect that would have looked
      correct in a diff and failed silently at runtime.
- [x] HTTP fixtures (`src/scenes/fixtures/canvas.ts`): every canvas page's own
      three fetch calls, confirmed by grepping all four detail pages —
      `fetchWorkspaces` (`/api/workspaces`; these pages render their own
      `<AppSidebar>` rather than going through `shell: "app"`, so `shell.ts`'s
      fixtures never apply here) and `fetchDocument(id)` (`/api/documents/fixture`
      — every canvas route's `id` param is literally `"fixture"`). `fetchMe` /
      `fetchMeOptional` (`/api/auth/me`) already covered by the existing `auth`
      mock, already present in every canvas scene's `mocks` list — no new fixture
      needed. Reuses the exact documents already listed in
      `documents.ts#FIXTURE_DOCUMENTS` (same title/type narrative), so the
      Documents list scene and a canvas editor scene tell the same story about the
      same fictional documents.
- [x] `tsc --noEmit` clean, `pnpm smoke` all green.

**Order followed:** sheets seeded with the richest content (per the plan's own
"prove the spine on one engine first"), then docs and notes with real but lighter
content, slides deliberately left to production's own initializer.

#### CP4.3 follow-up — four defects found in code review, all SILENT

A review pass over the CP4.3 diff found four bugs that `tsc` and `pnpm smoke`
both passed. Every one of them renders a *plausible* but wrong scene rather
than erroring, which is the worst failure mode a design sandbox can have — a
reviewer would take the wrong render at face value. All four are fixed, and
each now has a check in `scripts/smoke-canvas.ts` that was verified to FAIL
when the bug is reintroduced (a guard that cannot fail is not a guard).

1. **The realm mismatch — notes could not mount, docs mounted blank.** The
   shim's own header documented this trap at length and the implementation
   then walked into it, with the polarity inverted. `@yorkie-js/react` does
   not export `Document`, so the shim's `Document` must come from
   `@yorkie-js/sdk` — but `export * from "…/__wb-real"` re-exported react's
   *bundled* `Tree`/`Text`. `buildCRDTElement` dispatches on `instanceof` and
   silently falls through to `CRDTObject.create(...)`, so a react-realm `Text`
   became `{"context":null,"text":null}` and `seed-notes.ts` then threw
   `root.content.edit is not a function` inside a `useState` initialiser.
   Worse, `docs-view.tsx#ensureTree` / `notes-view.tsx#ensureText` treat
   non-CRDT content as "needs initializing" and **replace it with an empty
   document** — so even without the throw, the fixture was wiped.
   Fixed by re-exporting `Tree`/`Text`/`Counter` from `@yorkie-js/sdk` (a local
   export shadows `export *`), unifying the sandbox on one realm. Costs no
   fidelity: both packages are 0.7.13 and react's is a verbatim copy, so the
   realms differ only in class identity. See `design-editor-engine.md` §9's
   ONE-REALM INVARIANT.
2. **`toSref` is 1-BASED on both axes**, and `seed-sheets.ts` used 0-based
   `r`/`c` while its header asserted the opposite ("the top-left cell is A0").
   `toColumnLabel(0)` is the empty string, so the whole first column would have
   been written under the bare, un-parseable keys `"1".."6"` — `parseRef`
   rejects them with "Invalid Reference".
3. **Formula cells carried no value, so they rendered blank.**
   `toDisplayString()` opens `if (!cell || !cell.v) return ''`, and nothing
   recalculates on load — `calculate()` is reached only from mutation paths
   (`setData`, `moveCells`, `sortFilterByColumn`). Seeding `f` alone would have
   emptied the entire Profit column and Total row: the 6 most interesting cells
   of 20. Also `f` is persisted WITH its leading `=`; the seed omitted it.
   Fixed by generating the fixture from the real engine (`Sheet` + `MemStore` +
   `setData`) and reading back what it persisted; `smoke-canvas.ts` re-derives
   it every run. The negative test caught a cascade the check was not even
   written for — breaking `D3` silently drifted `D6`'s `SUM` to 137500.
4. **The widened `kind` filter silently enrolled the deferred `pdf-viewer`.**
   `kind === "dom"` → `"dom" | "canvas"` gave it a loader entry, whose
   statically-analysable specifier Vite's dependency scanner crawls into
   `file-detail.tsx` → `pdfjs-dist` — resolvable here neither as a dependency
   nor via an alias, and carrying a static `?url` worker import. Deferral is
   now an explicit `deferred: true` manifest flag honoured by
   `scenesRegistry()`, so intent lives in the manifest rather than being
   implied by a `kind` filter.

**Still open (minor, not blocking):** `DocumentProvider`'s `update` and `value`
are rebuilt every render (no `useCallback`/`useMemo`) — latent, since no scene
currently puts `update` in a dep array; its `error` state is never cleared; and
`src/scenes/canvas/*` uses double quotes where the rest of `src/scenes/**` uses
single. `readOnly: true` is *not* dead config after all — §9 documents it as
marking "editable but ephemeral", though nothing enforces it.

### CP4.4 — Canvas-aware hit-testing

**The architectural claim: CP4 adds a new READ path and reuses the existing WRITE
path.** A canvas hit has no `className` to write, so nothing here needs a new
mutation kind, a new endpoint, or any server change.

- [ ] A **probe registry** in `frame-picker.ts`: when a click's stamped node is a
      registered canvas host, ask an engine probe `(x, y) → CanvasHit | null`
      instead of stopping at the container `<div>`.
- [ ] `src/scenes/canvas/probes/*.ts` — one per engine, each calling that engine's
      OWN exported hit-test (finding 4). `CanvasHit = { kind, label, rect (frame
      px), themeKeys[], detail }`.
- [ ] New `wb:canvas-select` frame→host message alongside `wb:select`. The existing
      `data-wb-overlay` boxes and `onSelectionHostRect` anchoring are reused
      unchanged — the overlay is already DOM-not-outline (§7.11), so the rect just
      comes from engine geometry instead of `getBoundingClientRect()`.
- [ ] `FloatingClassEditor` gains a **canvas variant**: the engine theme keys that
      painted this object, each editable as an existing `palette-value` /
      `token-value` intent, plus read-only geometry. No Tailwind class controls —
      offering them would be a lie about where the edit lands.
- [ ] Generalise the CP3.5 click-to-cycle: cell → range → the canvas host node, so
      **the last step of the canvas cycle drops you back into DOM-land**. Slides'
      `hitTestSlide` already returns a path through groups, giving a natural
      ancestor chain; sheets has none, so it escapes in one step.
- [ ] Picking ON must keep `preventDefault` so the engine does not also scroll or
      select. Already the behaviour — confirm it survives the probe path.

### CP4.5 — The theme bridge

- [ ] `wb:set-token-vars` installs CSS `:root` variables, which a canvas cannot
      see: `sheets/src/view/theme.ts` reads `palette.syrup` at module-eval into a
      plain object. Add `wb:set-canvas-theme` carrying the delta `/preview-tokens`
      already computes by running the REAL emitter (§3.8).
- [ ] Apply it by substitution against the engines' live theme values, then poke a
      repaint (`Spreadsheet.render()` is public; find the equivalent per engine).
      Operating on the real emitted values handles `palette.syrup` and
      `` `rgba(${palette.butterRgb}, 0.18)` `` uniformly, and the failure mode is
      "does not preview", never a wrong write. Precedent: `states.ts`
      `forcedStateClasses` transforms the string actually in effect.
- [ ] **Rejected, and recorded so it is not re-proposed:** propagating `?wbFrame=`
      into `packages/core/src/tokens/palette.ts` so the theme module re-evaluates
      from patched bytes. Correct by construction, but it invalidates hundreds of
      importers — a full frame reload per colour-picker keystroke. It is what
      happens after a real save anyway, via HMR.
- [ ] Closes the §3.8 claim that the delta is applied "as a theme-object patch
      (canvas scenes)", which is currently documented but not implemented.

### CP4.6 — Verification + doc closeout

- [ ] `scripts/smoke-canvas.ts` — pure logic, no DOM: probe-registry dispatch,
      theme-delta substitution, seeder → root shape. Added to `pnpm … smoke`.
- [ ] A pinned check that the detached-document invariants of finding 1 still hold,
      so a Yorkie bump fails loudly here instead of silently in every canvas scene.
- [ ] Extend `verify:frame` and `verify-bridge.mjs` to the canvas frames; new
      engine checks numbered from 25.
- [ ] `design-editor-engine.md`: the offline-Yorkie provider and the canvas probe
      registry as new §7 subsections, the theme bridge folded into §3.8, checks 25+
      in §8.1, and a CP4 closeout in §9.
- [ ] `design-editor-sandbox-recipe.md`: canvas scenes as a new §2 subsection, the §8 roadmap
      table, and the CP4 entry under Phase 3.
- [ ] **By-hand browser pass** (still no headless Chromium): each engine paints,
      paints like the app, survives a theme flip, and click-picking lands on the
      right cell / element. Carry `design-editor-engine.md` §9's existing list forward.

### CP4 non-goals

- **Editing canvas document CONTENT** (cell values, slide elements) as a design-SDK
  feature. That lives in Yorkie, not in source — it is a product feature. Scenes
  are editable so their UI can be judged in real states; the sandbox never writes
  document content anywhere. (Already recorded in the Phase 3 non-goals below.)
- `pdf-viewer` (deferred, above).
- Two canvas engines live at once. CP5's before/after diff will need this, and the
  existing "one live frame" counter turns from a leak warning into a real memory
  and GPU risk once each frame is a full engine. Flagged for CP5, not solved here.
- Stamping the engines' imperative DOM. The formula bar, cell input and autocomplete
  are built in engine code with inline styles; they are a genuine design-system
  surface (hardcoded hex outside the token pipeline) but reaching them needs a
  different mechanism than JSX anchors, and it is not CP4.

### Session guide — how to pick this up cold

```bash
pnpm --filter @wafflebase/design-editor dev        # the sandbox, :5173 by default
pnpm --filter @wafflebase/design-editor smoke      # pure logic, no server
pnpm --filter @wafflebase/design-editor verify:frame   # module-graph crawl, needs dev up
pnpm --filter @wafflebase/design-editor verify:bridge  # real writes, needs dev up
```

Read in this order: `design-editor-engine.md` §7.8 (why each frame is its own Vite
entry and realm) → §7.9 (the stamping transform) → §7.10 (the fetch kill-switch) →
`design-editor-sandbox-recipe.md` §2.11–2.13 (the host↔frame boundary, providers, the three
selection outcomes). Those four are what CP4 extends; everything else in the two
docs is the token/CVA half and can wait.

Ground rules for this task, agreed with the maintainer:
**(1)** nothing under `packages/frontend` changes — CP4 is achievable with zero
frontend edits, and if that stops being true it is a design signal, not a licence;
**(2)** both living docs are updated as decisions land, not retro-fitted;
**(3)** no commits without an explicit green light after a manual test.

## Defects found while building, and fixed here

- `analyzeScene`'s `component ?? Object.keys(roots)[0]` referenced an out-of-scope
  `roots` — a `ReferenceError` that would have taken out the whole `/metadata`
  response on the first mis-typed `export` in the manifest.
- The same function silently dropped `route`, so `/metadata` and
  `virtual:wb-scenes` described the same scene differently.
- A persisted `localStorage` edit stack written before `layoutEdits` existed
  rehydrated with `layoutEdits: undefined` and white-screened the editor from
  `editStateKey` on the render path. Fixed by migrating at hydration rather than
  bumping the storage key, which would have discarded the user's staged edits.
- Engine packages were unresolvable in the frame graph.
- Engine check 17 was vacuously passing (matched the JSX attribute form; the served
  bytes carry `plugin-react`'s quoted property keys, so it asserted "all 0 ids are
  valid").

## Open, not attributable to this task

- `pnpm verify:fast` is reproducibly red on this machine — vitest fork-worker
  start timeouts under `/mnt/c` (drvfs). No root script references
  `packages/design-editor`, so this task's coverage is unchanged either way. Needs
  confirming against CI (Linux-native FS) before it is called environmental.

## Sandbox polish — agreed, ahead of CP4 (small, high-confidence items)

Four small UX fixes to the Layout Sandbox itself, separate from the CP3.5
inspector work above. Ordered by how independent each is.

- [x] **Workspace scenes + fixtures.** `scenes.config.json`'s `documents` /
      `datasources` scenes pointed at Layout's no-workspace FALLBACK pages
      (`app/documents/page.tsx`, `app/datasources/page.tsx`) rather than the
      workspace-scoped pages under `app/workspaces/` that `Layout.tsx`'s
      sidebar actually links to (`/w/:workspaceId/...`) for every real user.
      Repointed both, and added `analytics` / `settings` (workspace settings —
      distinct from the pre-existing `settings-personal`, the appearance/theme
      page) scenes with matching fixtures in `src/scenes/fixtures/workspace.ts`.
      Verified: `GET /metadata` analyzes all scenes with a resolved root;
      `verify:frame` module-graph crawl (1115/1115 resolve).
- [x] **Zoom via `transform: scale()`, not CSS `zoom`.** `SceneHost.tsx`
      used to set the non-standard `zoom` CSS property on the iframe element,
      which has the same "frame lies about its own geometry" failure mode as a
      transform-scaled *width* (some implementations resolve a percentage-width
      descendant against the zoomed containing block). Replaced with
      `transform: scale()` on a stage wrapper sized to the pane's real,
      `ResizeObserver`-measured pixel box (never a percentage), plus a zoom
      dropdown (25%–200%) replacing the three fixed buttons.
      `design-editor-sandbox-recipe.md` §2.11 updated; `design-editor-engine.md` has no zoom
      content to update (`§7.11` is the host↔frame *message* protocol — zoom
      never crosses `postMessage`, it is host-only).
- [x] **Scene List panel ordering + Canvas items.** Reordered
      `scenes.config.json` to Documents > Data Sources > Analytics > Settings
      (matching `Layout.tsx`'s real sidebar order), and grouped the list UI by
      the existing `kind: "dom" | "canvas"` field (no new manifest field
      needed) rather than a flat list. Added `docs-editor` / `slides-editor` /
      `notes-editor` / `pdf-viewer` canvas entries alongside `sheet-editor` —
      **by design decision, list-only placeholders**: every canvas detail page
      calls `useDocument()` from `@yorkie-js/react`, a live Yorkie connection
      the `fetch` kill-switch cannot mock, and none of their `*-store` mocks
      are implemented in `providers.tsx`. They render the same mount/render
      error `sheet-editor` already shows, tagged `CP4` in the list. Building
      real `Mem*Store` fixtures per engine is CP4 scope, explicitly deferred.
- [x] **Two-way route sync.** A shell scene's `MemoryRouter` only ever declared
      one page route, so navigating to a sibling nav item inside the frame
      (picking OFF) 404'd into an empty `<Outlet/>` — indistinguishable from a
      broken scene. Added a wildcard sibling route
      (`SceneProviders#RouteEscapeNotifier`) that posts the attempted path as
      `wb:route-change`; the host matches it against `scenes.config.json`'s
      `route` (plain string equality — every manifest route is a concrete
      fixture path) and switches `sceneId`, which is a real frame reload onto
      the target scene's own module. An unmatched path toasts rather than
      silently doing nothing. `design-editor-sandbox-recipe.md` §2.11 updated.

## Sandbox polish — Phase 1.5 bug fixes (done, commit `aebf4926b`)

- [x] **Click-outside deselect.** `frame-picker.ts`'s click listener bailed on
      `if (!picking) return` before ever reaching the deselect branch, so a
      click on empty canvas only cleared selection while Pick mode was on.
      Moved the non-stamped-target check ahead of the `picking` gate — it
      never calls `preventDefault`/`stopPropagation`, so Use mode still gets
      the click normally.
- [x] **className/attributes truncation.** Pulled both out of the generic
      `Facts` grid into their own `max-h-28 overflow-y-auto` `<pre>` blocks in
      `SceneNodeDetail.tsx`.
- [x] **Two-way scroll/highlight sync.** `SceneOutline.tsx` auto-expands
      collapsed ancestors and scrolls the selected row into view on
      canvas-driven selection; wired the previously-unused `wb:measure` /
      `wb:measured` protocol so a node with instances but no visible box (a
      collapsed accordion, an inactive tab) surfaces an explicit warning in
      `SceneNodeDetail.tsx` instead of doing nothing.
- [x] **Scene sync on in-canvas navigation.** `RouteEscapeNotifier` now checks
      the same `virtual:wb-scenes` manifest the host does, distinguishing
      "switching to a known scene" from a dead-end dynamic-id route (a
      document row like `/s/doc-q4-revenue`, which the manifest only knows
      as its `/s/fixture` stand-in).
- [x] **Scene remount on mode toggle (partial).** `SandboxLayout.tsx`'s
      `<main>` now always mounts both `PreviewPane` and `SceneHost`, toggling
      visibility with Tailwind's `hidden` class instead of conditional JSX, so
      switching between Components/Scenes mode no longer destroys the live
      iframe. A genuine switch between two *different* scenes still remounts
      — load-bearing, one Vite entry per patched module, not fixed.
- Inspector drill-in on Login form's inner elements — deferred to Phase 2
  below (see "Full inspector drill-in").

## Sandbox polish — Phase 2 (in progress)

Three items, agreed after Phase 1.5. Landing as three separate commits.

- [x] **DevTools-like freeform viewport resize.** Drag handles (right /
      bottom / corner) on `SceneHost.tsx`'s stage, alongside the existing
      mobile/tablet/desktop presets. Sets a `customSize` override in the same
      real, explicit pixel width/height the presets use (never a transform)
      — the frame's own `matchMedia`/`useIsMobile()` reads real geometry, the
      same invariant the zoom-via-`transform` polish item above depended on
      for width. Handles live on a new footprint wrapper sized to the
      scaled box's own on-screen dimensions, a SIBLING of the `scale()`d
      stage rather than a descendant, so they stay full-size at any zoom
      instead of shrinking with the picture (`transformOrigin` moved from
      `top center` to `top left` to make that wrapper the centering
      anchor). `design-editor-sandbox-recipe.md` §2.11 updated.
- [x] **Full inspector drill-in.** Investigation found the resolution chain
      (per-file stamping via `scenePatch`'s query propagation, on-demand
      `/metadata?file=` fetch, and `anchorFromStamp` keyed on the stamp's own
      file) already worked end-to-end for a click into e.g. `LoginForm`'s
      inner elements, AND the outline's breadcrumb/warning UI already
      existed (`SceneOutline.tsx`, built in CP3.4) — this was mistaken for a
      Phase 1.5 bug. The actual gap: `resolveStamp` fetched and resolved the
      anchor for a click landing in a different file, but never told the
      OUTLINE — `drillTrail` stayed unchanged, so the tree kept showing the
      parent file with nothing highlighted while the detail panel silently
      had the right answer. Refactored `drillIn` and `resolveStamp` onto a
      shared `syncTrailTo`/`ensureFileNodes` pair so a resolved click drills
      the outline exactly like the explicit drill-in button does — including
      truncating back to an ancestor file rather than growing the trail
      unboundedly when you click back up to a page-level node.
      Also closed both open CP2 hardening defects while in this code: scoped
      `HINT_KEYS` stripping to only `layoutEdits` (`edits.ts#editStateKey`),
      and added `layoutEditKey(anchor, discriminator)` as the one place a
      `PendingLayoutEdit`'s key is built — folds in `anchor.file` (fixes a
      real collision: two different files whose op+path could coincidentally
      produce the same key string), deliberately NOT `sceneId` (two scenes
      drilling into the same shared file must land on the same entry, or
      committing one would silently clobber the other with no conflict
      signal — consistent with `anchors.ts`'s own "keyed on the anchor's
      file, not the scene id").
      **Not done: a live-browser click-through.** This environment has no
      headless Chromium (per `design-editor-engine.md`'s "headless Chromium is
      unavailable" note on CP3's checks) — `pnpm smoke` and `tsc --noEmit`
      are clean, but clicking into `LoginForm` in an actual browser is still
      unverified and needs a human pass.
- [x] **Figma-style floating inspector for className/layout (v1).** Added
      `onSelectionHostRect` to `SceneHost.tsx` — converts the frame-local
      rect (`wb:measured`) into host-page pixels via the iframe element's
      OWN `getBoundingClientRect()` (already reflects `zoom` and host
      scroll) plus the frame-local rect scaled by `zoom`, recomputed on a
      fresh measurement, a zoom change, or the pane scrolling/resizing — not
      just once per selection. New `FloatingClassEditor.tsx`: a
      `position: fixed` `createPortal` panel (no Radix — its pointer-event
      handling would fight the iframe for clicks), following
      `docs-link-popover.tsx`'s anchoring pattern. Quick-toggle groups for
      Direction/Align/Justify/Gap and Width/Height presets are closed
      Tailwind enumerations by design — `SceneNodeDetail`'s own "Off-token
      values" warning treats arbitrary px literals as a defect elsewhere in
      this tool, so a control that defaulted to `w-[137px]` would manufacture
      the thing that panel flags; a raw class chip add/remove list is the
      escape hatch for anything a preset does not cover. Stages a
      `PendingLayoutEdit` (`op: 'props'`) through the existing
      `history.update`/`previewScene`/commit pipeline — no new server
      endpoint. Added `layoutEditKey` as the shared key builder (see the
      drill-in item above) so this and any future layout-editing UI agree on
      one node's identity.
      **Scoped down from the full ask:** no drag-resize handles on the
      selection box itself (`SceneOutline.tsx`'s header explicitly rules
      those out — "No drag handles, no resize cursors" — for the 100–300 ms
      virtual-module round trip a drag gesture can't afford), no
      arbitrary-value W/H input (see above), and no live preview verified in
      a browser (same no-headless-Chromium gap as the drill-in item).

## Non-goals for Phase 3 (recorded so they are not rediscovered)

- Drag-and-drop layout editing. The virtual-module round-trip is 100–300 ms, which
  is fine for discrete edits and unusable for a gesture. Optimistic-DOM strategy is
  in the plan for 3.5+; the `layout-move` schema already supports it.
- Structural ops inside an inline `.map(x => …)` body. `layout-props` only there;
  restructuring requires extracting the row into a component or a `renderRow`
  helper (which then has its own static root and full support).
- Making one `.map()` instance differ from its siblings (needs generated control flow).
- Moving a node between component files; extracting a subtree into a new component.
- Editing canvas *document content* (slide elements, cells) — that lives in Yorkie,
  not in source, and is a product feature rather than a design-SDK one.
