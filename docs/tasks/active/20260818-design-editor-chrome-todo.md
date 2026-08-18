# design-editor shell chrome (PR 11b)

Part of #700. Stacked on 11a. The screen: React chrome in the prebuilt shell, and a
scene frame that actually mounts.

## Scope, as agreed

| Prototype file | Lines | Becomes |
| --- | --- | --- |
| `src/SandboxLayout.tsx` | 1,609 | the three-pane shell |
| `src/scenes/SceneHost.tsx` | 712 | host side of the frame protocol |
| `src/scenes/SceneOutline.tsx` | 323 | the tree of editable nodes |
| `src/scenes/SceneNodeDetail.tsx` | 296 | the selected node's properties |
| `src/scenes/FloatingClassEditor.tsx` | 272 | the class editor anchored to the node |
| `src/scene-entry.tsx` | 202 | replaces 11a's React-free placeholder |
| `src/sandbox/history.ts` | 396 | 9c — staged-edit undo/redo |
| `src/sandbox/anchors.ts` | 245 | 9c — client-side anchor resolution |
| | **4,055** | |

**The panels are IN, and an earlier version of this file had them out.** §8's row always
read "the React chrome (`SceneHost`, panels, `scene-entry`), token panels, canvas" — the
comma is the split, so 11 is the chrome and its panels and 12 is the token panels and the
canvas. A `11c` briefly appeared in the table for the outline/detail/class-editor group;
it was never in the plan and is gone.

Out of scope, as 12: `TokenEditorPanel` (861), `TokenBindingPanel` (668), `AddTokenRow`
(172), `ReviewApproveModal` (534), and the canvas scenes.

## The blocker, probed away

11a recorded that `react` resolved from inside our own package would find OUR copy —
a devDependency the shell build needs — before the consumer's, and that two Reacts in
the frame breaks hooks in the components under review. It planned a peer dependency
plus `resolve.dedupe`.

**Measured against a live Vite 6.4.3 + @vitejs/plugin-react 4.3.4**, with two
physically distinct React copies (the consumer's at the project root, ours inside the
package) each carrying a marker:

| our package installed as | entry resolves `react` to | which physical copy | fast refresh |
| --- | --- | --- | --- |
| a real dir under `node_modules` | `/.vite/deps/react.js?v=…` | the **consumer's** | no |
| a workspace symlink (pnpm `workspace:*`) | the same `/.vite/deps/react.js?v=…` | the **consumer's** | **yes** |

Vite's dep optimizer pre-bundles `react` once, resolved from the project root, and
both our entry and the consumer's own components import that single chunk. Our copy
appears nowhere in `.vite/deps`. **So there is no two-React problem and no
`resolve.dedupe` is needed** — 11a's note was speculation, and this is the second
time in this series that a plausible mechanism did not survive being measured.

It also corrects 11a's fast-refresh caveat: no boundary for a `node_modules` install,
but a workspace-linked consumer — which `design-sandbox` is — does get one, because
the resolved path is outside `node_modules` and `plugin-react` stops excluding it.

**Still to decide:** whether to declare `react`/`react-dom` as peer dependencies
anyway. Resolution works without it, but the declaration is the honest metadata — we
do need the consumer's React. Against: the fixture consumer has no React at all, so a
required peer would warn there. Leaning optional peers, recorded either way.

## What has to be rewritten rather than ported

Every one of these is the `registry.tsx` problem — generic-looking chrome built from
the consumer's component library:

- `cn()` from the consumer's `@/lib/utils` → 11a's local `src/shell/lib/cn.ts`
- three shadcn primitives — `select`, `tabs`, `popover`
- `scene-entry` imports fixtures the design doc files under population C → those stay
  out; the entry takes them from `virtual:wb-scenes`

**§6's "SceneHost alone has 25 `Select` call sites" is wrong, and it was steering the
plan.** 25 is what `grep -o 'Select'` returns — it counts the import, the type, and
every closing tag. Measured properly:

