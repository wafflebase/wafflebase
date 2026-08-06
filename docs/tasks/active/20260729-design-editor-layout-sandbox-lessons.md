---
title: design-editor-layout-sandbox — lessons
target-version: 0.2.0
---

# Lessons — Design SDK Phase 3

## CP2 (metadata + intents)

### The ordering rule is asymmetric, and I got it wrong the first time

Writing the worked example in the architecture doc is what caught it. Forward ops
must apply **descending** by target position; my first draft said reverts do the
same. Tracing a concrete case showed `[a,s,g,s,D]` restoring as `[a,s,s,g,D]` —
a plan that looks right, writes cleanly, and leaves the file subtly wrong.

Reverts must run **ascending**, mirroring the forward pass, because a revert
group undoes it in exact reverse order. Both directions are now asserted in
`scripts/smoke-layout.ts`, and the wrong order is asserted to *fail* — a
regression that silently flipped the sort would otherwise look like a passing
test suite.

**Takeaway:** for any batch of index-addressed tree edits, write the concrete
before/after child list by hand before trusting the rule.

### `fp` collides constantly in real code; that is by design, and it needs a partner

The fingerprint deliberately excludes `className` content and the child tag
sequence — including either would make an edit invalidate its own anchor, and its
own revert's anchor. The cost is heavy collision: `SheetView` has four identical
`<Suspense>` siblings and two top-level `<div className=…>` returns that are all
equal under `fp`; `login/page.tsx` has two byte-identical `<span>·</span>`.

That is fine for *verifying* a path hit and useless for *searching* when the hint
fails. Adding `fpx` (`fp` + sorted classes + child tags) as a first search key cut
collisions 7→2, 7→2 and 6→0 across the manifest scenes, with no new failure mode:
`fpx` is invalidated by an edit to *this* node, but a path hint fails because
something changed *elsewhere*, so it is normally still valid exactly when needed.

**Takeaway:** a stable identity and a discriminating identity are different jobs.
Do not try to make one key do both.

### "The first return" is not a component's root

`SheetView` is 1648 lines and reduced to a single `<Loader/>` node, because the
walker took the first `return <jsx>` — an early loading guard. Components
routinely have several legitimate render outputs.

The fix is a synthetic `#returns` container that is **always** present. A shape
that collapsed to the bare element for single-return functions would have been
prettier and would have renumbered every path in the file the day someone added a
guard clause. One convention beats two.

### Structural edits need two guards, not one

Refusing structural ops inside a `.map()` was the constraint I was given. Building
it surfaced a second, equally sharp case: a node reached through `{cond && <div/>}`.
Removing the element leaves a bare `{}`; removing the container silently drops the
condition. And splice offsets must come from the *owner* (`{…}`), or an insert
after that child lands before the `}` and produces a syntax error.

So `childrenOf` reports each numbered node's owning JSX child, and
`owner !== node` is itself a structural-op refusal. Both guards live server-side
in `resolveNode`, not as disabled buttons — the client's `SceneMeta` can be stale.

### Preferring "extract it" over "support every shape"

`items.map(renderRow)` looked like the worst case for AST injection. Emitting one
walkable root per JSX-returning function turned it into the *best* case:
`renderRow`'s JSX is `static` in its own root, fully structurally editable. The
only genuinely unsupported shape is an inline arrow body, and the refusal message
says what to do about it.

### A dev-tool refactor that touches product code needs a byte-identity gate

`build-css.ts` had to become parameterizable so the bridge could render tokens
from patched sources. The gate is `git show HEAD:… → run → cmp`, not "it looks
equivalent". Cheap, and it is the only thing that makes a product-code change in
service of a dev tool defensible.

### Two mtime traps

- `loadEsm` must bust on the **max** mtime across `src/server/*.mjs`, not the
  entry file's own. `inject.mjs` and `extract.mjs` both import `jsx-nodes.mjs`;
  busting only the entry keeps serving a cached copy of the shared module, so
  editing the node model appears to do nothing.
- The preview worker needs a **fresh scratch dir per request**. `semantic.ts`
  imports `./palette`, so a query-string bust on `semantic.ts` alone still
  resolves the cached palette and silently returns pre-edit colours.

### Found a pre-existing bug by designing around it

