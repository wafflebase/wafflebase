---
title: design-editor-sandbox-recipe
target-version: 0.6.2
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Design Editor — Sandbox UI Recipe

> **⚠️ This document's premise was superseded by the local-plugin pivot.**
> It was written as an *AI agent bootstrapping prompt*: "read this recipe and
> **scaffold your own** editor UI in a new repository, on top of an installed
> `@wafflebase/design-editor`." That is no longer the delivery model. We ship the
> editor UI **in** the package; consumers install a Vite plugin and configure it,
> they do not rebuild the three-pane shell. See
> [`design-editor-local-plugin.md`](./design-editor-local-plugin.md).
>
> **It is still the authoritative description of the UI we ship**, and that is why
> it is kept rather than deleted: §2.11–2.13 (the host↔frame boundary, the real
> providers, the three selection outcomes) and §6 (the two-altitude edit history)
> are load-bearing for anyone touching the shell. Read it as *"how the shipped
> editor is built"*, not as *"how to build your own"*. The scaffolding-oriented
> framing in §0 and §5 is the part that is stale.
>
> For the engine/protocol it talks to, read
> [`design-editor-engine.md`](./design-editor-engine.md) first.

---

## 0. Goal statement

Build a three-pane, dev-only React sandbox that lets a human (or you) **edit a
live design system by direct source mutation**: rebind component classes to
different tokens, edit token values, rebind semantic tokens to palette colors,
edit the palette itself (with cascade), define interaction states (hover /
active / focus / disabled), and create new tokens in any family — always
previewing the change live, then reviewing a real dry-run diff before writing to
disk.

It behaves like a **document editor**, and that framing decides several designs
below: edits accumulate in an undo/redo history, "Save to Code" is an explicit
`⌘S`, the header says *unsaved* or *saved*, and the history survives a page
reload. See §6.

**Non-negotiable constraints** (inherited from the engine):
1. The sandbox package **never gets imported by the app**. One-way dependency.
2. **Zero new runtime dependencies.** Reuse the frontend's shadcn/Radix
   components via the `@` alias; hand-roll anything missing (accordion, toast,
   combobox) rather than adding a library.
3. **Forced tokenization.** The UI edits tokens/CVA values — it never encourages
   hardcoded hex in components. Palette integrity is preserved (see the engine's
   Dual-layer Palette Cascade).
4. All writes go through the bridge (`design-editor-engine.md` §3). The browser
   never writes files.
5. **Source is the source of truth for defaults.** Never snapshot
   `getComputedStyle` as "the current value" — it goes stale the moment a write
   lands. Read values from introspection and re-fetch it after every write
   (`design-editor-engine.md` §3.2).
6. **The UI must not lie about state.** "edited" means *differs from source*, not
   "an edit object exists"; a written edit reads as `in code`. A save must not be
   confusable with a discard.
7. **The sandbox is not the only writer.** The user's code editor, git, and other
   tools change the same files. Every staged edit must be re-validatable against
   current disk, and there must always be a way to discard one that no longer
   applies — otherwise an external edit wedges the editor permanently dirty (§6.6).
8. **A class the editor composes at runtime has no CSS until Tailwind is told
   about it.** Register it (§2.10). This is not an optimisation; without it the
   preview silently does not repaint.

---

## 1. Entry & styling

- `index.html` mounts `#root` and loads `/src/main.tsx`.
- `main.tsx`: `createRoot(...).render(<StrictMode><SandboxLayout/></StrictMode>)`
  and imports `./sandbox.css`.
- `sandbox.css`: `@import "../../frontend/src/index.css";` **plus**
  `@source "../../frontend/src";` — the latter is mandatory or portaled frontend
  components (Dialog!) render unstyled. (Engine §7.5.) **Plus**
  `@import "./generated/safelist.css";` — the bridge-written registry of
  runtime-composed classes (§2.10).
- Beware: **Tailwind scans comments.** Naming a class in prose makes Tailwind
  generate it, which can make a broken candidate pipeline look like it works.

---

## 2. Component architecture

### 2.1 Layout shell — `SandboxLayout.tsx` (the single source of truth)

A `grid-cols-[240px_1fr_340px]` three-pane body under a header. **All edit state
lives here**, held by one `useEditHistory` hook (§7); every child is controlled.
React re-render *is* the subscription model — there is no state library.

**Header** (left → right):
- Brand mark + a pill showing `{N} components · {M} tokens`.
- **Dirty / clean pill** — `unsaved` (amber, with the pending write count) or
  `saved`. Derived from `history.dirty`, i.e. present ≠ baseline, NOT from a
  counter of saves.
- A `restored` pill when a persisted edit history was rehydrated on load.
- A **`{N} stale` pill** (destructive) when re-validation says some staged edits no
  longer match the code. Opens a popover listing each one with its reason, a
  per-item **Discard**, **Re-check**, and **Discard all stale** (§6.6).
- **Bridge health dot** — polls `GET /__design-editor/health` every 10s; emerald =
  up, destructive = down, muted = checking. Also the source of `sessionId`, which
  keys the persisted history.
- **Theme toggle** — flips a `dark` boolean that adds/removes the `.dark` class
  on the root wrapper (`<div className={cn(dark && 'dark')}>`).
- **Undo / Redo** — the **edit** history (`⌘Z` / `⇧⌘Z`), disabled at depth 0.
- **Write log popover** — the bridge's committed writes, with *Revert last write*
  / *Re-apply*. Deliberately separate from Undo/Redo and labelled as such (§6.4).
- **Reset** — clears every staged edit. Note this is not "discard": if a save
  already happened, the next save *reverts* those writes (§6.3).
- **Save to Code** — opens `ReviewApproveModal`; disabled when the write plan is
  empty; badge = plan size. Bound to `⌘S`.

**Panes:**
**There are two MODES**, switched from the top of the left pane:
`components` edits one primitive's CVA; `scenes` edits a whole route file. They
are modes rather than two lists in one tree because they differ in every
dimension that matters — addressing (a cva value vs a `NodeAnchor`), preview
mechanism (a class override vs a patched module), and what the right pane can
usefully say.

| Pane | `components` | `scenes` |
|---|---|---|
| **Left** | `ComponentList` — searchable list from the AST metadata; a dashed icon marks components with no live preview. | The scene list from `scenes.config.json`, each showing its route. |
| **Center** | `PreviewPane` — live render of the selected component + variant with all overrides applied, plus the interaction-state simulator (§2.3). Right-click summons the `AgentPopover`. | `SceneHost` — the iframe, viewport buttons, zoom, and the picking toggle (§2.11). |
| **Right tab 1** | **Token bindings** → `TokenBindingPanel`. Its `TabsContent` carries `style={tokenStyle}` so token-value/palette edits reflect live in the binding swatches. | **Layout** → `SceneOutline` over `SceneNodeDetail` (§2.13). |
| **Right tab 2** | **Token Editor** → `TokenEditorPanel`. | **Token Editor** → the same panel. |

**Why "Token bindings" is absent in scenes mode and "Token Editor" is not.**
`TokenBindingPanel` takes a `component` and a `variantState`: it edits one
primitive's CVA classes, so while a whole route is under edit it would be
describing a Button nobody is looking at. It is removed rather than left inert.
The Token Editor is the opposite case — it edits `tokens.css`, whose blast radius
is every scene as much as every component, and judging a semantic colour on a
real page instead of an isolated button is the most valuable thing this tool
does. It *looked* useless in scenes mode for one revision only because its live
preview was an inline style on a host element, which cannot cross into an iframe;
`wb:set-token-vars` (§2.11) fixed that, and the panel earns its place.

**Overlays (siblings at the root):** `AgentPopover`, `ReviewApproveModal`,
`Toaster`.

`dark`, the mode, the selected component and the selected scene are persisted
separately (`design-editor:view:v1`) — they are view state, not edits, and must not
appear in the undo history.

### 2.2 The edit-state model

One `EditState` object (`edits.ts`) holds everything staged. `SandboxLayout` never
calls `setState` on it directly; it goes through `history.update()`, which is what
makes every change undoable and persisted.

| Field | Type | Set by | Written via kind |
|---|---|---|---|
| `classEdits` | `Record<string, PendingClassEdit>` | binding comboboxes + state rows | `class-rewrite` |
| `tokenEdits` | `Record<string, PendingTokenEdit>` | token editor (literal/neutral) | `token-value` |
| `tokenAdds` | `Record<string, PendingTokenAdd>` | per-section Add + "Promote to token" | `member-add` |
| `rebinds` | `Record<string, PendingTokenRebind>` | token editor (Palette mode) | `token-rebind` |
| `paletteEdits` | `Record<string, PendingPaletteEdit>` | palette section / custom-hex cascade | `palette-value` |
| `layoutEdits` | `Record<string, PendingLayoutEdit>` | scene canvas + outline panel | `layout-props` / `layout-insert` / `layout-remove` |