| | JSX tags | instances |
| --- | --- | --- |
| `Select` (SceneHost) | 9 | **1** — the zoom dropdown at prototype line 491 |
| `Tabs` (SandboxLayout) | 8 | 1, holding 3 tabs |
| `Popover` (SandboxLayout) | 6 | 2 |

So the whole consumer-component surface of 11b is four imports and four widgets.
Vendoring three Radix packages into the shell bundle for that is disproportionate:
shadcn's `select` alone pulls `@radix-ui/react-select` plus `lucide-react` icons.
A native `<select>`, three buttons, and a positioned `<div>` cost nothing and have no
dependency — and this is OUR chrome, not the consumer's design system, so it owes
their component library nothing. Write them locally under `src/shell/ui/`, and correct
the §6 row while doing it.

## Open questions to settle before writing

1. **How the host talks to the frame.** `frame-protocol.ts` (10a) defines the
   messages and `frame-picker.ts` (10b) is the frame side. `SceneHost` is the host
   side, and the two have never run against each other — 10a/10b were unit-tested
   only. Expect the contract to be wrong somewhere; find it with a live frame, not by
   reading.
2. **Whether `design-sandbox` needs `plugin-react` now.** 8c deliberately deferred
   it. A scene that mounts React needs it, so this is probably where it lands — which
   makes `design-sandbox` the first consumer that can prove the chrome end to end.

## Done when

- [x] `/__design-editor/` renders the three-pane shell, not a `/health` readout
- [x] a scene frame mounts a real component from the fixture or the sandbox
- [x] clicking a node in the frame reaches the host and draws the overlay
- [x] staged edits undo/redo through 9c's history — `verify:frame` clicks a node, toggles
      a class, and steps ⌘Z / ⇧⌘Z against the plan count. It is the ONLY thing that
      covers this: staging needs a measured selection rect, which needs a loaded iframe.
- [x] the shell bundle still contains no reference to the consumer's stylesheet
- [x] the gate asserts the frame mounts, not merely that its document serves
- [x] §8 records what 11b took and what the panels row still holds

## What the writing changed

Six commits, `3e97cacfe..HEAD`. Counts at the end: 991 unit tests / 39 files,
`verify:consumer` 54/54, `verify:frame` 34/34.

**Three defects fixed in the ported code**, each of which the prototype shipped:

1. `SceneNodeDetail` printed the literal string `expression — cn(…)` for every
   non-literal `className`. That guessed at the joiner — the same shape covers
   `t("nav.home")` and `styles.row` — and it could not distinguish a class it cannot
   edit from one that is not there. 7b's `classNameExpr` is the field that actually
   says, so the expression is now printed verbatim.
2. `FloatingClassEditor` attached its drag listeners inside a `pointerdown` handler and
   removed them on `pointerup`. Unmount mid-drag left the `pointermove` handler running
   for the session, setting state on a gone component once per mouse move; a second
   `pointerdown` stacked another pair.
3. Its icon-only buttons had no accessible name.

**One thing found by the gate, in the gate**: `verify:frame` rebuilt the shell only
when `dist/shell/index.html` was *missing*, so it happily served a bundle older than
the change under test. A browser gate that can pass on stale bytes is worse than none,
because its green is not evidence. It now compares the newest mtime under `src/`.

**One feature nearly lost in the port**: the prototype registered the frame's rendered
classes as Tailwind candidates through `useTailwindCandidates`, which is not in 11b's
file list. Dropping it silently would have made the class editor *look* broken —
Tailwind emits no rule for a class it never saw in source, so adding `gap-4` would
stage an edit and preview as nothing. The layout now posts the set difference to
`/candidates`, and the gate asserts the safelist grew.

**Scope not taken**, stated rather than left as a hole: the `components` mode
(`ComponentList` + `PreviewPane`) is in neither 11b's table nor 12's, and
`ReviewApproveModal` is 12's — so ⌘S writes the plan directly today.
