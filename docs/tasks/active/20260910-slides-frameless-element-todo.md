# Slides: a structurally incomplete element blanks the whole deck

Reported: a `/shared/:token` slides link intermittently fails with a script
error and renders nothing. (The reporting link is a live anonymous
credential, so it is not recorded here — it is in the issue thread.)

    yorkie-slides-store-*.js  Uncaught TypeError:
      Cannot read properties of undefined (reading 'blocks')

## What was measured

Read the deck through `GET /api/v1/workspaces/:wid/documents/:did/content`
and walked every element. Exactly one is malformed:

| slide | layout | element | keys |
| --- | --- | --- | --- |
| `slides[4]` | `caption` | `e4f7414b` (`text`) | `data`, `id`, `placeholderRef`, `type` |

`frame` is absent. Every other element on the other eight slides carries
`data` / `frame` / `id` / `type`, and every `layouts[].placeholders[]` entry
carries a `frame` — so the layout the slide points at is not the source.

Six page loads produced **two different** crashes, never a clean render:

| error | site |
| --- | --- |
| `… (reading 'blocks')` | `yorkie-slides-store.ts:291` — `ensureSlidesRoot`, `el.data.blocks` |
| `… (reading 'flipH')` | `packages/slides/src/view/canvas/element-renderer.ts:180` — `const ownFlipH = !!frame.flipH` |

Which one fires depends on whether the initial Yorkie snapshot has landed
before the mount effect runs: arrived → `ensureSlidesRoot` walks the slides
and throws first; not yet → `r.slides` is empty, the walk is a no-op, and the
first canvas paint throws instead. That race is the whole of the reported
"intermittent" — the deck is broken on every load, only the message varies.

There is **no `ErrorBoundary` anywhere in `packages/frontend`** (`grep` finds
zero `componentDidCatch` / `getDerivedStateFromError`), so either throw
unmounts the React tree and leaves an empty `#root`.

## Provenance: narrowed, not proven

- `PUT /api/v1/.../content` is **not** the source. `assertValidElement`
  (`docs-content.controller.ts:690`) has rejected a frameless top-level
  element with a 400 since that route landed (`571bce502`, 2026-05-16).
- No frontend write path can produce it: `addSlide` (`:703`), `addElement`
  (`:1311`), `applyLayoutToSlide` (`layout.ts:408`, `:456`) and
  `MemSlidesStore.addSlide` (`memory.ts:214`) all take `frame` from a layout
  placeholder spec, and `unwrapElement` is a faithful `toJSON` round-trip.
- Not a PPTX import either: `meta` carries no `pxPerPt` / `unit`, the themes
  and layouts are built-ins.

So how this specific element lost its `frame` is **undetermined**. What is
determined is that the readers crash on it, that nothing repairs it, and that
`DocumentCopyService` / template-use / revision-restore all propagate it
verbatim. This task fixes the readers and makes the deck self-heal; it does
not add speculative write-side validation for a writer we cannot name.

## Plan

Two invariants, applied where they belong:

1. **A reader never crashes on a structurally incomplete element.**
2. **An editor session repairs one rather than leaving it to the next reader.**

- [x] Tests first (`packages/frontend/tests/app/slides/yorkie-slides-store.test.ts`)
      — `ensureSlidesRoot` on a deck holding a frameless text element and on
      one holding a data-less text element
- [x] `ensureSlidesRoot` (`yorkie-slides-store.ts:288`) — guard `el.data`
      so the `blocks` repair can reach the shape that needed it, and
      restore a missing `frame` from the slide layout's matching placeholder
      (`placeholderRef`), falling back to a zero frame when nothing resolves.
      This is what permanently fixes the reported document: the caption body
      returns to its designed position, text intact.
- [x] `readElement` (`:482`) — one frame fallback across its four return
      sites, so a read-only share-link viewer (whose repair write the Yorkie
      auth webhook may deny) still renders the rest of the deck
- [x] `cascadeMasterStyles` (`:1072`) — same `el.data` guard; it is the next
      unguarded deref after line 291
- [x] `isElementEmpty` (`packages/slides/src/model/element.ts:640`) — guard
      `data.blocks`; `applyLayoutToSlide` calls it on every layout change
- [x] `element-renderer.ts:175` — skip an element with no usable frame
      instead of throwing (covers `MemSlidesStore` and the revision-preview
      path, which do not go through `readElement`)
- [x] `packages/cli/src/slides/content.ts:164` — guard `el.data`
- [x] `pnpm verify:fast`
- [x] Code review over the branch diff
- [ ] PR

## Review outcomes folded in

Branch review (CLAUDE.md adherence / bug scan / git-history + comments)
surfaced four things worth acting on:

- **Connectors must not be repaired.** Their `frame` is a derived selection
  bbox `computeConnectorFrame` rebuilds from the endpoints, and they never
  carry a `placeholderRef` — so `recoverFrame` could only persist
  `ZERO_FRAME`, which is what the read fallback already supplies. The write
  would buy nothing and make a wrong bbox look authoritative to
  `combinedBoundingBox` (align / distribute / multi-select).
- **`hasFrame` needed more than object-ness.** `{}` and `{ x: 10 }` pass a
  `typeof` check and then feed `undefined` into `frame.x + frame.w / 2`.
  Now all of `x`/`y`/`w`/`h` must be finite — but *not* `rotation`, since
  demanding it would replace real geometry with a zero frame.
- **The `blocks` repair was a wholesale replace.** `el.data = { blocks: [] }`
  drops `autofit` / `verticalAnchor` / `fill` — the same drop
  `withTextElement` was reviewed and fixed for in #263, and the wholesale-LWW
  op `withShapeText` argues against. Now seeded in place, matching
  `cascadeMasterStyles`.
- **Exempting connectors from the renderer guard left one live throw.** The
  animation wrapper takes its transform centre from `element.frame` for every
  type, so a frameless *and* animated connector still died. It now paints
  un-animated.

Two more were raised and deliberately not acted on:

- **Group children are not healed in the document.** The repair walks
  top-level `slide.elements` only. Recursing buys nothing: a group child
  never carries a `placeholderRef`, so the repair value would be `ZERO_FRAME`
  — byte-identical to what `readFrame` already returns on every read. The
  element is non-fatal either way.
- **The backend still rejects on write what it repairs for `data`.**
  `assertValidElement` 400s a frameless top-level element while #1022 taught
  its sibling `assertValidElementData` to repair a missing `data` in place.
  So a CLI `GET` → edit → `PUT` round-trip of the reported deck still fails
  until a frontend session heals it. Closing that asymmetry means deciding
  what geometry a server-side repair should invent, which is its own change.

## Deliberately out of scope

- **A React `ErrorBoundary`.** A blank page for any uncaught render throw is
  a real gap, but it is an app-wide decision about where boundaries sit and
  what they show — not this bug. Filed as follow-up.
- **Write-side validation for nested elements.** `assertValidNestedElement`
  skips `id`/`type`/`frame` deliberately and documents why (a `GET` → edit →
  `PUT` round-trip of an existing deck would start 400-ing). Tightening it
  needs its own migration story.

## Review

_(filled in when the branch is done)_