Held outside the history (view state, not edits): `variantState`, `dark`,
`selectedName`, `introspection`, `bridgeUp`, `sessionId`, the write log.

**Keys matter.** Each map is keyed so an edit to the same control dedupes and
survives component/tab switches — and so `saveDiff` can tell "changed" from
"newly added" from "removed". Every pending edit also captures its **old value**
(`oldValue` / `fromRef` / `fromValue`), which is what makes a revert possible at
all (§6.3).

`saveDiff(baseline, state)` — not a map-size sum — produces the write plan and
therefore the header count, the Save button's enabled state, and the modal's
contents.

### 2.3 `PreviewPane` + the interaction-state simulator

Renders `previewRegistry[component.name](variantState, overrideClass, opts)` inside
a wrapper carrying `style={tokenStyle}`. Three override channels:
- `overrideClass` = the `to` classes (and `additions`) of applicable `classEdits`,
  merged by the component's own `cn()`/`twMerge`.
- `tokenStyle` = the unified CSS-variable overrides (see §2.8).
- **forced state classes** = the pinned state's modifiers, promoted to
  unprefixed (below).

`previewRegistry` maps component name → a live renderer using the **real**
frontend component (`Button`, `Badge`, …) pulled via `@`. A component with no
entry shows "preview unavailable".

**The state simulator.** A chip row — Idle / Hover / Active / Focus / Disabled —
pins a state so it can be *edited while visible*. A CSS pseudo-class cannot be
triggered from script, so rather than faking `:hover` the simulator takes the
class string that is actually in effect (`appliedClasses()` = base + active
variant values + staged edits), finds every token whose modifier chain contains
the state, and re-emits it with that one modifier removed
(`states.ts#forcedStateClasses`). `dark:hover:bg-input/50` → `dark:bg-input/50`;
other modifiers are preserved because the theme wrapper still decides whether they
match. `twMerge` then resolves them over the resting values, so what you see is
what a real hover paints — and it stays on screen while you adjust the colour in
the right pane.

`Disabled` additionally passes a real `disabled` prop through `PreviewOptions`,
because `disabled:` keys off the attribute and the component's own
`disabled:opacity-50` should engage exactly as it does in the app.

### 2.4 `TokenBindingPanel` (right tab 1)

- **Variant chips** per CVA axis; the active value is highlighted
  (`border-primary bg-primary/10 text-primary`).
