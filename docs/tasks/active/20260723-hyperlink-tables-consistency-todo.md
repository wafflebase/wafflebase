# Hyperlink handling — unify & fix across Docs / Slides, focus on tables

## Context

Follow-up to PR #520 (issue #495), which fixed "hyperlink formatting
stays active after Enter / Space / paste at a link's trailing edge" —
but **only** for the full Docs document editor. #520 explicitly deferred
two surfaces (see its todo,
[20260722-docs-hyperlink-formatting-exit-todo.md](20260722-docs-hyperlink-formatting-exit-todo.md)):
Slides text boxes, and (implicitly) every other consumer of the shared
`initializeTextBox` factory.

This branch closes the gap on three link surfaces so the experience is
consistent everywhere the shared docs rich-text engine renders:

1. **Slides text boxes** — the #520 trailing-edge fix is wired but inert
   there.
2. **Docs tables** — links are not auto-recognized inside table cells
   (and the trailing-edge fix should be confirmed functional there).
3. **Slides tables** — links *are* recognized in cells, but the
   trailing-edge bug still occurs.

### Root-cause map (from repo research)

- `href` is just an `InlineStyle` field on a text run. The trailing-edge
  fix `TextEditor.exitLinkIfAtTrailingEdge` (`packages/docs/src/view/text-editor.ts`,
  added in #520) arms the view-local **pending-style controller**
  (`pending-style.ts`) with `href: undefined`. It is a **silent no-op
  unless the host calls `TextEditor.setPendingStyle(...)`.**
- The full Docs editor wires it (`editor.ts:899` `createPendingStyle`,
  `editor.ts:2025` `setPendingStyle`). The shared **`initializeTextBox`**
  factory (`packages/docs/src/view/text-box-editor.ts`) — which powers
  **both** Slides text boxes **and** Slides table cells — never did.
  Confirmed single funnel: Slides `enterEditMode` → `mountSlidesTextBox`
  (`packages/slides/src/view/editor/text-box-editor.ts`) → one
  `initializeTextBox()` call → one `new TextEditor(...)`. So wiring
  `setPendingStyle` **once** in `initializeTextBox` fixes items **1 and 3
  together** (no separate table-cell call site exists).
- Auto-link detection (`tryAutoLinkBeforeCursor`) does **not** depend on
  `pending`, so it already works in Slides (both surfaces) and in Docs
  table cells **on Space**. The Docs-table gap is specifically the
  **Enter** path: `handleEnter`'s table-cell branch returns early and
  never calls `tryAutoLinkBeforeCursor` (unlike the top-level branch,
  which does). It *does* already call `exitLinkIfAtTrailingEdge`, so the
  Docs-table **trailing-edge** behavior already works (pending is wired
  in the full editor) — only auto-link-on-Enter was missing.
- Manual `insertLink` (toolbar / Cmd+K) in the full Docs editor
  (`editor.ts`) was written without table-cell awareness, unlike its
  siblings `applyStyleImpl` / `removeLink` (which branch on
  `range.tableCellRange` and normalize dirty-marking via
  `blockParentMap` → `tableBlockId`). Its selection branch used
  `getBlockIndex` (top-level-only → `-1` for cell blocks) and ignored
  `tableCellRange` (a whole-cell-range selection would over-apply `href`
  to the entire table via the fallback bulk path).

## Work

- [x] **Item 1+3 — Slides text boxes & tables**: wire pending into the
  shared factory. In `packages/docs/src/view/text-box-editor.ts`: import
  `createPendingStyle`, construct `const pending = createPendingStyle(doc)`,
  and call `textEditor.setPendingStyle(pending)` right after
  `setCursorTarget`. One change fixes both Slides text boxes and Slides
  table cells (shared `initializeTextBox` construction site).
- [x] **Item 2a — Docs table auto-link on Enter**: add
  `this.tryAutoLinkBeforeCursor(pos.blockId, pos.offset)` inside
  `handleEnter`'s `if (enterCellInfo)` branch
  (`packages/docs/src/view/text-editor.ts`), mirroring the existing
  top-level branch (before the existing `exitLinkIfAtTrailingEdge` call).
- [x] **Item 2b — Docs manual `insertLink` table awareness**: rewrite
  `insertLink` in `packages/docs/src/view/editor.ts` to follow the
  `applyStyleImpl` / `removeLink` idiom — selection branch checks
  `range.tableCellRange` first (route through `applyStyleToCellRange`),
  else normalize dirty-marking via `blockParentMap` → `tableBlockId`
  before the top-level `getBlockIndex` fallback; no-selection branch
  marks `cellInfo.tableBlockId` when the caret block is a cell block.
- [x] Confirmed Docs-table trailing-edge already works (pending wired in
  full editor; `handleEnter` cell branch already calls
  `exitLinkIfAtTrailingEdge`) — covered by a regression test, no code
  change needed.

## Tests

- [x] `test/view/text-box-link-trailing-edge.test.ts` (new) — drives the
  `initializeTextBox` path (Slides text boxes **and** table cells share
  it), reading committed blocks via `onCommit`. **3/3 green.**
  - space right after `insertLink` does not extend the link
  - text typed after that space stays plain
  - Enter right after `insertLink` starts a plain new paragraph
- [x] `test/view/table-link.test.ts` (new) — full Docs editor with a
  table block (`createTableBlock`), cursor in a cell. **4/4 green.**
  - typing a URL + **Enter** in a cell auto-links it (regression for the
    `handleEnter` cell-branch fix — fails before, passes after)
  - typing a URL + **Space** in a cell auto-links it (guard: this path
    already worked; lock it in)
  - trailing-edge exit works in a cell (Enter after a link → plain new
    block) — confirms Docs-table trailing edge
  - manual `insertLink` at a collapsed caret links only the target cell,
    not other cells (exercises the `blockParentMap`→`tableBlockId`
    dirty-marking path). Whole-cell `tableCellRange` over-application is
    covered by parity with `applyStyleImpl` (shared
    `applyStyleToCellRange`) + CI — `_setSelectionForTest` can't set
    `tableCellRange`, so it's not unit-synthesizable here.
- [x] `@wafflebase/docs` typecheck clean + both new test files green
  (run individually — WSL/`/mnt/c` env can't run full parallel vitest,
  needs a bumped worker-start timeout even per-file; see lessons).
- [x] `@wafflebase/slides` typecheck clean; Slides tests defer to CI
  (same vitest-on-WSL constraint; no Slides *source* changed, only the
  shared docs factory it consumes).

## Self-review

- [x] Dispatch a code-review pass over the full branch diff before push.
  No blocking issues. Non-blocking (accepted as known limitations):
  - `table-link.test.ts` in-cell-selection test does not strictly
    fail-before (`Doc.applyInlineStyle` is already cell-aware via its own
    `_blockParentMap`); what the fix changed for that path is
    dirty-marking/repaint + `notifyStyleApplied` + `setCursorForHistory`,
    which isn't directly asserted.
  - The #523-mirroring `setCursorForHistory`/`notifyStyleApplied` calls
    added to `insertLink`'s selection branch have no direct coverage;
    `tableCellRange` over-application also not unit-synthesizable via
    `_setSelectionForTest`.

## Follow-up (out of scope for this branch)

- **Slides non-edit / presentation link rendering.** In a Slides text
  box / cell, `href` runs are styled + Ctrl/Cmd+Click-openable only while
  *editing* (shared docs `paint-layout.ts` + `TextEditor` mousedown). The
  normal-view / thumbnail / presentation painter
  (`packages/slides/src/view/canvas/text-renderer.ts`) has no `href`
  concept — links render as plain dead text once you click away. Needs
  new render + hit-test code; distinct feature.
- **Slides manual link insertion.** `onLinkRequest` is intentionally
  unwired in `packages/frontend/src/app/slides/slides-view.tsx` — Cmd+K
  no-ops, so the only way a Slides run gets `href` today is typed
  auto-detect or paste/import. Needs a link popover + richer
  `TextBoxEditorAPI` exposure.
- **Sheets hyperlinks.** No `href` concept in the Sheets model at all;
  `HYPERLINK()` returns its label as plain text; xlsx hyperlink import is
  deferred. Clickable/formatted Sheets links = a from-scratch feature
  needing its own design doc.
