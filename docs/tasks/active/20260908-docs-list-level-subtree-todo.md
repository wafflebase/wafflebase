# Docs: changing a list item's level carries its nested children

Issue: [#1050](https://github.com/wafflebase/wafflebase/issues/1050)
Design note: [docs/docs.md § Changing a list level carries the subtree](../../design/docs/docs.md)

## Problem

Every list-level entry point walks only the blocks the selection covers, so a
parent demoted by one level lands on the same level as its own children and the
hierarchy is destroyed:

- Tab / Shift+Tab — `packages/docs/src/view/text-editor.ts` `handleTab`
- Cmd+] / Cmd+[ — `text-editor.ts` `handleIndent` / `handleOutdent`
- toolbar indent / outdent — `packages/docs/src/view/editor.ts`
- the same pair in `packages/docs/src/view/text-box-editor.ts` (Slides / Board)

## Decisions (the four boundary cases from the issue)

"Child" = the following contiguous run of `list-item` blocks whose `listLevel`
is strictly greater than the item's own, stopping at the first block that is
not a list item or is at the same-or-shallower level. This is the rule Word and
Google Docs use to *render* the hierarchy, and the only one the flat
`listLevel` model can express.

1. **Outdent** — yes, symmetric: decreasing a parent's level pulls its whole
   subtree up by one, preserving relative depth.
2. **Floor** — a parent already at level 0 cannot outdent, so the gesture is a
   no-op for that subtree; the children do **not** move on their own (that
   would flatten them into siblings of the parent — the very symptom).
3. **Multi-block selection** — a selected block that is already covered by an
   earlier selected item's subtree is skipped, so each child moves exactly
   once. A subtree whose root was refused by a boundary also suppresses its
   selected descendants, for the reason in (2).
4. **Ceiling** — `MAX_LIST_LEVEL` (8) refuses the whole subtree when its
   *deepest* member is already at the ceiling. Clamping only the child would
   collapse the parent onto it and reproduce the bug; refusing keeps the one
   invariant this change is about — relative depth is preserved, or nothing
   moves.

Non-list blocks in the selection keep their existing `marginLeft ± 36`
behavior, untouched by the subtree rule.

## Plan

- [x] `packages/docs/src/model/list-level.ts` — pure `planListLevelChanges()`
      over a `(block, siblings)` iterator; returns the block → new level plan
      for the whole gesture, computed before anything is written.
- [x] Thread the containing sibling array through the three
      `forEachBlockInSelection` implementations (`(block, siblings) => void`).
- [x] Route all four entry points (6 handlers) through the plan.
- [x] Unit tests: parent+children Tab/Shift+Tab, floor, ceiling, multi-block
      dedupe, non-list-item boundary, text-box editor.
- [x] Record the rule in `docs/design/docs/docs.md`.

## Out of scope

- Auto-normalizing levels that are already broken (a level-3 item under a
  level-0 one).
- Enter/Backspace/paste level behavior.
- OOXML `w:ilvl` model change — hierarchy stays implied by adjacency.