- Per **active scope** (each axis's selected value + base):
  - **Resting colour rows**, grouped by role. Each is a `Combobox`; changing it
    stages a `PendingClassEdit` **scoped to that one CVA value** ("active variant
    only"). Only roles with a *resting* occurrence get a row, and the rewrite
    skips state-modified tokens — the state rows own those (§2.5).
  - **Scale rows** (radius/spacing/font-size), unchanged.
  - **Interaction states** — one row per (state × colour utility) that either has
    a state class or has a resting class to derive from. See §2.5.
  - Changed rows show an "edited" badge + a **per-row reset** (`RotateCcw`).
- Colour comboboxes get `contentClassName={dark ? 'dark' : undefined}` and
  `contentStyle={tokenStyle}` so their **portaled** swatches theme correctly and
  reflect pending token edits (Radix portals escape the `.dark` + override
  wrappers otherwise).
- The role vocabulary is the static metadata list **∪** everything in source
  (`extraRoles`, from introspection) **∪** tokens staged this session — so a
  just-promoted `primary-hover` is immediately selectable.

### 2.5 Interaction states — the UI for two tiers

Each state row has exactly two controls plus one escalation:

| control | writes | when |
|---|---|---|
| role `Combobox` | `class-rewrite` on that one token | pick which token the state uses |
| ↳ its first option, **`none — use resting colour`** | `removals` (or drops the staged edit) | this state should have no colour of its own |
| opacity `select` (`no alpha`, 95…10) | same edit, rebuilt | tune a *derived* state |
| **Promote to token** | `member-add` + `class-rewrite`, one batch | the state needs its own token |

A state with no class yet shows a single **"Define hover (primary @ 90%)"**
button, which stages an `additions` entry seeded from the resting value — so the
common case is one click, and the uncommon case (a bespoke colour) is one more.

**Two kinds of "nothing", and they are not the same control.** *Reset* (`RotateCcw`,
only on a changed row) restores whatever **source** says — which may itself be a
state colour. *`none — use resting colour`* is a positive choice that the state
should have **no** colour, and it is the only way to delete a `hover:bg-accent` the
source declares. Without it the panel could add and re-point state colours but
never remove one. Its inverse is the matching `additions`, so undoing an unset past
a save restores the exact class.

**`no alpha`, not `100%`.** Opacity `100` emits no `/n` modifier at all, so
labelling it "100%" invites the reading "there is an alpha, set to full". The
dropdown says what is true: this token carries no alpha.

`Promote to token` creates `--<role>-<state>` seeded with
`color-mix(in oklab, var(--<role>) <opacity>%, transparent)` and repoints the
class at it. It disappears once that token exists — at that point the role picker
is the right tool, not a second promotion. The reasoning for the two tiers, and
why derived is the default, is in `states.ts` and `design-editor-engine.md` §6.4.

> **UX question answered: modifier vs separate token — do both, but not equally.**
> A modifier is *derived*: it cannot drift from its base token, adds nothing to the
> pipeline, and is how this codebase already authors states. A semantic state token
> is *declared*: it costs a type member, two map entries, an emitter line and a
> theme alias, and it can silently diverge from the colour it was derived from.
> Offering only modifiers makes hand-picked state colours impossible; offering only
> tokens quadruples the token count for no benefit and invites drift. So: derive by
> default, promote on demand, and make the promotion behaviour-preserving so it is
> never a leap of faith.

### 2.6 `TokenEditorPanel` (right tab 2) — the palette-aware editor

- **Filter input**, then four **accordion sections** — **Colors**, **Palette**,
  **Radius**, **Typography** — each with its own **Add (+)** button in the header.
- **`ColorTokenRow`** (Colors) is binding-aware, driven by
  `introspection.bindings[theme][camelKey]`:
  - Shows a `🔗 <ref>` chip when palette-bound.
  - **Palette | Custom** mode toggle. The mode **derives** from the binding
    (`modeOverride ?? (isPaletteBound ? 'palette' : 'custom')`) so it isn't
    frozen on "Custom" before async introspection loads.
  - **Palette mode** → a palette-colour `Combobox` (swatches are concrete hex, so
    portal-safe); selecting stages a `PendingTokenRebind`.
  - **Custom mode** → a colour+hex input. On a palette-bound token this **edits
    the palette entry** (`PendingPaletteEdit`, cascade) by default, with a
    "cascades to N tokens + external consumers" note and a secondary **"Detach
    this token instead"** (writes a literal `PendingTokenEdit`). On a
    literal-bound token it edits the literal directly.
  - `computed` bindings are read-only (edit via the Palette section).
- **`PaletteLeafRow`** (Palette section) edits a raw `palette.*` colour directly —
  first-class Workflow B, with the usage count shown.
- Radius/Typography rows are plain literal editors (`token-value`). Both lists are
  **derived from introspection**, so a token created here appears as a real row
  after the save instead of only in the static catalog.
- Badges: `edited` (differs from source) · `in code` (staged **and** written —
  see §6.3) · `no utility` (reaches `tokens.css` but has no `@theme inline` alias,
  so no class resolves to it; `--radius` is exempt, being the base the other
  `--radius-*` steps compute from).

### 2.7 Adding tokens — per-section, not one unified button

Each section header carries a `+`. Clicking it **expands the section if collapsed
and immediately renders a focused draft row** (name + value + Stage/Cancel, Enter
stages, Esc cancels) as the first child of that section.

> **UX question answered: unified add button vs per-category.** Per-category wins
> here for three reasons specific to this editor. (1) **The category is the
> type** — a unified popover had to ask "Color / Radius / Typo" as its first
> question, a step that existed only because the button had no context; clicking
> `+` on **Palette** cannot mean anything else. (2) **The result appears where it
> will live** — a draft row among its siblings makes naming and collisions visible
> while you type, instead of after you stage. (3) **It scales with the pipeline** —
> every family the bridge can inject gets an add affordance for free, whereas the
> unified popover grew a chip per family and went stale the moment one was wired
> (which is exactly what happened to Radius/Typo). The cost is discoverability, so
> the sections are always visible and the `+` sits in a fixed header slot.
> `AddTokenPopover.tsx` is deleted, not kept alongside — two ways to do the same
> thing is the worse outcome.

The draft row states its consequence before you commit to it: *"Creates
`--brand-accent` + the `--color-brand-accent` alias → usable as
`bg-brand-accent`"*. Palette colours are included (`+` on **Palette** →
`palette.ts` + `--wb-*` + alias), which is what makes "add a palette color" a
first-class flow rather than a hand edit.

### 2.8 State reactivity via CSS variables — `edits.ts#tokenPreviewStyle`

The one function that makes previews live. Given the active theme and all edit
lists, it returns a `CSSProperties` of `--var` overrides:
1. **Literal edits** → `--<cssVar>` (theme-isolated: a `light` edit is skipped in
   `dark` and vice-versa; radius/typography apply to both).
2. **Rebinds** → `--<cssVar>` = the target palette color's hex (active theme only).
3. **Palette edits** → for every semantic key whose binding `ref` matches, set
   `--<camelToKebab(key)>` = the new hex. **This is the full cascade preview** —
   editing `palette.syrup` recolors `--primary`, `--ring`, `--chart-1`, … at once.

The same `tokenStyle` is applied to the PreviewPane subtree **and** the Token
bindings tab, so a change shows everywhere instantly with no disk round-trip.
This works because the frontend's `@theme inline` compiles `bg-primary` →
`var(--primary)`.

### 2.9 `ReviewApproveModal`

Takes the **write plan** (`saveDiff(baseline, state)`), dry-runs every intent in it
(`previewMutation`) and renders:
- A **navigable card** per edit: component before/after for class/token edits;
  a single swatch for a new token; a **before → after swatch + cascade-impact
  warning** for rebinds/palette edits.
- The **unified diffs** (color-coded +/−) per file.
- A red **"Mutation bridge unreachable"** banner if any dry-run had a transport
  error; Approve is disabled and labeled "Bridge offline", and the modal stays
  open on transport failure (never silently closes).
- An amber **"Undoing N earlier changes"** block listing the plan's `revert`
  items, with a one-line explanation ("these were written earlier but are no longer
  in the editor"). Reverts have no meaningful "after" preview, so they are named
  explicitly rather than hidden among the diffs; their diff rows are tagged
  `revert` too.
- **Approve & Write** → `commitMutations(plan)` — ONE batch, one write-log entry —
  then `onApproved()` → `history.markSaved()` + `refreshIntrospection()` +
  refresh the write log. Note `markSaved`, **not** a reset: the edits become the
  baseline so `⌘Z` can still step back past the save (§6.3).
- A failed `tokens.css` regeneration is toasted from `regenError` instead of being
  silently absent.
- **A per-row `Discard`** on any intent that could not be located, plus a
  "Discard the N unmatched edits" action in the amber summary. This modal is where
  an external file change actually surfaces, so the way out belongs here and not
  only in the header (§6.6). Skipping an edit without offering to drop it is what
  leaves the editor permanently dirty.

Built on the frontend's Radix `Dialog` via `@` — remember the `@source` rule or
it renders invisibly.

### 2.10 Registering runtime-composed classes — `candidates.ts`

`useTailwindCandidates(classNames)` posts every class the preview is about to
render to the bridge (§3.6 of the engine doc), debounced, deduped for the page's
lifetime, and retried if the post fails so a transient error cannot poison the
cache. `PreviewPane` calls it with the live class string **and** the forced
(state-simulated) variant of each state.

**Why any of this is necessary.** Tailwind emits a rule for a utility only if that
exact class appeared in a scanned file. `hover:bg-secondary/70`, assembled from a
role plus an opacity the user just picked, exists in no file — so there is no rule,
and the preview does not repaint. The one combination that appeared to work,
`hover:bg-primary/90`, worked because `button.tsx` contains that literal string.
Every other role and every other alpha was silently a no-op.

Three traps, all of them hit while building this:

1. **A static safelist is not viable.** The full product the panel can reach is
   ~26 000 candidates → **6.8 MB of CSS**. Measured.
2. **Do not hand-write the CSS.** Emitting `color-mix()` yourself makes the
   preview's colour maths *your* reimplementation of Tailwind's. The sandbox's
   premise is that what you see is what the committed code does, so the rule has to
   come from Tailwind.
3. **Writing the file is not enough** — the open page keeps its cached stylesheet
   until the importing module is explicitly invalidated (engine §7.7). This one is
   dangerous because the file is correct and the rule is provably generated; only a
   same-URL refetch exposes it.

A **fourth** trap surfaced with scenes: the hook has to be called with what the
*frame* paints, not only what the host paints. The frame shares the host's
stylesheet (that is why `scene-entry.tsx` imports the same `sandbox.css`
specifier), so the mechanism is unchanged — but a class composed for a scene has
no rule until the frame reports it back over `wb:classes`. `SandboxLayout` feeds
that straight into `useTailwindCandidates`. Without it a staged class edit can be
entirely correct and still not repaint.

### 2.11 `SceneHost` and the iframe boundary

**Width is real; zoom is separate.** The viewport buttons set the iframe's actual
CSS width (390 / 768 / fill) and never a transform. `hooks/use-mobile.ts` reads
`window.innerWidth` and `matchMedia` *inside* the frame, so a real width makes
`useIsMobile()` resolve the way it will in production and `md:` / `lg:` variants
match for the same reason. A transform-scaled "mobile" preview reports the
desktop width and renders the desktop branch at phone size — actively misleading,
and `mobile-slides-view.tsx` exists, so routes really do branch on it.

**Zoom is `transform: scale()` on a wrapper, never CSS `zoom` on the iframe.**
The separate zoom control serves the "see a 1440px layout inside a 900px pane"
need, picked from a dropdown (25%–200%) rather than three fixed buttons. It used
to set the non-standard `zoom` property directly on the `<iframe>` element; that
was wrong for the same reason a transform-scaled *width* would be wrong; some
implementations resolve a percentage-sized descendant against the **zoomed**
containing block, so a frame with `width: 100%` no longer necessarily reports the
pane's real width once zoomed — the exact "frame lies about its own geometry"
failure this component exists to prevent, just reached through the zoom property
instead of a width transform. `transform` never participates in layout, so the
fix wraps the iframe in a stage `<div>` sized to its **real**, unscaled pixel
box (measured off the pane via `ResizeObserver` when the viewport is "fill",
since a percentage width is what created the ambiguity) and scales that wrapper.
The overflow-auto pane still sizes its scrollable region and `mx-auto` centering
off the *transformed* box (part of the CSS Transforms spec), so scrolling and
centering come out right with no extra math — only `transformOrigin: 'top
center'` is needed to keep the scaled picture centered under the unscaled one.

**Freeform resize drags the same real width/height zoom protects.** Three
DevTools-style handles (right / bottom / corner edge) sit on a `relative`
FOOTPRINT wrapper sized to the box's own on-screen dimensions
(`renderWidth*zoom` × `renderHeight*zoom`) — a sibling of the `scale()`d stage,
not a descendant of it, which is why `transformOrigin` moved from `top center`
to `top left` and centering moved up one level onto this new wrapper. A handle
living *inside* the scaled box would itself shrink at low zoom (a 3px hitbox
at 25%); living on the footprint it is always the size the cursor is. Dragging
sets a `customSize` override in the same real, unscaled px `VIEWPORT_WIDTH`
uses — never a second transform — read once at `pointerdown` (not accumulated
frame-to-frame) so a dropped `pointermove` cannot compound into drift.
Selecting a preset button clears `customSize`, so the two controls never fight
over which one is authoritative.

**Picking is a mode.** A click on a `<Link>` is either a selection or a
navigation; it cannot be both, so there is a visible `Pick` / `Use` toggle rather
than a modifier key that would have half the clicks in a session do the wrong
thing. Picking defaults to on.

**Every host→frame effect is gated on `wb:ready` and re-sent when it flips.** A
message posted before the frame installs its listener is dropped silently, so
without the re-send a frame reload would come back with no selection, no picking
mode and no token overrides. For the same reason `ready` is reset when `sceneId`
changes: the iframe is keyed on the scene, so it remounts, but `ready` is *host*
state and would otherwise still be `true` from the outgoing frame.

**The floating class editor anchors in HOST-page pixels, not frame pixels.**
`onSelectionHostRect` converts the frame-local rect (`wb:measured`) using the
iframe ELEMENT's own `getBoundingClientRect()` — which already reflects the
host's scroll and the `scale()` transform, since that is the iframe's actual
painted box — plus the frame-local rect scaled by `zoom`. Recomputed on a
fresh measurement, a zoom change, or the pane scrolling/resizing, not only once
per selection, or the panel would drift from the node as soon as any of those
moved independently of a reselect. `FloatingClassEditor.tsx` (`SandboxLayout`)
renders at that rect via `createPortal` + `position: fixed`, not a Radix
popover — Radix's pointer-event handling is built to own the page it floats
over, and this one floats over an iframe whose clicks must keep reaching
`frame-picker.ts`. Its quick controls (direction/align/justify/gap, width/
height) are closed Tailwind enumerations on purpose: `SceneNodeDetail`'s own
"Off-token values" warning treats an arbitrary px literal as a defect
elsewhere in this tool, so a control that defaulted to emitting `w-[137px]`
would manufacture exactly that. A raw class chip list is the escape hatch for
anything a preset does not cover.

**The panel is draggable, on top of its computed anchor, not instead of it.**
The header carries `onPointerDown`; dragging accumulates a `{x, y}` offset added
to the anchored position, so the panel still tracks the node (scroll/zoom
recompute `hostRect`, which still applies) while sitting wherever the designer
moved it to. The offset resets to zero only on `key={selection.stamp.id}` —
i.e. a genuinely NEW node selection remounts the component — and is preserved
across a `hostRect` update to the SAME node, which is a plain prop change, not a
remount. Conflating the two would either fight the user's drag on every scroll
tick or leave a stale offset pointing at empty space after the next selection.
The close button stops propagation on `pointerdown` so clicking it does not
also register as the start of a drag.

**The Mock Data toggle.** A button beside Reload flips `mockDataEmpty`, which is
baked into the iframe's `key` (`${sceneId}|${side}|${nonce}|${empty ? 'empty' :
'full'}`) and into `sceneFrameUrl`'s `?empty=1` query — so toggling it is a real
frame reload, not a live patch. `scene-entry.tsx` reads the flag once at load and
installs `emptyFixtureTable(fixtures)` instead of the fixtures themselves, which
recursively empties every array reachable from any fixture value. A live
`postMessage` toggle was rejected: every fixture-backed query in the scene would
need to refetch anyway, and a frame reload is the sandbox's existing mechanism
for exactly that (the same reasoning `theme`/`scene`/`frame` already use).

**One live frame.** A scene mounts real product code (and from CP4 a real canvas
engine); two full instances in a tab is an OOM hazard, so a module-level counter
warns above one. A leaked frame then surfaces during development instead of as a
crash an hour later.

**Two-way route sync.** The list's active row is the host's own `sceneId`, set
one direction only — until now: clicking Data Sources while viewing Documents
(picking OFF) had nowhere to go, because a shell scene's `MemoryRouter`
declares exactly one page route. That used to 404 into an empty `<Outlet/>`,
indistinguishable from a broken scene (§2.12's `SceneProviders` note about the
Analytics nav entry). `SceneProviders#RouteEscapeNotifier` is a wildcard
sibling route that catches exactly that case and posts `wb:route-change` with
the attempted path; `SceneHost` forwards it as `onRouteChange`, and
`SandboxLayout` matches the path against `scenes.config.json`'s `route` field
(a plain string match — every manifest route is a concrete fixture path, none
are patterns) and calls `setSceneId`. That is a REAL frame reload onto the
target scene's own module, not an in-place render: each frame is one Vite
entry keyed to one patched module, so there is no way to keep this frame alive
and have it become a different scene's editable module. A path matching no
manifest scene toasts instead of switching, rather than silently doing nothing.

### 2.12 `SceneProviders` — real providers, substituted data

Composed by name from the scene's `mocks`, nesting mirroring `App.tsx`
(Theme > Tooltip > Query > Router). Never a hand-written stub: a fake `useQuery`
or a fake `Link` diverges from the app's real loading/empty/error branches, and
the sandbox's premise is that what you see is what the committed code does.

Three things that are not obvious:

- **`mocks: ["auth"]` names no provider.** The frontend has no auth context
  (`createContext` appears only in `theme-provider.tsx`, `ui/chart.tsx` and
  `ui/sidebar.tsx`); identity arrives over `/auth/me`, so the key means "install
  the auth fixtures". The key is kept because it still documents the scene's
  dependency surface.
- **`shell: "app"` is a nested ROUTE, not `<Layout>{children}</Layout>`.**
  `Layout` renders `<Outlet/>`, not `props.children`, so wrapping directly would
  mount the sidebar and header and then render *nothing* where the page belongs —
  a convincing shell around an empty content area, which is worse than no shell
  because it looks deliberate. Declaring the real parent/child pair is also what
  `App.tsx` does, so `useLocation`, the header's `matchPath` title and the
  sidebar's active state resolve exactly as in production.
- **Nothing may refetch, retry or expire.** A retry turns one missing fixture into
  four identical kill-switch throws; an expiry turns a static scene into one that
  flickers through its loading state while you are judging spacing.
  `staleTime: Infinity` also means the documents page's 5 s "currently editing"
  poll resolves from fixtures instantly and, thanks to react-query's structural
  sharing, hands back the same object — so it costs no re-render.

Fixtures are **plain data keyed by URL**, never JSX
(`app/harness/visual/slides-scenarios.tsx` is 1867 lines because its fixtures can
render), and layered widest-first: the shell's URLs are defaults, a scene's own
`fixtures` ref wins. Timestamps are fixed literals — a `Date.now()`-relative
fixture drifts between the two frames of a visual diff and turns every capture
into a false positive.

### 2.13 Selection: the frame, the outline, and the three outcomes

Clicking reaches only what is *painted*. A node behind a falsy conditional, an
empty-state branch, or one whose component swallows the stamped attribute because
it does not spread `{...props}` is invisible to a click and still needs editing.
So **`SceneOutline` is the complete list and the frame is the subset on screen**,
and rows the frame reported as reachable are marked — the two views stay honest
about the difference rather than pretending everything is clickable.

**Drill-in is a file switch, not a nested tree.** Expanding `<DocumentList/>`
inline would be a lie about where an edit lands: a class change inside it changes
every render site. Opening it is an explicit navigation with a breadcrumb and a
standing *"affects every render site"* warning, and the anchor it produces names
that file. A seamless merged tree is the interface that makes a global change feel
local.

`SceneNodeDetail` reports what `anchorFromStamp` returned, and the three outcomes
are **not** interchangeable:

| outcome | meaning | what the UI does |
|---|---|---|
| resolved | exactly one baseline node matches | show it; the `FloatingClassEditor` (CP3.5) hangs its editing controls here |
| ambiguous | several share the fingerprint | **refuse** and list candidates — guessing between two identical `<span>·</span>`s writes to the wrong one with no visible symptom |
| created | no baseline match, so a staged insert made it | route the edit through the parent insert's `raw`, per the CP2 client invariant |

The outline is built from BASELINE metadata while the frame's stamps are
PATCHED-frame paths. They agree exactly while nothing structural is staged and
can diverge once something is — nothing in CP3.4/CP3.5 stages a structural edit
yet, so this is correct today and is the specific thing to re-check once
insert/remove/move get UI-level controls.

**Repeated clicks cycle up the ancestor chain; Ctrl/Cmd+click bypasses it.**
`frame-picker.ts` treats picking as more than "select whatever `.closest()`
finds": clicking the same screen location again walks one step up the stamped
ancestor chain (`stampChainAt`, built by repeatedly calling `stampedAt` on
`el.parentElement`), so a designer who lands on a deeply nested `<span>` can
climb to the `<Card>` that contains it without switching to the outline. One
more click past the outermost ancestor deselects, and the click after that
restarts from the deepest node — the cycle wraps rather than dead-ending.
Ctrl/Cmd+click skips all of this and selects the deepest stamped node under the
cursor directly, for the case where the designer already knows exactly which
leaf they want and clicking through N ancestors would be pure friction. The
cycle position is keyed on the raw click target (`e.target === cycleTarget`);
it resets on a click at a new location and on a host-driven `wb:set-selection`
(e.g. the outline panel resolving a drill-in) — without the second reset, an
outline-driven selection would leave a stale cycle position that the next
in-frame click resumes from, landing on an ancestor the designer never asked
for.

---

## 3. Wiring guide — connecting the UI to the engine

1. **Health polling.** On mount, `pingBridge()` every 10s; store `bridgeUp`,
   `sessionId` and `fsRevision`. Show the header dot. Never poll `/mutate` with GET
   (405). The poll is also the external-change detector, so it is not optional
   (§6.6).
2. **Introspection.** When `bridgeUp` becomes true — **and after every commit,
   revert and re-apply** — call `fetchIntrospection()` and store it. Feed
   `bindings[theme]`, `colors`, `scales` and `themeMappings` into the panels. This
   refresh is not cosmetic: it is what makes a just-written value the new default
   (`design-editor-engine.md` §3.2). If it is `null` (bridge down), the editor falls
   back to computed CSS and says so.
3. **Staging.** Every UI edit calls `history.update()`, which pushes a snapshot.
   Nothing hits disk. Previews update via `tokenPreviewStyle` / `overrideClassName`
   / the forced-state classes.
4. **Review (dry-run).** On `⌘S` / "Save to Code", compute `saveDiff(baseline,
   state)` and `previewMutation()` each item. Render `diff` + `located`; distinguish
   `error` (bridge down) from `!located` (couldn't find the node).
5. **Apply.** On Approve, `commitMutations(plan)` — one batch, one undoable write.
   Surface `backup`, `regenerated` and `regenError` in toasts. On a transport
   `error`, stop, keep the modal open, show the banner.
6. **After the write.** `history.markSaved()`, clear the stale marks, re-fetch
   introspection, refresh the write log. Do **not** clear the edits.
7. **External changes.** Subscribe to `import.meta.hot.on('design-editor:fs-change')`
   and watch `fsRevision` from the poll. On a bump: re-fetch introspection, then
   `validateIntents(plan)` and mark the failures stale. Also validate quietly
   (debounced) whenever the plan changes — that is what tells the bridge which files
   to watch (§6.6).
8. **Candidates.** `registerCandidates()` for every class the preview composes at
   runtime (§2.10). Skipping this makes state/alpha editing look broken.

Client surface to reuse verbatim (`src/sandbox/mutate.ts`): `previewMutation`,
`applyMutation`, `commitMutations`, `undo`, `redo`, `fetchHistory`,
`fetchIntrospection`, `pingBridge`, `validateIntents`, `registerCandidates`, and
the `MutationIntent` / `MutateResponse` / `Introspection` / `TokenBinding` /
`PaletteColor` / `TokenFamily` / `BridgeHealth` types.

## 4. Metadata pipeline (what the left/right panes read)

- The component list + CVA/token bindings come from **AST metadata**
  (`DesignMetadata` in `types.ts`), produced by
  `scripts/extract-design-metadata.mjs` (TypeScript compiler API; no extra deps).
  It emits, per component: exported names, the wrapped `cva(...)` broken down
  **per variant value** (`axes → value → { classes, tokensUsed, colorBindings,
  scaleBindings, antiPatterns }`), and token/anti-pattern aggregates.
- `src/data/mock-metadata.ts` is the **SEED, not the source of truth**. It is real
  extractor output captured at build time, used for the first paint and as the
  bridge-offline fallback; with the bridge up, `GET /metadata` replaces it and is
  re-read after every write and every external change. The browser **never**
  re-parses source.
  *Held as module constants until CP3.5, which meant the binding panel's class
  strings silently described the file as it was when the sandbox was last built —
  the drift §6.6's "component source changed outside the sandbox" toast could warn
  about but never fix.*
- `SandboxLayout` flattens `metadata.files → components` and builds a
  component-name → source-file map so class-rewrite intents target the right
  file. Both are state. An empty payload is ignored rather than applied: a blank
  component list is indistinguishable in the UI from "this repo has no
  components", and a slightly-stale seed is the better failure.
- **Every refresh also re-points the staged layout anchors** (`planRebase` →
  `history.rebaseAnchors`). A `layout-insert` renumbers every following sibling,
  so anchors captured before a write describe the old tree; without the rebase the
  next save fails on all of them, and since a failed edit never reaches the
  baseline, the editor would stay dirty forever with a plan that can never
  succeed.
  - The lookup keys on the **anchor's own file**, not the scene's. An edit made
    through the outline's drill-in lives in the component's file while its scene
    is the page — resolving it against `scene.roots` would fail and report it
    lost, so *every* drill-in edit would go stale on the first commit.
  - Files that were drilled into are **re-fetched**, not dropped. Dropping is safe
    (the lookup returns null and the edit is skipped) but then a drill-in anchor is
    never rebased at all — the same bug, moved to save time.
  - **Unknown is not lost.** No tree for a file means skip, never "this edit can no
    longer be applied" — that verdict costs the user their work when it is wrong,
    and a genuinely dead anchor still fails at save time where the server can say
    so with authority.

---

## 5. Reuse checklist for a new repo

- [ ] Copy `packages/design-editor` (engine + UI). Keep it a private workspace pkg.
- [ ] Ensure `vite.config.ts` aliases `@ → ../frontend/src` and does **not** alias
      `@wafflebase/core`.
- [ ] Ensure `sandbox.css` has both the frontend `@import` and
      `@source "../../frontend/src"`.
- [ ] Register the `mutationBridge()` plugin (dev-only).
- [ ] Point the extractor at the target repo's shadcn/CVA components; regenerate
      metadata (or keep the static mock during bring-up).
- [ ] Confirm the core token pipeline exists (`palette.ts` → `semantic.ts` →
      `build-css.ts` → `tokens.css`) — the palette-aware features assume it.
- [ ] Smoke-test the protocol with the curl recipe in `design-editor-engine.md` §8.
- [ ] Read `design-editor-engine.md` §3.3b before adding a token family; the client's
- [ ] Wire `⌘S` / `⌘Z` / `⇧⌘Z` (and `⌘Y`), and `preventDefault()` on `⌘S` or the
- [ ] Keep `dark` / selected component OUT of the undo history.

---

## 6. The editor state model (undo/redo, dirty, persistence)

This is the part most likely to be got wrong, so it is specified in full.

### 6.1 Two histories at two altitudes

| | what it steps through | where it lives | UI |
|---|---|---|---|
| **Edit history** | individual edits | client (`history.ts`) | Undo/Redo buttons, `⌘Z` |
| **Write log** | whole saves | bridge, in-memory | "Writes to code" popover |

The write log came first and was originally wired to the header's Undo/Redo — which
is the wrong altitude for an editor: it could only step between *saves*, so making
five tweaks and pressing undo threw away all five. Both are kept, labelled
distinctly, and never share a control.

### 6.2 Snapshots, not a command log

`useEditHistory` holds `{ past: EditState[], present, future, baseline,
baselineStack }`. Every staged change pushes `present` onto `past` and clears
`future`; undo/redo move the pointer.

Snapshots rather than inverse commands because the whole edit state is a handful of
small plain-object maps: a snapshot is cheap, trivially serialisable (which is what
makes persistence a one-liner), and cannot drift from a hand-written inverse the
way a command log can.

Two details that matter in practice:
- **Coalescing.** `update(fn, coalesceKey)` collapses consecutive changes to the
  same control inside 700 ms into one entry, so dragging a colour picker or typing
  a hex is one undo step, not thirty. Discrete actions (comboboxes, chips, Add)
  pass no key.
- **No-op guard.** If the new state's structural key matches the present one,
  nothing is pushed — re-selecting the same value never pollutes the history.

### 6.3 Dirty / clean, and why a save does NOT clear the edits

`dirty = editStateKey(present) !== editStateKey(baseline)`, where `baseline` is
what the last save wrote. `editStateKey` is order-independent, so map insertion
order can never produce a false "unsaved".

**Approving a save sets `baseline = present`. It does not empty the maps.** This is
the crux of the requested behaviour:

```text
edit primary → red          past:[{}]  present:{red}  baseline:{}      → unsaved
Save to Code                                          baseline:{red}   → saved
⌘Z                          past:[]    present:{}     baseline:{red}   → unsaved  ← Save re-enables
Save to Code                → plan = revert primary to its captured old value
```

Clearing the maps on save would break the last two lines: `present` and `baseline`
would both be empty, the editor would look clean, and the write would be
unrecoverable from the UI. Keeping them is what lets `saveDiff` see "this edit was
in the baseline and is gone from the target" and emit an **inverse intent**.

Because intents are absolute writes ("set X to V") and never deltas, a revert needs
the previous value — which is why every pending edit captures one at staging time
(`oldValue`, `fromRef`/`fromValue`, or the `additions` it introduced). Inverses:

| edit | inverse |
|---|---|
| `token-value` / `palette-value` | write the captured `oldValue` |
| `token-rebind` | rebind to `fromRef`; if it was a literal, write `fromValue` as `token-value` |
| `class-rewrite` | swap `from`/`to`; `additions` ↔ `removals` |
| `member-add` | `member-remove` (drops the const member, emitter and alias) |

Reverts are ordered **before** applies in a batch, so undoing a token creation
cannot race an edit that references it.

The visible consequence in the panels: a staged edit outlives its own save, so
"edited" must mean *differs from source*, not *an edit object exists*. After a save
the row matches source and reads `in code` instead — otherwise every row you ever
touched would look dirty forever. Per-row reset drops the edit, which (if it had
been saved) makes the next save restore the pre-session value; the tooltip says so.

### 6.3a Layout edits: ordering IS the inverse

Point edits are absolute writes, so their inverses are order-independent. Tree
mutations are not: an op at child index *i* shifts every index `> i`, so a batch
of them only round-trips if it is ordered. All layout paths and indices are
expressed in the **baseline frame** — what is on disk, what
`design-metadata.json` describes.

| group | props | structural |
|---|---|---|
| `revert` (emitted first) | any order | **ascending** by the position the forward op targeted; at equal position `insert` before `remove` |
| `apply` | any order | **descending** by target position; at equal position `remove` before `insert` |

The asymmetry is the point: a revert group must undo the forward pass in **exact
reverse order**, so it mirrors the forward sort. Getting this backwards produces a
plan that looks right, writes cleanly, and leaves the file subtly wrong — with a
baseline child list `[a, s, g, s, D]`, a forward `remove@3 + insert@1` reverted
descending yields `[a, s, s, g, D]`. `scripts/smoke-layout.ts` asserts both
directions; `design-editor-engine.md` §8.1 check 9 proves the round-trip through
real writes.

Inverses, all of which need a "from" side captured at staging time:

| edit | inverse |
|---|---|
| `layout-props` `sets` | write each captured `from`; `from: null` removes the attribute |
| `layout-props` `classOps` | swap `from`/`to`; `additions` ↔ `removals` (identical to `class-rewrite`) |
| `layout-props` `text` | write `textFrom` |
| `layout-insert` | `layout-remove` anchored on the fingerprint the insert DECLARED its root would have |
| `layout-remove` | `layout-insert { raw: removedText, verbatim: true }` — the EXACT spliced-out span, which is what makes it byte-identical rather than merely equivalent |
| move | its remove + insert pair, same `groupId` |

Two client invariants keep the schema closed:

- **A node created this session has no baseline anchor.** Props edits and nested
  inserts on it mutate the parent insert's `raw` payload rather than becoming
  their own edits. So no intent ever references a node absent from disk, and
  there is no ordering relationship between an insert and edits to what it
  created.
- **An insert may not target a subtree another staged op removes** (the same
  guard as "cannot move a node into itself"), or the insert is silently moot and
  its inverse cannot locate.

### 6.3b `editStateKey` must ignore coordinate hints

`anchor.path` legitimately changes when metadata is regenerated after our own
write — an insert renumbers every following sibling. If it were part of the
edit's identity, **every commit would leave the editor spuriously dirty** and the
next save would emit a no-op plan that looks like real work. `editStateKey`
therefore strips `path` and `fpx` from `layoutEdits`.

The rule generalizes "keys matter" (§2.2): *an edit's identity is what it MEANS,
never where it currently happens to live.*

`history.rebaseAnchors(refs)` rewrites paths across the present, the baseline
**and** every stack snapshot — like `dropEdits`, and like it deliberately **not
undoable**, because a coordinate correction is not an edit. Feed it from
`anchors.ts#planRebase`, which re-resolves every staged anchor against fresh
metadata using the same path → `fpx` → `fp` → refuse steps the server uses;
anchors it cannot resolve go to the existing stale/discard path instead.

**`anchors.ts` is a MIRROR, and the server stays authoritative.** It exists
because a metadata refresh has to re-point every staged edit at once — asking the
bridge per edit would be a round-trip per edit on every write. It only moves
coordinates; it never decides whether a write is legal. So a disagreement costs a
`located: false` at save time, which the stale/discard path already handles,
rather than a wrong write. Worth re-checking after touching either side: with
every anchor's path deliberately perturbed so both sides fall through to the
fingerprint search, client and server agreed on all 84 nodes across the manifest
scenes.

### 6.4 Persistence: survives reload, resets on server shutdown

The whole shape is written to `localStorage` (`design-editor:edit-history:v1`)
together with the dev server's `sessionId` from `/health`:

- **reload** → same `sessionId` → restore, and show the `restored` pill.
- **dev-server restart** → new `sessionId` → drop the stack, clear the key, toast
  *"Dev server restarted — the persisted edit history was cleared"*.

Nothing is persisted server-side on purpose: a stack that outlived the files it
describes would be a corruption hazard, and the bridge's drift guard exists
precisely because on-disk state can move underneath you.

Two implementation details that are easy to get wrong:
- Hydration happens **synchronously during the first render** (a guarded
  `localStorage` read in a ref + `useState` initialiser), not in an effect. An
  effect would run in the same commit as the persist effect and write the still-empty
  state over the stored record before the restore landed.
- Restore is **optimistic** — it happens before the bridge answers, and reconciles
  when `sessionId` arrives. With the bridge down there is nothing to validate
  against, and losing the user's work is the worse failure. Edits made while the
  bridge is unreachable are persisted under the last known session id (or
  `unknown`), and dropped by the same reconcile if the server turns out to be new.

A full page reload is therefore survivable, which is what lets the engine fall back
to `{ type: 'full-reload' }` when it cannot find `tokens.css` in the module graph
(`design-editor-engine.md` §7.3).

### 6.5 Live update after a write

Staging shows through CSS-variable overrides (§2.8). After the write those
overrides are gone — the edit is real — so the page has to pick up the regenerated
`tokens.css`. That is the bridge's job (`design-editor-engine.md` §7.3: regenerate,
then `reloadModule` the stylesheet), and the client's job is only to re-fetch
introspection so the panels' defaults move with it. If regeneration fails, the
bridge says why and the modal toasts it rather than leaving you to guess why the
page didn't change.

### 6.6 When someone else edits the file (the sync model)

Every staged edit is an **absolute write that remembers what it expected to find**:
`{ from: "bg-primary", to: "bg-secondary" }`, or a token's `oldValue`. Change that
file in your code editor and the expectation is void.

**The wedge this creates, in order.** The AST locate fails → the save reports an
error for each affected edit → the failed edits never reach the baseline → `dirty`
stays true → every subsequent save retries the same impossible plan. Worse, the
edit is also still in `baseline` if it had been saved once, so the *next* plan tries
to **revert** it, and the revert needs the same vanished text. Nothing the user can
click from inside the editor fixes it. Detection alone does not help; there has to
be a way out.

**The model:**

| step | mechanism |
|---|---|
| detect | `fsRevision` from `/health` (+ an immediate `design-editor:fs-change` WS event). The bridge knows which bytes *it* wrote, so anything else is external — our own saves never trigger this. |
| resync | `refreshIntrospection()` — the same source-derived default refresh a save does (§6.5). |
| re-validate | `validateIntents(plan)` → per-item `located`. Runs the same composition a commit runs, so a `false` here is exactly what a save would hit. |
| mark | `staleKeys`, **derived** into `staleItems = plan.filter(…)` so fixing or undoing an edit clears its mark without extra bookkeeping. |
| recover | `history.dropEdits(refs)` |

**`dropEdits` is the load-bearing piece, and it is deliberately not undoable.** It
removes the edit from the present, the baseline, *and* every snapshot in the
undo/redo stacks:

- from the **present**, or it still shows as a pending change;
- from the **baseline**, or the next save tries to revert it and fails the same way;
- from the **stacks**, or `⌘Z` resurrects it.

It discards information (the old value we could have restored) that no longer
describes anything on disk, which is exactly why keeping it undoable would be a
lie. It never touches files — say so in the UI, because "discard" next to a
file-writing tool reads as destructive.

**Also validate quietly on every plan change** (debounced ~800 ms). Two jobs: it
keeps the stale marks honest as edits come and go, and reading a file is what puts
it in the bridge's watch set — so validating the plan is how the bridge learns which
component sources to watch in the first place.

**Closed in Phase 3 CP2.** This used to end "component metadata is a build-time
snapshot, so an externally-edited component leaves the panel's class strings
behind the source; the sandbox detects it but cannot refresh itself." It can now:
`GET /__design-editor/metadata` is re-read on every `design-editor:metadata-change`
push — which the bridge sends after its own writes AND after an external change —
and `history.rebaseAnchors` re-points the staged layout anchors (§6.3b).
`mock-metadata.ts` remains only as the bridge-offline fallback.

---

## 7. Verifying UI logic without a browser

Headless Chromium isn't available in this environment, but the parts most likely to
break are pure: `states.ts` (parsing, class rebuilding, forced states) and
`edits.ts#saveDiff` (apply / no-op / revert / ordering). Both are DOM-free, so they
can be driven directly:

```bash
pnpm --filter @wafflebase/core exec tsx <script.ts>   # workspace tsx, absolute imports
```

Assertions worth keeping in such a script (all verified for this revision):

- `parseColorClasses` splits `bg-primary` / `hover:bg-primary/90` correctly, keeps
  `dark:` as a non-state modifier, and ignores `shadow-xs` (not a token role).
- `buildColorClass` round-trips and drops `/100`.
- `forcedStateClasses` strips only the named state:
  `dark:hover:bg-input/50` → `dark:bg-input/50`; `disabled:opacity-50` → `opacity-50`.
- `computeColorReplacements` skips state tokens but keeps `dark:` ones.
- `saveDiff`: apply when new · **empty when clean** · revert to `oldValue` after
  undo-past-save · `member-remove` for an undone creation · `removals` for an
  undone state modifier · reverts ordered first.
- `editStateKey` is insertion-order independent.
- `opacityLabel(100) === 'no alpha'` and `buildColorClass(…, { opacity: 100 })`
  emits no modifier (§2.5).
- An **unset** state edit (`removals` only) reverts by re-adding that exact class,
  and `applyClassEdits` drops it from the previewed class string.
- **Every `PlanItem` carries `(map, key)`.** Without it a stale edit can be
  reported but never discarded — the wedge in §6.6. One staged edit may produce
  SEVERAL plan items sharing one ref (a move is a remove + insert pair); that is
  fine, because `dropEdits` takes refs.

Phase 3 adds committed scripts so these stop being ad-hoc:

```bash
pnpm --filter @wafflebase/design-editor smoke           # smoke-layout.ts + smoke-scene.ts
pnpm --filter @wafflebase/design-editor verify:bridge   # needs the dev server up
pnpm --filter @wafflebase/design-editor verify:frame    # needs the dev server up
```

`smoke-layout.ts` pins the ordering rule in both directions, the three inverses,
the `editStateKey`-ignores-hints property, and the persisted-schema migration.
`smoke-scene.ts` pins the CP3 logic: the `<file>#<root>:<path>` id round-trip
(two files contributing `Page:0.1` must not collide), drill-in path resolution,
fixture layering, and `anchorFromStamp`'s three outcomes — including the one that
matters most, *a stale patched-frame path still resolving via `fp` to the SOURCE
path*, which is the entire reason the stamp carries a fingerprint.
`verify-bridge.mjs` does the real writes and the whole module-graph half of the
renderer (checks 16–24).

Then verify the engine with the curl round-trips in `design-editor-engine.md` §8.1,
and the UI by hand in `pnpm --filter @wafflebase/design-editor dev`.

**What this cannot cover:** anything about whether something actually *paints*.
Whether a class paints is a Tailwind-generation question verified against a
running dev server (engine §8.1 check 8) — with a same-URL refetch, because a
cache-busted request passes even when the push is broken. Whether a *scene* paints
needs a browser. `verify:frame` is the closest proxy — it walks the frame's whole
import graph and asserts a 200 on each of ~1100 modules, and it is what caught
`apply-imported-content.ts` value-importing an engine package the sandbox could
not resolve. It cannot see a runtime throw, a missing fixture or a wrong layout,
so it is a floor, not a substitute.

**Two assertion traps, both hit for real:**

1. **Assert against the SERVED bytes, not the source you wrote.** Check 17
   matched `data-wb-node="…"`, the JSX form. What comes over the wire has been
   through `plugin-react` and reads `"data-wb-node": "…"`. The check therefore
   found zero ids and asserted "all 0 are valid" — passing, and meaning nothing.
   A count assertion (`ids.size > 0 && unknown.length === 0`) is what makes an
   empty match visible.
2. **`pkill -f design-editor` kills your own shell**, because the pattern matches the
   command line running it. Kill by pid from `pgrep -af "vite/bin"`.

---

## 8. Roadmap & living TODOs
Project roadmap (authoritative). Do **not** assume later phases exist; build them
when instructed.

| Phase | Scope |
|---|---|
| **1 & 2** | Design Editor Engine & Token Sandbox — the engine + this token/CVA/palette/state sandbox UI. **Complete.** |
| **2.5** | Robustness — external-change sync (§6.6) + runtime Tailwind candidates (§2.10). **Complete.** |
| **3** | **Layout Sandbox** — DOM & Canvas scene rendering and editing. CP2 (metadata + intents) and CP3 (the DOM renderer + editing inspector) complete; **CP4 (Canvas scenes) in progress**. |
| **4** | ~~**Agentic PR Pipeline** — converting approved AST diffs to Git commits and GitHub PRs.~~ **Withdrawn** by the local-plugin pivot — the plugin runs in the developer's own checkout and writes their working tree directly. |

### Phase 2 closeout — what this revision added

- **Per-section token creation** for all four families, including palette colours,
  with an inline focused draft row and auto-expand (§2.7). The unified
  `AddTokenPopover` is deleted.
- **Interaction states** (hover / active / focus / disabled) as editable rows in two
  tiers, plus a preview simulator that pins a state so it can be edited on screen
  (§2.3, §2.5).
- **Source-derived defaults** everywhere, so a saved value is recognised as the new
  default (§3 step 2); `edited` vs `in code` vs `no utility` badges.
- **Editor undo/redo** with coalescing, dirty/clean, inverse-intent saves and
  reload persistence (§6). The bridge's write log stays as a separate, clearly
  labelled control.
- **Reviewable reverts** in the approval modal (§2.9).

### Phase 2.5 closeout — what this revision added

- **External-change survival** (§6.6). Detect (`fsRevision`), resync, re-validate,
  mark stale, and — the part that actually matters — `dropEdits` as a way out.
  Before this, editing a file in your code editor left the editor permanently dirty
  with a plan that could never succeed and could not be cleared.
- **Runtime Tailwind candidate registration** (§2.10). The real cause of "alpha only
  works for `primary` at 90%": every other role/alpha combination had no CSS rule at
  all, because the class exists in no scanned file. Fixed by having Tailwind generate
  them, plus the module invalidation without which an open page keeps its old CSS.
- **An explicit "none" for interaction states**, and `no alpha` instead of `100%`
  (§2.5) — the missing way to *remove* a state colour rather than only re-point it.
- **`PlanItem` carries `(map, key)`**, making every planned write traceable to the
  staged edit that produced it.

### Remaining current-phase gaps

- ~~**Metadata is a static import**~~ — **closed in Phase 3 CP2.** The live tree
  comes from `GET /__design-editor/metadata` and is re-read after every write and
  every external change; `mock-metadata.ts` is now only the bridge-offline
  fallback. The `DesignMetadata` contract gained `scenes` and `revs`; nothing
  existing changed.
- **No automated browser test** wired in this environment (headless Chromium needs
  system libs). Cover pure logic per §7, the engine per `design-editor-engine.md` §8.1
  (`scripts/smoke-layout.ts` + `scripts/verify-bridge.mjs`), and check UI behaviour
  by hand in `pnpm --filter @wafflebase/design-editor dev`.
- **`AgentPopover.onSubmit` is a stub** (`console.log` + an inline "queued (stub —
  no edit applied yet)" confirmation) — the intended Phase 4 entry point.
- **State rows only edit the plain state modifier.** A `dark:hover:` variant is
  parsed and displayed, but "Define hover" always introduces an unprefixed
  `hover:` token; per-theme state authoring is not exposed.
- **Candidate registration covers the previewed component only.** Classes are
  registered for the component currently on screen; a staged edit to a component you
  then navigate away from is not pre-registered. Harmless in practice (the preview is
  where classes are painted) but it is a scoping choice, not completeness. In
  scenes mode the frame reports its own rendered classes over `wb:classes`, so
  the same scoping applies per scene.
- ~~**Two CP2 defects still open.**~~ **Closed in CP3.5.** `edits.ts` now applies
  the `HINT_KEYS` replacer to all six maps rather than only `layoutEdits` (§6.3b).
  `PendingLayoutEdit.key` turned out to already be correct: it folds in
  `anchor.file` and deliberately excludes `sceneId` — two scenes drilling into
  the same underlying file must land on the SAME edit, since it is a change to
  one physical file and `SceneOutline`'s own "affects every render site" warning
  already says so. Keying by `sceneId` would let two scenes stage two
  independently-committable edits to one node with no conflict signal. An
  earlier revision of this document mischaracterized this as an open collision;
  it was not.
- ~~**HMR state preservation is not implemented.**~~ **Closed in CP3.5**
  (`scenes/hmr-state.ts`). The active element's nearest `data-wb-fp` (not the DOM
  node — Fast Refresh preserves hook state but not DOM identity), its text
  selection offsets, every scrolled stamped container's offset, and the
  page-level scroll are captured on `vite:beforeUpdate` and restored on
  `vite:afterUpdate` (one `requestAnimationFrame` later, so React's own
  re-render has actually committed). Open dropdowns and live tooltips remain
  explicitly out of scope — portaled, transient, no stable identity to re-anchor
  on.
