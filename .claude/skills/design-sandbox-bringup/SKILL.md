---
name: design-sandbox-bringup
description: Use when standing up `@wafflebase/design-editor` against a project for the first time — writing that project's `vite.config`, scene manifest, providers, fixtures, scene stylesheet and preview recipes — or when an already-mounted editor shows a symptom from the trap table (unstyled scenes, a class edit that changes nothing, a frozen tab, "needs app context", dead pan/zoom).
---

# Standing up a design sandbox for a project

## Overview

`@wafflebase/design-editor` is a dev-only Vite plugin. It renders **the consumer's own
routes and components** in an iframe and writes edits back into **their** source. It ships
no design system, no fixtures and no knowledge of any project.

A working installation is therefore always two things:

| | |
|---|---|
| **the plugin** | generic, published, knows nothing about you |
| **the sandbox** | ~6 files in the consumer's repo that answer everything the plugin cannot know |

This skill is the sandbox half. Everything in the trap table was found the expensive
way — by running the editor against wafflebase's own frontend and measuring why a pane
was blank, transparent, frozen or stale. Read the table **before** debugging: every entry
is a symptom that looks like a different bug than it is.

## The six files a consumer writes

Wafflebase's own instance is `packages/design-sandbox/`. Copy its shape.

1. **`vite.config.ts`** — the plugin call plus the consumer's normal Vite setup.
2. **`scenes.config.json`** — `components` (files to analyse) + `scenes` (routes to mount).
3. **`src/scenes/providers.tsx`** — the real app providers, with data substituted.
4. **`src/scenes/fixtures/index.ts`** — `(sceneConfig) => FixtureTable`, keyed by URL path.
5. **`src/scenes/scene.css`** — the stylesheet the FRAME gets.
6. **`src/scenes/previews.tsx`** — how each component wants to be mounted alone.

### 1. `vite.config.ts`

```ts
plugins: [
  yorkieOffline(),     // any 'pre' redirect must precede react()
  react(),
  tailwindcss(),
  designEditor({
    root: REPO_ROOT,   // the WRITE BOUNDARY, not the Vite root
    scenes:    path.join(HERE, 'scenes.config.json'),
    providers: path.join(HERE, 'src/scenes/providers.tsx'),
    fixtures:  path.join(HERE, 'src/scenes/fixtures/index.ts'),
    previews:  path.join(HERE, 'src/scenes/previews.tsx'),
    opaqueRoots: [/* large non-JSX subtrees */],
    tokens: myTokenAdapter({ root: REPO_ROOT }),
  }),
],
```

Also required, and each justified by a scene rather than by taste:

- `resolve.dedupe: ['react', 'react-dom']` **and** directory aliases for every app
  library the providers import (router, query, table, icons, any SDK). The sandbox is a
  different package from the app, so pnpm otherwise hands it a second copy and hooks
  break with "Invalid hook call" from a tree that visibly has a Router.
- `define` for whatever the app's own config defines (`process.env`, `__APP_VERSION__`,
  the API base URL). An undefined global is a mount error, not a degraded render.
- `optimizeDeps.include` for **the app libraries**, or the first scene load re-optimises
  mid-mount and the frame reloads under you. The frame's own `react` and
  `react-dom/client` are not your problem — the plugin adds them itself, because the
  frame entry is served by absolute path and so is invisible to Vite's dependency scan.
- Point the API base at a deliberately unresolvable origin (`http://scene.invalid/api`)
  so nothing can reach a real backend from the frame.

### 2. `scenes.config.json`

`components` is a list of files, and **every exported component in each file** becomes a
catalogue entry. List the whole `ui/` directory — the analyser now attributes a `cva()`
to the component whose body calls it, and skips lowercase exports (hooks), so a
25-export barrel no longer poisons the catalogue.

`scenes` is curated, not a glob: each entry names the route, the providers it needs
(`mocks`), the fixture set, and whether it mounts inside the app shell.

### 3–4. Providers and fixtures

Providers wrap every mount and take `{ mocks, route, theme, shell }`. **Handle the empty
case**: a component preview passes no `shell` and a small `mocks` list, and an
implementation that assumes a scene throws before anything renders.

Fixtures are installed **before the first scene import** — real API modules read their
base URL at module scope, so a guard installed later has already lost the race.

### 5. `scene.css`

```css
@import '@/index.css';                              /* the app's real entry */
@source '../../../frontend/src/**/*.{ts,tsx}';      /* where the classes live */
@source '../**/*.{ts,tsx}';
```

Both `@source` lines are mandatory. Tailwind roots its content scan at **the package
being built** (the sandbox), so without them it reads none of the app's components and
emits none of their utilities — every check passes while `text-[28px]` computes to 16px.

