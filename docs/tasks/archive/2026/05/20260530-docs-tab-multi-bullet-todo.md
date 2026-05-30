# Docs — Tab/Shift+Tab on Multi-Bullet Selection

## Bug

Selecting multiple bullet (list-item) paragraphs in Docs and pressing
**Tab** / **Shift+Tab** only changes the indent (`listLevel`) of the
single paragraph the cursor is on. Cmd+] / Cmd+[ correctly indents the
whole selection.

## Root Cause

`packages/docs/src/view/text-editor.ts:1733-1760` — `handleTab(shift)`
reads `this.cursor.position.blockId` and mutates only that one block,
ignoring the selection range. The Cmd+]/Cmd+[ path goes through
`handleIndent`/`handleOutdent` (line 1786, 1808) which use
`forEachBlockInSelection` (line 1835) and so cover the whole range.

The same constants and per-block logic are duplicated in three places
already (handleTab, handleIndent, handleOutdent — plus a parallel pair
in `editor.ts`); we won't unify them here (out of scope), but we will
fix `handleTab` to iterate the selection the same way.

## Plan

- [x] Add a vitest case under `packages/docs/test/view/` that:
      - mounts the editor with two `list-item` blocks (both `listLevel: 0`)
      - sets selection spanning both blocks via `_setSelectionForTest`
      - dispatches a `Tab` keydown on the editor's hidden textarea
      - asserts BOTH blocks have `listLevel === 1`
      - also covers Shift+Tab on blocks at `listLevel: 1` → both go to 0
- [x] Update `handleTab` to iterate `forEachBlockInSelection`, applying
      the same min/max clamp (0..8) per list-item block. Preserve:
      - the table-cell early return (cell navigation behavior)
      - the "cursor block must be `list-item`" gate (so Tab doesn't
        hijack plain-paragraph contexts where it inserts indent)
- [x] `pnpm verify:fast` green
- [x] Self review the diff
- [x] Commit on `main` per workflow (or short-lived branch + PR)

## Out of Scope

- Unifying the three duplicate copies of indent constants/logic.
- Tab behavior on non-list-item selections (current behavior: no-op).
- Mixed selections (some list, some not) — only list-items are indented;
  paragraphs are left alone, matching the existing handleTab gate intent.