- **The outline's drill-in assumes `.tsx`.** `resolveImport` cannot stat the
  filesystem, and a JSX-returning component is a `.tsx` by definition, so a wrong
  guess costs one named 404 rather than a wrong anchor. It cannot resolve an
  import that goes through a barrel file.
- **Deferred Phase 4 polish, explicitly not done:** resizable splitter between
  preview and panel, auto-sort/scroll to a newly added token, custom-vs-palette
  picker when creating a colour, auto-closing an empty draft row on blur, unifying a
  newly added token's row with the normal editable row, per-state accordions, and
  design export.

### Phase 3 — Layout Sandbox (in progress)

Extend the sandbox from single-component token editing to **DOM & Canvas-based UI
rendering and editing**: whole route files, not just tokens on one primitive.

**CP2 — metadata + intents (complete, no UI).** `design-metadata.json` +
`GET /metadata`; three layout intent kinds anchored on a `NodeAnchor`; atomic
intent groups; `POST /preview-tokens`; the asymmetric ordering rule and its
inverses (§6.3a); `editStateKey` ignoring coordinate hints (§6.3b);
`anchors.ts` + `history.rebaseAnchors`. Proven headlessly — see §7.

**CP3.1–3.4 — the DOM scene renderer (complete).** `scene.html` +
`src/scene-entry.tsx` as a second Vite entry so each frame gets **its own module
realm** (§2.11); the `?wbFrame=` patched-module plugin + `POST /scene-preview`;
`SceneProviders` with real providers, URL-keyed fixtures and the `fetch`
kill-switch (§2.12); `shell: "app"`; the `data-wb-node` / `data-wb-fp` /
`data-wb-file` stamping transform; click-to-select, the outline and drill-in
(§2.13); the viewport toggle; token edits reaching the frame.