### 6. `previews.tsx`

`Record<componentName, { props?, render?, frame?, children? }>`:

| field | when |
|---|---|
| `props` | merged **under** the generated ones — a starting value, still editable |
| `frame` | `{ width, height }` around the mount — a slider needs somewhere to slide |
| `children: false` | the component renders a void element (`<input>`, `<hr>`, `<img>`) |
| `render(C, props)` | replaces the mount entirely — the only thing that can preview a composite's part, or assemble a composite root |

**Write two kinds of `render` recipe, and know which you are writing.**

*A part inside its parent.* `DropdownMenuItem` cannot exist alone, so the recipe mounts
an open menu and puts `<C>` in the item's place. Force the overlay `open` and
`modal={false}`: an overlay that only appears on click cannot be sat with and styled, and
a modal one takes the pointer for the whole frame — including the editor's pan and zoom.

```tsx
DropdownMenuItem: {
  render: (C, props) => (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild><Button size="sm">Menu</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start"><C {...props} /></DropdownMenuContent>
    </DropdownMenu>
  ),
  props: { children: <><Pencil /> Rename</> },
},
```

*A composite root, assembled.* The catalogue folds a module's parts behind its root (see
below), which only helps if selecting the root shows the whole thing — and mounted bare
`<DropdownMenu>` renders an empty fragment, `<Card>` an empty box. Give each root the
assembly a designer would actually judge:

```tsx
Card: {
  frame: { width: 320 },
  render: (C) => (
    <C>
      <CardHeader><CardTitle>Q3 revenue</CardTitle>
        <CardDescription>Edited 2 days ago</CardDescription></CardHeader>
      <CardContent>A spreadsheet with 12 tabs.</CardContent>
      <CardFooter><Button size="sm">Open</Button></CardFooter>
    </C>
  ),
},
```

**Make the dummy content concrete.** "Rename", "Move to…", ⌘K, "Q3 revenue · 2 days ago" —
a menu of "Item 1 / Item 2" tells you nothing about how the real one wraps, truncates or
aligns, which is the only reason to look at it.

**Which components get a root recipe** is decided by the catalogue's own rule: the
shortest export whose name prefixes every other export in the module is that module's
composite root (`DropdownMenu`, `Card`, `Select`, `Sidebar`, `Table`, `Tabs`, `Avatar`,
`Toolbar`…). A module with no such name — two unrelated components in one file — stays
flat and needs no root recipe.

## Trap table

Each row: the symptom you will actually see, then the cause.