`tokenPreviewStyle` only ever overrode `--<semantic>` vars, and `paletteBlock()`
has hand-written mode-conditional logic. So a palette edit previewed as *nothing*
on every `--wb-*` consumer — which is most of `login/page.tsx`, the first scene
Phase 3 targets. Running the real emitter over patched sources fixes it and
cannot drift; porting the logic into the browser would have been a second
implementation of the emitter.

## CP3.1–3.4 (the DOM scene renderer)

### A plan can be right about the decision and wrong about the mechanism

The approved plan said "preview layout edits through a `virtual:wb-scene` patched
module". The *decision* — a patched module rather than an override channel — held
up completely. The *mechanism* could not work, for a reason visible only in
dependency source: `@vitejs/plugin-react@4.3.4` (`dist/index.mjs:141-145`) does
`const [filepath] = id.split("?")` and filters on `/\.[tj]sx?$/`, so
`\0virtual:wb-scene?id=login` has filepath `\0virtual:wb-scene` and gets no JSX
transform and no fast refresh. A virtual id also has no directory, so
`./document-list` inside the patched source cannot resolve.

Keeping the real path and appending `?wbFrame=<side>` fixes all three at once, and
Vite keys its module graph by full id — so one file legitimately serves two
different bodies, which is the property the whole diff view rests on.

**Takeaway:** when a plan names a specific mechanism, read the plugin that will
have to handle it before building on it. "Virtual module" is a category; whether
*this* plugin sees it is a fact about that plugin's filter.

### The scene that renders perfectly is the one that proves the least

`/login` looked flawless from the first frame. That was not evidence the renderer
worked — it was evidence `/login` is the single route in `App.tsx` that is *not*
nested under `<Route element={<Layout/>}>`. Every other scene is an `<Outlet/>`
body, so rendering the page file alone produced a padded box floating in an empty
viewport, and every judgement about width, gutters and the header relationship
would have been made against the wrong container.

`shell: "app"` mounts them in the real `Layout` via a nested route rather than
`<Layout>{children}</Layout>` — `Layout` renders `<Outlet/>`, not `props.children`,
so wrapping directly would have produced a convincing sidebar and header around an
empty content area. That failure is worse than no shell, because it looks
deliberate.

**Takeaway:** when the first case works immediately, ask what makes it atypical
before generalising from it.

### A green check that matches nothing is worse than a missing check

Engine check 17 asserted "every stamped id exists in `/metadata` at the same
path". It matched `data-wb-node="…"` — the JSX form. What comes over the wire has
been through `plugin-react` and reads `"data-wb-node": "…"`. The check found zero
ids and asserted that all zero were valid, so it passed on the first run and meant
nothing.

The fix is not just the regex: it is `ids.size > 0 && unknown.length === 0`. An
extraction-based assertion needs a non-emptiness clause or it degrades to a no-op
the moment the format shifts.

**Takeaway:** assert against the bytes actually served, and make "found nothing"
a failure rather than a vacuous pass.

### The transitive import graph is a checkable artifact, and nothing was checking it

`/documents` would have died in the browser with a Vite 500 naming
`apply-imported-content.ts` — a file its page source never mentions — because
that file value-imports `initialSpreadsheetDocument` from `@wafflebase/sheets`,
whose `dist/` is unbuilt in a fresh checkout. Reachable only via
`document-list.tsx → upload-queue.ts → apply-imported-content.ts`.

No existing check looked past the entry module. Walking the frame's whole import
graph and asserting a 200 on each (~1100 modules) found it in one run, and is now
committed as `verify:frame`. It cannot see a runtime throw, so it is a floor, not
a substitute for opening the browser — but it converts a whole class of mount
failure from "blank iframe, mysterious filename" into a named list.

A note in the Vite config had claimed these aliases were only needed once a Canvas
scene existed. It was wrong, and only the crawl disproved it.

**Takeaway:** for anything that assembles a module graph, crawling it is cheap and
catches what per-file checks structurally cannot.

### Uniqueness assumptions break when the container changes

`<root>:<path>` was a fine node id while a frame rendered one file. The moment
`shell: "app"` put `Layout`, `AppSidebar`, `NavUser` and the page in one document,
it stopped being unique — `Page` and `default` are ordinary root names, so two
files contributing `Page:0.1` is normal. Worse, the host needs the file to know
which metadata tree to resolve a click against; guessing by root name would anchor
an edit in the wrong file with no visible symptom.