**CP3.5 — the editing inspector (complete).** Shipped as a superset of the
original scope:

- **`FloatingClassEditor.tsx`** — a Figma-style panel anchored to the selected
  node in HOST-page pixels, with closed-enumeration quick controls
  (direction/align/justify/gap/size) plus a raw class-chip list as the escape
  hatch for anything a preset doesn't cover, and a **draggable header** so the
  panel can be moved out of the way. The drag offset is added on top of the
  anchor position and resets only on a genuinely new selection (keyed on the
  stamp id), never on a `hostRect` update from scroll/zoom to the SAME node.
  Now also opens on a node with no `className` attribute at all — starting
  empty rather than staying hidden, since that case was previously
  indistinguishable client-side from "dynamic expression, unsupported by
  design" and disproportionately hit thin wrapper components used as `.map()`
  row roots. `applyLayoutProps` creates the attribute on first edit; the
  genuinely-dynamic case (`cn(...)`) remains read-only, to avoid clobbering
  real logic.
- **Figma-style click-to-cycle selection** (`frame-picker.ts`). Repeated clicks
  at one screen location walk up the stamped ancestor chain one step per click,
  wrapping past the outermost node into a deselect and back to the deepest node
  on the next click. Ctrl/Cmd+click bypasses the cycle entirely and selects the
  deepest stamped node under the cursor directly. The cycle resets on a new
  click location and on a host-driven `wb:set-selection` (e.g. the outline
  panel), so a stale cycle position can't resume against a selection the user
  didn't click into.
