# Slides: a structurally incomplete element blanks the whole deck

Reported: a shared slides link intermittently fails with a script error and
renders nothing.

    https://wafflebase.io/shared/eec87355-3adf-426a-81f8-b08eb5d7a23a

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

- [ ] Tests first (`packages/frontend/tests/app/slides/yorkie-slides-store.test.ts`)
      — `ensureSlidesRoot` on a deck holding a frameless text element and on
      one holding a data-less text element
- [ ] `ensureSlidesRoot` (`yorkie-slides-store.ts:288`) — guard `el.data`
      so it falls into the existing `el.data = { blocks: [] }` repair, and
      restore a missing `frame` from the slide layout's matching placeholder
      (`placeholderRef`), falling back to a zero frame when nothing resolves.
      This is what permanently fixes the reported document: the caption body
      returns to its designed position, text intact.
- [ ] `readElement` (`:482`) — one frame fallback across its four return
      sites, so a read-only share-link viewer (whose repair write the Yorkie
      auth webhook may deny) still renders the rest of the deck
- [ ] `cascadeMasterStyles` (`:1072`) — same `el.data` guard; it is the next
      unguarded deref after line 291
- [ ] `isElementEmpty` (`packages/slides/src/model/element.ts:640`) — guard
      `data.blocks`; `applyLayoutToSlide` calls it on every layout change
- [ ] `element-renderer.ts:175` — skip an element with no usable frame
      instead of throwing (covers `MemSlidesStore` and the revision-preview
      path, which do not go through `readElement`)
- [ ] `packages/cli/src/slides/content.ts:164` — guard `el.data`
- [ ] `pnpm verify:fast`
- [ ] Code review over the branch diff
- [ ] PR

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