| Symptom | Cause and fix |
|---|---|
| Every scene renders unstyled | `tailwindcss()` was never added to the sandbox's plugin array. |
| Styles load but app classes are missing | `scene.css` has no `@source` pointing at the app's source. Tailwind scans the sandbox, not the app. |
| A forced `hover:` state makes the element **transparent**; a class the editor composes never applies | The safelist. `@source inline(...)` must be in the entry **at Tailwind's first compile** — Tailwind builds its compiler once per dev server and afterwards only re-scans source files, so appending the directive in `transform`/`load` and invalidating the module does nothing. The plugin keeps a real file outside the project, injects one `@import` of it into the entry, and **rewrites the file** to trigger a genuine watcher event. If you touch this code, verify by measuring the served CSS, not by reading it. |
| A binding change stages (Save badge moves) but the preview never repaints | Two separate causes, both shipped: (a) the class edit carried `file: ''` — the caller must stamp the selected component's file; (b) `planFiles` only reported **layout** intents, so the frame served the component unpatched and the publish reloaded nothing. Every patchable intent kind must resolve to a file through **one** function shared by `planFiles` and the frame's `load`. |
| The whole tab freezes on one interaction | An unstable default prop. `folders = []` in a signature is a fresh array per render; feed it through a memo chain into `@tanstack/react-table`'s `data` and its `onChange` queues `resetPageIndex()` on a microtask, which sets state, which renders again — a microtask loop that never yields. Hoist the default to a module constant. **The editor finds these because it mounts components with only their required props supplied.** |
| Pan / zoom do nothing | A new frame→host message was added to the TypeScript union and the host's switch but **not to the runtime validator table**. The guard drops unknown types silently, which is correct behaviour and indistinguishable from a dead feature. A test should assert every union member has a validator. |
| Filtering a list leaves stale rows behind | Duplicate React keys. Build the key from the item's own unique id, not from a subset of its fields. |
| Many primitives say "needs app context this preview does not mount" | Expected for a composite's parts — a menu item outside its menu really does throw. Write a `previews.tsx` recipe whose `render` mounts the parent (`<DropdownMenu open modal={false}>…`) with the component in its place. Force overlays `open` and non-modal: a modal one takes the pointer for the whole frame, including the editor's pan and zoom. |
| `X is a void element tag and must neither have children` | The generic mount passes the component's name as children. Set `children: false` in the recipe for anything rendering `<input>`, `<hr>`, `<img>`. |
| A slider/progress/input renders as a 0px line | No width. Give the recipe a `frame: { width: 260 }`. |
| `GET /metadata` answers `files: []` with no error anywhere | TypeScript **7** was installed. The extractor is written against the TS 5 API, and in 7 `(await import('typescript')).default.ScriptTarget` is `undefined`, so `ts.ScriptTarget.Latest` throws inside a lazily-imported module and the failure never reaches a log. The package pins `typescript: ^5`; if you override that peer, this is what you get — an editor that boots, serves, and analyses nothing. |
| The shell loads but every scene dies on `does not provide an export named 'createRoot'` | The frame's dependencies were served unoptimised as raw CJS. Only reachable if the plugin's `config()` hook lost its `optimizeDeps.include`; see the bullet above for why the scan cannot find them. |
| `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` on the plugin import | The package's main entry resolved to TypeScript. A Vite plugin is imported by the consumer's `vite.config`, which Vite bundles while leaving bare specifiers **external** — so **Node** loads it, and Node refuses to strip types under `node_modules`. The published entry is built JavaScript for this reason; a workspace link hides the problem, because the real path is then the source tree. |
| A component preview loses its state on every keystroke | `React.lazy(...)` called during render mints a new type each time. Memoise it, keyed on the content of its object-valued inputs. |
| Clicks inside a component preview do nothing | The frame's picker defaults to `picking = true` and swallows clicks. The host must send `wb:set-picking {enabled:false}` for a preview, where there is no page to navigate away from. |
| A list shows one composite as 15 peer rows | Those are its anatomy, not 15 subjects, and most cannot mount alone. Fold them behind the module's root — detected structurally, as the shortest export that prefixes all the others — and give the root an assembled recipe. Folding without the recipe is worse than not folding: the root mounts bare and renders nothing. |
| A composite has no root to fold its parts behind | The root is probably declared as `const ContextMenu = ContextMenuPrimitive.Root` — a re-export alias — or as an arrow function. An analyser that only records `function` declarations and `forwardRef` calls misses both, which is most of shadcn's current output. Record an exported PascalCase `const` whose initializer is an arrow function (a real component) or an identifier / property access (an alias, carrying no classes of its own). An object literal or a lowercase name is neither. |
| Grouping the catalogue by module leaves every group holding one row | Once the parts fold away, the module IS the component, and the heading just repeats its name. Group by the thing the list cannot otherwise show — **Primitives** (mounts with nothing) vs **App components** (has required props, so the preview must invent data). That split is derivable from the metadata and predicts whether a bare mount succeeds. |
| A floating editor stays open over the new subject after a switch | Two different causes, and fixing one hides the other. A **popover** closes on outside-pointerdown and Escape and is never told the subject changed — broadcast a close from the shell on any move (a module-level set of registered closers beats a provider; the callers share no ancestor below the app root). A panel keyed off **selection** — the class editor anchored to the picked node — stays because the selection state outlives the frame that produced it; clear the selection too, which is required anyway since every anchor in it points into a frame that no longer exists. |
| Panning reads as missing, though the code is there | It probably needs a modifier. A drag over the component belongs to the component (a slider, a text selection), so panning there has to be middle-button or space-held — but a drag on the empty ground around it has nothing else it could mean, and requiring a modifier for that is why nobody found it: dragging the canvas is the first thing anyone tries. Mark the component's own box (`data-wb-cell`) and let a plain drag pan whenever it did not start inside one. |
| The structure panel shows a composite as one `div` and stops | Correct and useless: `Card` returns one element, and its header, body and footer are SIBLING EXPORTS, not children — so a panel that lists the JSX a component returns has nothing to list. A composite's parts ARE its structure; show them there, each one a click to preview on its own. Which also settles where they should not be: folded into the catalogue, where a reader is picking a subject rather than reading an anatomy. |
| Zooming makes the point under the cursor trace an ARC instead of sitting still | Two errors that only show together. The frame reports the cursor in FRAME-LOCAL coordinates, so it must be multiplied by the current zoom before being added to any rendered offset; and if the stage is centred (`mx-auto`) its left edge moves with the zoom while its top does not, so one axis holds and the other drifts. Stop deriving the pan: record where the anchor is on screen, change the zoom, then in a **layout effect** measure again and shift the pan by the difference. No layout model, nothing to get wrong, and no visible flicker because it lands before paint. |
| Panning stutters under the cursor | Two causes, both worth fixing. The canvas grid was drawn with `background-position` on the pane — not a composited property, so every frame repainted the whole thing; give the grid its own absolutely-positioned layer moved by `transform`, offset by `pan % cell` so the layer itself never travels (inset it one cell on each side to hide the wrap). And `pointermove` outruns the compositor, so one state update per message queued several re-renders per frame: accumulate the deltas and commit once per `requestAnimationFrame`. |
| A floating panel's title and close button scroll away | The scroller is on the whole panel. Put `max-h` + `overflow-hidden` on the panel, `shrink-0` on the header, and give the body its own `overflow-y-auto` — otherwise the only way to dismiss a tall panel is to scroll back up to find its X, and the handle you drag it by goes with it. Applies to every panel with a bounded height: a review dialog, a floating class editor. |
| The structure tree reads `CardHeader()` above a single row reading `div` | Two lines to say one thing, times every part of a composite. When a root renders exactly ONE element, drop the heading and let that row carry the component's name (with the composite's prefix stripped — the pane already says `Card`); keep the tag beside it, dimmed, since it is still what you are selecting. |
| Drilling into a part leaves no way back | A part has no parts of its own, so whatever affordance took you in disappears once you arrive. The relationship reads both ways — derive "the root this is a part of" from the same rule and show it as a back control. And list the selected part in the catalogue even when parts are otherwise hidden: previewing something with nothing marked in the list reads as having lost your place. |
| A test cannot find a `position: fixed` panel | `offsetParent` is `null` for fixed elements, so a `d.offsetParent` visibility check reports every one of them as absent — and the test then passes against a bug. Measure `getBoundingClientRect().width > 0` instead. |
| A selected row's focus/selection ring is clipped, and the pane has a phantom gutter | An `overflow-y-auto` on the list. A ring is painted **outside** the border box and an overflow container has nowhere to put it; the container is also a second scroller inside a pane that already scrolls. Drop the overflow, add `p-1`. |
| Adding `"@/*"` to the consumer tsconfig explodes into hundreds of errors | Measured at 471: it makes `tsc` follow the alias into the app's whole graph and typecheck it under the sandbox's options. Declare the handful of app modules the sandbox imports in a `.d.ts` instead, loosely — the app's own `typecheck` is the program that should be checking them. Package aliases (`lucide-react` → the app's copy) are fine; it is **source** mapping that costs. |
| An edit to plugin source changes nothing | **Vite does not hot-reload its own plugins.** Restart the dev server. The other two stale-artifact traps: a prebuilt `dist/shell` (rebuild it — `predev` does) and a stale `packages/core/dist`. |