- **The Mock Data toggle** — reload the current scene with every fixture array
  recursively emptied to `[]` (§2.11 below), to check a list/table's empty
  state without a hand-authored "empty" fixture per scene.
- **HMR state preservation** in the frame (`scenes/hmr-state.ts`) — focus, text
  selection and scroll survive a Fast Refresh patch. Frame-internal plumbing
  rather than a UI surface, so it's documented in full in
  `design-editor-engine.md` §7.12 rather than here.
- **The two CP2 hardening items** listed under "Remaining current-phase gaps"
  above, closed.
- **A real bug, found and fixed alongside this work**: four workspace-scoped
  scenes (Documents, Data Sources, Analytics, Settings) were silently rendering
  with no data — `scenes.config.json`'s `route` was reused as both the
  `MemoryRouter` location and the literal `<Route path>` PATTERN, so
  `useParams<{ workspaceId }>()` always resolved `undefined` and
  `enabled: !!workspaceId` disabled every query with no visible error. Fixed
  with a separate `routePattern` manifest field (`design-editor-engine.md` closeout
  has the full trace).

**CP4 — Canvas scenes (in progress).** The real Sheets / Docs / Slides / Notes
engines mounted in a scene frame. Four things about it are worth knowing from
the UI side; the engine-side detail is in `design-editor-engine.md` §9, and the
checklist in `docs/tasks/active/20260729-design-editor-layout-sandbox-todo.md`.