Hence `data-wb-file`, and a message-level id of `<file>#<root>:<path>`. The DOM
keeps them as two attributes so the "stamped set equals `/metadata`'s node set"
check stays a straight comparison.

### Observers that write into the tree they observe

The selection overlay repaints on a `MutationObserver` over `document.documentElement`
with `attributes: true`. `paint()` sets inline styles on the overlay boxes — which
are in that subtree — so every repaint scheduled another repaint: a self-sustaining
rAF loop that pins a core and never settles. The overlay carries `data-wb-overlay`
and records whose target is inside it are skipped.

The same attribute does three other jobs: excluded from hit-testing, excluded from
the class report (or the host would register Tailwind candidates for its own
furniture), and it is why the overlay is absolutely-positioned boxes in `<body>`
rather than a CSS `outline` on the target — an outline changes the subject's own
computed style, which is the thing being judged, and is clipped by any ancestor
with `overflow: hidden`.

### Picking has to be a mode

A click on `<Link to="/login">` is either a selection or a navigation. A
bubble-phase listener runs after React's handler, so the router has already
navigated by the time the picker sees it — and with `MemoryRouter` there is no URL
to reveal that, so it reads as "selection is broken". Capture phase plus
`preventDefault` + `stopPropagation`, behind a visible `Pick` / `Use` toggle. A
modifier key would have had half the clicks in a session do the wrong thing.

### An iframe does not inherit the host's cascade

Token editing looked broken in scenes mode. It was not: the component preview
applies token overrides as an inline `style` on a host DOM element, and a frame is
a separate document. The fix is a `wb:set-token-vars` message and a real `:root`
rule inside the frame — fed by `previewTokens` rather than the client-side
approximation, because the latter only emits `--<semantic>` vars and the login page
reads `--wb-*` throughout. (The same pre-existing bug recorded under CP2, hit
again from a different direction.)

This also settled a UI question worth recording: the Token Editor stays visible in
scenes mode, the Token bindings panel does not. Bindings is component-scoped and
would be describing something nobody is looking at; the Token Editor is global, and
judging a colour on a real page rather than an isolated button is the most valuable
thing the tool does. It only *looked* useless for one revision because of the
cascade bug above.

### Latent bugs surface when something finally exercises the fallback

`analyzeScene`'s `component ?? Object.keys(roots)[0]` referenced a `roots` that is
not in scope — a `ReferenceError` that would have taken out the entire `/metadata`
response. Unreachable while every scene's export resolves, which is why it survived
CP2 review and a full check suite. The same function silently dropped `route`,
documented in its own signature.

Both were found by reading the function in order to extend it, not by any test.

### Two environment traps

- **`pkill -f design-editor` kills the shell running it**, because the pattern matches
  its own command line. Kill by pid from `pgrep -af "vite/bin"`.
- **The Edit tool intermittently reports `ENOENT` on this drvfs mount after
  successfully writing.** Verify with `grep` before retrying, or you silently
  duplicate the block.

## Process

Three review rounds on the architecture doc before any code, and each round found
something the code would have had to unlearn:

1. dual-frame diffs need **separate module realms** — `docs/src/view/theme.ts`
   keeps `let activeTheme` behind a `Proxy` and `LightTheme` is a shared mutable
   object, so host-driven `createRoot` into two iframes would have shown identical
   colours on both sides of a "diff";
2. layout preview cannot be an override channel — nothing else can preview a
   `layout-insert` without compiling JSX in the browser;
3. the HMR round-trip cannot be a drag-gesture loop.

All three would have been expensive to discover after the renderer was built.

A fourth round, before CP3, added the `virtual:`-id finding above — and that one
came from reading `@vitejs/plugin-react`'s source rather than from reasoning about
the design. The pattern across all four: the expensive mistakes were about *what
some other component actually does*, not about our own logic.

### Stopping at a checkpoint boundary paid for itself

CP3 was planned as five commits. The instruction to finish CP3.2 and **stop** for
a build/resolution check, before any UI, is what made the next session's failures
legible: when `verify:bridge` and the graph crawl ran against a live server, four
checks failed and every one was diagnosable in isolation. Had the inspector and
the outline been in the same batch, the vacuous check 17 and the unresolvable
engine packages would have been debugged through a UI that had never rendered.

The same discipline is why `previewScene` and `planRebase` are knowingly unwired
rather than half-wired: both are inert until something can stage a layout edit, so
they are listed as CP3.5 work rather than quietly "done".