## Once it runs

Two commands close the loop for someone who is not the person who built it:
`pnpm design` starts the editor from a cold clone, and `pnpm design-pr` turns
what they changed into a pull request — descending a ladder so that the last rung
needs only a browser, never `gh auth login`. In wafflebase they live at the
repository root; a consumer would put the equivalent in their own `package.json`.
Neither holds a credential: they run `git` and `gh` as the person invoking them.

`.claude/skills/design-changes-to-pr` is the optional half — it reads the write
log (`GET {BASE}/api/transactions`, which carries the intent labels rather than a
text diff) and writes the title and body. The loop must close without it.

## Bring-up order

Do them in this order; each step is verifiable before the next has any chance of working.

1. `designEditor({ root, tokens })` only. `GET {BASE}/api/tokens` answers → the bridge is up.
2. Add `scenes.config.json` with `components` only. The catalogue lists them → the analyser reads your source.
3. Add `providers.tsx` + `fixtures/` + `scene.css`, un-defer one scene. It mounts **and is styled**.
4. Add `previews.tsx`, roots first then parts. Walk the catalogue; every entry either
   renders something worth judging or names what it needs.
5. Stage a class edit and watch the preview repaint; stage a token edit and watch it repaint. Both paths are separate — see the trap table.

## Verifying

Never conclude from a passing structural check. The gates that catch the traps above:

- `verify-scenes.mjs` — mounts every scene in a real browser, counts **utility rules**
  (not preflight rules) to prove "is styled", and reports unmocked requests.
- `verify-frame.mjs` — the same against a foreign fixture project, which is what proves
  the plugin is generic.
- `verify-tokens.mjs` — drives the token pipeline end to end.

When a gate is added for a bug, make it **mutation-proof**: re-break the code and confirm
the gate fails. The `is styled` check passed with 413 preflight rules and zero utilities
before it counted the right thing.