- **Not `Mem*Store` fixtures**, which is what an earlier revision of this line
  said. The canvas pages build their own `YorkieStore` / `YorkieDocStore` /
  `YorkieSlidesStore` from `doc`, so swapping in a `MemStore` would need a new
  prop on a frontend component. A detached Yorkie document turns out to be fully
  functional offline — only the `Client` touches the network — so the sandbox
  seeds the DOCUMENT and lets the real store, calculator and renderer run. More
  faithful, and zero frontend changes.
- **Editable, not read-only.** The manifest's `readOnly: true` documents that
  nothing persists, not that the scene is inert. Typing in a cell is how the
  active cell editor's look gets judged, and an offline document cannot reach a
  server. Presence is the one casualty: it does not stick on a detached
  document, so peer avatars render empty.
- **Clicking inside a canvas needs its own answer.** The engines build their DOM
  imperatively, so nothing inside the engine region is stamped and a click
  resolves to the container `<div>` — one giant node. `frame-picker.ts` gains a
  probe registry that hands the click to the engine's own hit-test instead, and
  since a canvas hit has no `className`, `FloatingClassEditor` switches to the
  theme keys that painted the object. Those are edited through the
  `palette-value` / `token-value` intents that already exist, so this is a new
  READ path over the existing WRITE path.
- **Token previews reach a canvas over a second channel.** `wb:set-token-vars`
  sets CSS variables, which a canvas cannot see — the engine themes read
  `palette` into plain objects at module-eval. `wb:set-canvas-theme` carries the
  same `/preview-tokens` delta as a theme-object patch. Same source of truth,
  two render targets, exactly as §3.8 always claimed.

Then **CP5**, the diff engine — which is where two live canvas frames stop being
a leak warning (§2.11's "one live frame") and become a real memory and GPU
constraint.

Decisions worth carrying, because each was reached by rejecting the obvious
answer:

- **Layout edits preview through a PATCHED MODULE, not an override channel.**
  You cannot thread a `className` override into an arbitrary nested JSX node, and
  materializing a `layout-insert` in the browser would mean compiling JSX
  client-side. The frame imports the scene through a module whose content is the
  patched source `composeIntents` computes — so what renders is exactly the bytes
  a commit writes.
- **…but its id is a REAL PATH + a query, not `virtual:`.** The original plan said
  `virtual:wb-scene?id=…`. `@vitejs/plugin-react` filters on `id.split("?")[0]`
  against `/\.[tj]sx?$/`, so a virtual id gets no JSX transform and no fast
  refresh, and has no directory for a relative import to resolve against. Engine
  §7.8.
- **Each frame is a real Vite entry, not `about:blank` + `createRoot`.** The
  latter is one JS realm and two documents, so every module instance is shared —
  and `docs/src/view/theme.ts` keeps `let activeTheme` behind a `Proxy`, while
  `LightTheme`/`DarkTheme` are shared mutable objects. A dual-frame visual diff
  would have shown identical colours on both sides.
- **Fixtures substitute at `fetch`, not at `queryFn`.** Every scene passes its own
  `queryFn`, so a client-level default is never consulted and key-based fixtures
  would have resolved nothing on all four call sites. Substituting lower keeps
  `fetchWithAuth`'s real 401 branch in the code path — which matters, because an
  unmocked request does not merely 401: `fetchWithAuth` answers a 401 with
  `logout()` → `redirectTo("/login")`, i.e. `window.location.href`, which
  navigates the frame off `scene.html` and looks exactly like a broken scene.
- **A scene is mounted in the shell it really renders in.** Everything except
  `/login` is an `<Outlet/>` body under `<Route element={<Layout/>}>`; rendered
  bare it is a padded box in an empty viewport and every judgement about width,
  gutters and the header relationship is made against the wrong container.
- **Structural reordering is click-and-form editing only — no drag-and-drop.**
  The preview round-trip is 100–300 ms: fine for a discrete edit, unusable as a
  gesture loop for MOVING A NODE (which would need to stage a `layout-move` on
  every frame of the drag to preview live). This is unrelated to, and not
  contradicted by, the drag affordances CP3.5 did ship: the viewport's freeform
  resize handles (§2.11) and the floating class editor's draggable header (§2.11)
  reposition or resize UI chrome and preview panels — neither stages a
  `MutationIntent` on every pointer move, so neither hits the round-trip cost
  this bullet is about. When node reordering is taken up, the gesture is
  optimistic DOM transforms inside the frame and the drop stages one discrete
  `layout-move`; the intent schema already supports it.

Deferred, and deliberately: structural ops inside an inline `.map(x => …)` body
(`layout-props` only there — extract the row into a component or a `renderRow`
helper, which then has its own static root and full support); making one `.map()`
instance differ from its siblings; moving a node between component files;
extracting a subtree into a new component.

Also deferred here: prop-level editing (toggling text/icons in a component,
bounding-box overlay).

### Phase 4 — Agentic PR pipeline (withdrawn)

**Withdrawn by the local-plugin pivot**
(`design-editor-local-plugin.md`); see `design-editor-engine.md` §"Phase 4" for
the full reasoning. As a local Vite plugin the editor already runs inside the
developer's own checkout and writes their working tree, so the commit the
pipeline would have opened a PR for is one they can make directly.

- ~~Batch approved intents → Git branch + commit(s) (message synthesised from the
  intent labels) + a GitHub PR via `gh`/API, instead of / alongside the direct
  working-tree write.~~ Withdrawn. The engine's per-intent diffs, backups, and
  transaction log remain — they are what the working-tree write is built on.
- `AgentPopover.onSubmit` is **not** withdrawn: it remains the entry point for
  agent-authored, natural-language → intent flows, which never depended on the
  PR pipeline.
